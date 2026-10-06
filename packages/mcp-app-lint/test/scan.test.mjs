import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { analyzeHtml, lintPackageScan, postMessageStarCalls, scanPackage, scanPackageDir } from '../src/index.mjs';

async function fixture(files) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-app-lint-scan-'));
  for (const [name, text] of Object.entries(files)) {
    await mkdir(path.dirname(path.join(dir, name)), { recursive: true });
    await writeFile(path.join(dir, name), text);
  }
  return dir;
}

test('scan: CSP lists written through a constant or a shorthand are read, with the line', async () => {
  const dir = await fixture({
    'dist/server.js': [
      "const RESOURCE_DOMAINS = ['https://*.example.com', 'https://cdn.example.com'];",
      "const connectDomains = ['https://api.example.com'];",
      "registerAppResource(server, 'app', 'ui://demo/app', {}, () => ({ contents: [{ _meta: { ui: { csp: { resourceDomains: RESOURCE_DOMAINS, connectDomains } } } }] }));",
    ].join('\n'),
  });
  try {
    const scan = await scanPackageDir(dir);
    assert.equal(scan.cspDeclared, true);
    assert.deepEqual(scan.domains.resourceDomains, ['https://*.example.com', 'https://cdn.example.com']);
    assert.deepEqual(scan.domains.connectDomains, ['https://api.example.com']);
    assert.deepEqual(scan.domainSites.map((s) => [s.key, s.file, s.line]), [
      ['resourceDomains', 'dist/server.js', 1],
      ['resourceDomains', 'dist/server.js', 1],
      ['connectDomains', 'dist/server.js', 2],
    ]);
    const wildcard = lintPackageScan(scan, 'pkg').find((f) => f.ruleId === 'MCPAPP003');
    assert.deepEqual([wildcard.uri, wildcard.region], ['pkg/dist/server.js', { startLine: 1 }]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('scan: a list built at runtime counts as declared; the bundled schema and type declarations do not', async () => {
  const dynamic = await fixture({
    'server.js': "registerAppResource(s, 'a', 'ui://a', {}, () => ({ contents: [{ _meta: { ui: { csp: { connectDomains: config.hosts, resourceDomains: hosts } } } }] }));",
  });
  const noise = await fixture({
    'server.js': "registerAppResource(s, 'a', 'ui://a', {}, () => ({}));\nconst Csp = z.object({ connectDomains: z.array(z.string()).optional(), resourceDomains: string[] });",
    'types.d.ts': 'interface Csp { connectDomains: Domains; }',
  });
  try {
    const d = await scanPackageDir(dynamic);
    assert.deepEqual([d.cspDeclared, d.cspDynamic, d.domainSites.length], [true, 1, 0]);
    assert.ok(!lintPackageScan(d, 'pkg').some((f) => f.ruleId === 'MCPAPP001'));
    const n = await scanPackageDir(noise);
    assert.deepEqual([n.cspDeclared, n.cspDynamic], [false, 0]);
    assert.ok(lintPackageScan(n, 'pkg').some((f) => f.ruleId === 'MCPAPP001'));
  } finally {
    await rm(dynamic, { recursive: true, force: true });
    await rm(noise, { recursive: true, force: true });
  }
});

test('scan: a host that only mentions the MIME type does not serve UI; a server using a MIME constant from another file does', async () => {
  const host = await fixture({
    'dist/host.js': "export const RESOURCE_MIME_TYPE = 'text/html;profile=mcp-app';\nif (content.mimeType === RESOURCE_MIME_TYPE && uri.startsWith('ui://')) mount(iframe);",
  });
  const server = await fixture({
    'dist/mime.js': "export const APP_MIME = 'text/html;profile=mcp-app';",
    'dist/server.js': "server.registerResource('app', APP_URI, {}, async () => ({ contents: [{ uri: APP_URI, mimeType: APP_MIME, text: html }] }));",
  });
  try {
    const h = await scanPackageDir(host);
    assert.deepEqual([h.declaresUi, h.servesUi], [true, false]);
    assert.deepEqual(lintPackageScan(h, 'pkg'), []);
    const s = await scanPackageDir(server);
    assert.equal(s.servesUi, true);
    assert.deepEqual(lintPackageScan(s, 'pkg').map((f) => f.ruleId), ['MCPAPP001']);
  } finally {
    await rm(host, { recursive: true, force: true });
    await rm(server, { recursive: true, force: true });
  }
});

test('html analysis: escaped sinks and protocol messages are counted apart, the old totals stay', () => {
  const a = analyzeHtml([
    '<script>',
    "el.innerHTML = '<i>' + escapeHtml(t) + '</i>';",
    "el.innerHTML = `<i>${t}</i>`;",
    "parent.postMessage({ jsonrpc: '2.0', method: 'ui/initialize' }, '*');",
    "parent.postMessage(msg, '*');",
    '</script>',
  ].join('\n'));
  assert.deepEqual([a.unsafeInnerHtmlHandwritten, a.unsafeInnerHtmlHandwrittenUnescaped], [2, 1]);
  assert.deepEqual(a.sinks.map((s) => [s.line, s.escaped]), [[2, true], [3, false]]);
  assert.deepEqual([a.postMessageStarHandwritten, a.postMessageStarHandwrittenNonProtocol], [2, 1]);
  assert.deepEqual(a.postMessages.map((c) => [c.line, c.protocol]), [[4, true], [5, false]]);
});

test('postMessage calls: only a "*" target origin counts, nested arguments and strings are skipped over', () => {
  const calls = postMessageStarCalls("w.postMessage({ a: f(1, ')'), b: [1, 2] }, \"*\", [port]);\nw.postMessage(x, origin);\ntop.postMessage({ method: 'ui/x' }, `*`);");
  assert.deepEqual(calls.map((c) => [c.line, c.protocol]), [[1, false], [3, true]]);
});

test('scanPackage refuses a package without a tarball before touching the network', async () => {
  await assert.rejects(scanPackage({ name: 'no-tarball', tarball: null }, os.tmpdir()), /no-tarball: no tarball/);
});
