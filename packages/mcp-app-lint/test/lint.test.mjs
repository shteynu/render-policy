import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { levelOf, lintHtml, lintResource, lintTools, lintUiMeta, RULES, run, toSarif, toText } from '../src/index.mjs';

const ids = (findings) => findings.map((f) => f.ruleId).sort();

test('rules have unique ids and names', () => {
  assert.equal(new Set(RULES.map((r) => r.id)).size, RULES.length);
  assert.equal(new Set(RULES.map((r) => r.name)).size, RULES.length);
});

test('ui meta: missing csp, every-host entries, wildcards, http, sink hosts, dev origins, permissions', () => {
  assert.deepEqual(ids(lintUiMeta({ ui: { prefersBorder: true } }, 'ui://a')), ['MCPAPP001']);
  const findings = lintUiMeta(
    { ui: { csp: { connectDomains: ['https:', '*.example.com', 'http://api.example.com', 'https://hooks.zapier.com'], frameDomains: ['blob:', 'http://127.0.0.1:*'] }, permissions: { camera: {}, clipboardWrite: {} } } },
    'ui://a',
  );
  // blob: never reaches the network; the loopback origin is a development origin, not an insecure transport.
  assert.deepEqual(ids(findings), ['MCPAPP002', 'MCPAPP003', 'MCPAPP004', 'MCPAPP005', 'MCPAPP006', 'MCPAPP007']);
  assert.equal(findings.find((f) => f.ruleId === 'MCPAPP005').logical.name, 'csp.connectDomains');
});

test('ui meta: a shared storage host is a sink, one account on it is a note', () => {
  const findings = lintUiMeta({ ui: { csp: { resourceDomains: ['https://storage.googleapis.com', 'https://acct.blob.core.windows.net'] } } }, 'ui://a');
  assert.deepEqual(ids(findings), ['MCPAPP005', 'MCPAPP019']);
  assert.equal(levelOf(findings[1].ruleId), 'note');
});

test('resource: read wider than list is an error, plain mismatch a warning, html findings attached', () => {
  const list = { ui: { csp: { connectDomains: ['https://api.example.com'] } } };
  const wider = lintResource({ uri: 'ui://a', listMeta: list, readMeta: { ui: { csp: { connectDomains: ['https://api.example.com', 'https://other.example.com'] } } } });
  assert.ok(ids(wider).includes('MCPAPP018'));
  const different = lintResource({ uri: 'ui://a', listMeta: list, readMeta: { ui: { csp: { connectDomains: ['https://api2.example.com'] } } } });
  assert.ok(ids(different).includes('MCPAPP017'));
  const html = '<!doctype html><html><body><div id="o"></div><script>\ndocument.getElementById("o").innerHTML = result.text;\n</script></body></html>';
  const withHtml = lintResource({ uri: 'ui://a', readMeta: list, html });
  const sink = withHtml.find((f) => f.ruleId === 'MCPAPP010');
  assert.equal(sink.region.startLine, 2);
  assert.equal(sink.uri, 'ui://a');
});

test('ui meta: a wildcard above a sink service is a sink', () => {
  const findings = lintUiMeta({ ui: { csp: { resourceDomains: ['https://*.amazonaws.com', 'https://*.mapbox.com'] } } }, 'ui://a');
  assert.deepEqual(ids(findings), ['MCPAPP003', 'MCPAPP003', 'MCPAPP005']);
});

test('html: escaped templates and the app protocol are not findings', () => {
  const html = [
    '<!doctype html><html><body><script>',
    "app.innerHTML = '<b>' + esc(name) + '</b>';",
    "app.innerHTML = '<b>' + name + '</b>';",
    "window.parent.postMessage({ jsonrpc: '2.0', method: 'ui/notifications/size-changed', params: { height: h } }, '*');",
    "parent.postMessage({ type: 'ui-size-change', payload: { height: h } }, '*');",
    "window.parent.postMessage(data, '*');",
    "frame.contentWindow.postMessage({ jsonrpc: '2.0', id: 1 }, '*');",
    '</script></body></html>',
  ].join('\n');
  const findings = lintHtml(html, 'app.html');
  assert.deepEqual(findings.filter((f) => f.ruleId === 'MCPAPP010').map((f) => f.region.startLine), [3]);
  assert.deepEqual(findings.filter((f) => f.ruleId === 'MCPAPP011').map((f) => f.region.startLine), [6, 7]);
});

test('html: postMessage star, handlers, eval, forms, external and sink hosts', () => {
  const html = `<html><body onload="p()"><form action="https://forms.gle/x"></form><img src="https://webhook.site/x.png"><script src="https://cdn.example.com/a.js"></script><script>parent.postMessage(d, '*'); eval(x);</script></body></html>`;
  assert.deepEqual(ids(lintHtml(html, 'app.html')), ['MCPAPP011', 'MCPAPP012', 'MCPAPP013', 'MCPAPP014', 'MCPAPP015', 'MCPAPP016', 'MCPAPP016']);
});

test('tools: implicit visibility and side effects visible to the app', () => {
  const findings = lintTools([
    { name: 'read', _meta: { ui: { resourceUri: 'ui://a' } }, annotations: { readOnlyHint: true } },
    { name: 'delete', _meta: { ui: { resourceUri: 'ui://a', visibility: ['model', 'app'] } } },
    { name: 'model-only', _meta: { ui: { resourceUri: 'ui://a', visibility: ['model'] } } },
    { name: 'plain' },
  ]);
  assert.deepEqual(findings.map((f) => [f.ruleId, f.logical.name]), [['MCPAPP009', 'read'], ['MCPAPP008', 'delete']]);
});

test('sarif: valid 2.1.0 shape with rule indexes and locations', () => {
  const findings = lintUiMeta({ ui: { csp: { connectDomains: ['*'] } } }, 'ui://a');
  const log = toSarif(findings);
  assert.equal(log.version, '2.1.0');
  const run0 = log.runs[0];
  assert.equal(run0.tool.driver.name, 'mcp-app-lint');
  assert.equal(run0.tool.driver.rules.length, RULES.length);
  const result = run0.results[0];
  assert.equal(result.ruleId, 'MCPAPP002');
  assert.equal(run0.tool.driver.rules[result.ruleIndex].id, 'MCPAPP002');
  assert.equal(result.level, 'error');
  assert.equal(result.locations[0].physicalLocation.artifactLocation.uri, 'ui://a');
  assert.match(toText(findings), /error +MCPAPP002 ui:\/\/a/);
});

test('cli: --read with --list and --tools, text output, exit codes', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-app-lint-'));
  const list = path.join(dir, 'list.json');
  const read = path.join(dir, 'read.json');
  const tools = path.join(dir, 'tools.json');
  await writeFile(list, JSON.stringify({ resources: [{ uri: 'ui://w/main', mimeType: 'text/html;profile=mcp-app', _meta: { ui: { csp: { connectDomains: ['https://api.example.com'] } } } }] }));
  await writeFile(read, JSON.stringify({ contents: [{ uri: 'ui://w/main', mimeType: 'text/html;profile=mcp-app', text: '<html><body><script>\nel.innerHTML = data;\n</script></body></html>', _meta: { ui: { csp: { connectDomains: ['https://api.example.com', 'https://evil.example'] } } } }] }));
  await writeFile(tools, JSON.stringify({ tools: [{ name: 'send', _meta: { ui: { resourceUri: 'ui://w/main' } } }] }));
  let out = '';
  const stdout = { write: (s) => (out += s) };
  const code = await run(['--read', read, '--list', list, '--tools', tools, '--format', 'text'], { stdout, stderr: { write() {} } });
  assert.equal(code, 1, 'read wider than list is an error');
  assert.match(out, /MCPAPP018/);
  assert.match(out, /MCPAPP010 ui:\/\/w\/main:2:1/);
  assert.match(out, /MCPAPP008/);
  out = '';
  const lenient = await run(['--read', read, '--list', list, '--fail-on', 'none'], { stdout, stderr: { write() {} } });
  assert.equal(lenient, 0);
  assert.equal(JSON.parse(out).version, '2.1.0');
  const usage = await run([], { stdout, stderr: { write() {} } });
  assert.equal(usage, 2);
});
