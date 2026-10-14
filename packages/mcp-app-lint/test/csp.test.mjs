import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { cspNeeds, entryCovers, mentionedOrigins, lintPackageScan, lintResource, scanPackageDir, suggestCsp, undeclaredOrigins, unusedEntries } from '../src/index.mjs';
import { run } from '../src/cli.mjs';

const ids = (findings) => findings.map((f) => f.ruleId);
// The CSP rules only: MCPAPP015 notes every external host and is not what these tests are about.
const cspIds = (findings) => ids(findings).filter((id) => id !== 'MCPAPP015');

const APP = [
  '<!doctype html><html><head>',
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">',
  '<link rel="canonical" href="https://www.example.com/app">',
  '<link rel="preconnect" href="https://preconnect.example">',
  '<style>.bg { background: url("https://img.example/bg.png") } @import "https://css.example/x.css";</style>',
  '<script type="module" src="https://esm.example/app.js"></script>',
  '</head><body>',
  '<img src="https://img.example/logo.png" srcset="https://img.example/2x.png 2x, https://img2.example/3x.png 3x">',
  '<video poster="//media.example/p.jpg"><source src="https://media.example/v.mp4"></video>',
  '<iframe src="https://embed.example/frame"></iframe>',
  '<a href="https://docs.example/help">help</a>',
  '<img src="/relative.png"><img src="data:image/png;base64,AA==">',
  '<script>',
  'fetch("https://api.example/v1/items");',
  'const ws = new WebSocket("wss://live.example:8443/socket");',
  'import("https://cdn.example/lazy.js");',
  '</script></body></html>',
].join('\n');

test('cspNeeds: origins by the key that has to allow them; links, data: and relative URLs need nothing', () => {
  assert.deepEqual(cspNeeds(APP), {
    connectDomains: ['https://api.example', 'wss://live.example:8443'],
    resourceDomains: [
      'https://cdn.example',
      'https://css.example',
      'https://esm.example',
      'https://fonts.googleapis.com',
      'https://fonts.gstatic.com', // the stylesheet host's font companion
      'https://img.example',
      'https://img2.example',
      'https://media.example',
    ],
    frameDomains: ['https://embed.example'],
  });
  assert.equal(suggestCsp(cspNeeds('<p>self-contained</p><a href="https://x.example">x</a>')), null);
});

test('cspNeeds: CSS url() and @import count only in CSS; new URL() in script is not a fetch', () => {
  const html = [
    '<div style="background-image: url(\'https://bg.example/a.png\')"></div>',
    '<style>@import url("https://css.example/a.css"); .x { background: URL(https://upper.example/b.png) }</style>',
    // A bundled JSON Schema validator builds a base URL it never fetches.
    '<script>const base = new URL("https://github.com/cfworker"); const u = url("https://fn.example/x");</script>',
  ].join('\n');
  assert.deepEqual(cspNeeds(html).resourceDomains, ['https://bg.example', 'https://css.example', 'https://upper.example']);
});

test('mentionedOrigins: URL literals with no known key are hints; docs, namespaces, placeholders and links are not', () => {
  const html = [
    '<a href="https://help.example.net/x">help</a><a href="https://site.test/about">about</a>',
    '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    '<script>',
    'const base = `https://cdn.lib.test/releases/${version}/Build`;',
    'new Map.Tiles({ url: "https://tile.osm.test/{z}/{x}/{y}.png" });',
    'fetch("https://api.test/x");',
    'console.warn("see https://vuejs.org/guide and https://github.com/o/r/issues");',
    'const doc = "https://*.example.com", home = "https://site.test/";',
    '</script>',
  ].join('\n');
  // api.test has a key (connect); site.test is a link target; the rest is noise.
  assert.deepEqual(mentionedOrigins(html), ['https://cdn.lib.test', 'https://tile.osm.test']);
  assert.deepEqual(cspNeeds(html).connectDomains, ['https://api.test']);
});

test('entryCovers: exact hosts, leading wildcards (not the apex), full wildcards; scheme and port are not compared', () => {
  assert.ok(entryCovers('https://api.example', 'https://api.example'));
  assert.ok(entryCovers('api.example', 'wss://api.example:8443'));
  assert.ok(entryCovers('https://*.example.com', 'https://a.b.example.com'));
  assert.ok(!entryCovers('https://*.example.com', 'https://example.com'));
  assert.ok(entryCovers('https:', 'https://anything.example'));
  assert.ok(entryCovers('*', 'https://anything.example'));
  assert.ok(!entryCovers('blob:', 'https://anything.example'));
  assert.ok(!entryCovers('https://api.example', 'https://evil.example'));
});

test('undeclaredOrigins and unusedEntries compare a declaration with the document', () => {
  const html = '<img src="https://img.example/a.png"><script>fetch("https://api.example/x")</script>';
  const csp = { connectDomains: ['https://api.example', 'https://old-api.example', 'https://*.wild.example'], resourceDomains: ['https://cdn.example'] };
  assert.deepEqual(undeclaredOrigins(csp, cspNeeds(html)), { resourceDomains: ['https://img.example'] });
  // Wildcards are MCPAPP003's business, not "unused".
  assert.deepEqual(unusedEntries(csp, html), [
    { key: 'connectDomains', entry: 'https://old-api.example' },
    { key: 'resourceDomains', entry: 'https://cdn.example' },
  ]);
  // A host the script mentions as a bare string counts as used.
  assert.deepEqual(unusedEntries({ connectDomains: ['https://api.example'] }, '<script>const base = "api.example"; fetch(`https://${base}/x`)</script>'), []);
});

test('lintResource: MCPAPP020 for an unused entry, MCPAPP021 for a needed origin the CSP blocks', () => {
  const html = '<img src="https://img.example/a.png"><script>fetch("https://api.example/x")</script>';
  const findings = lintResource({ uri: 'ui://app', html, readMeta: { ui: { csp: { connectDomains: ['https://api.example', 'https://old.example'] } } } });
  assert.deepEqual(cspIds(findings), ['MCPAPP020', 'MCPAPP021']);
  const undeclared = findings.find((f) => f.ruleId === 'MCPAPP021');
  assert.deepEqual(undeclared.properties, { key: 'resourceDomains', origins: ['https://img.example'] });
  assert.equal(undeclared.logical.name, 'csp.resourceDomains');
  // Covered exactly: neither rule.
  assert.deepEqual(cspIds(lintResource({ uri: 'ui://app', html, readMeta: { ui: { csp: { connectDomains: ['https://api.example'], resourceDomains: ['https://img.example'] } } } })), []);
  // Without the document there is nothing to compare.
  assert.deepEqual(ids(lintResource({ uri: 'ui://app', readMeta: { ui: { csp: { connectDomains: ['https://old.example'] } } } })), []);
});

test('MCPAPP001 carries the declaration the document needs', () => {
  const html = '<img src="https://img.example/a.png"><script>fetch("https://api.example/x")</script>';
  const [missing] = lintResource({ uri: 'ui://app', html, readMeta: { ui: {} } }).filter((f) => f.ruleId === 'MCPAPP001');
  assert.deepEqual(missing.properties.suggestedCsp, { connectDomains: ['https://api.example'], resourceDomains: ['https://img.example'] });
  assert.match(missing.message, /Declare: \{"connectDomains":\["https:\/\/api\.example"\]/);
});

/** A package whose built UI references hosts and whose server declares no CSP. */
async function packageFixture() {
  const dir = await mkdtemp(path.join(process.cwd(), '.csp-fixture-'));
  await mkdir(path.join(dir, 'dist'), { recursive: true });
  await writeFile(path.join(dir, 'server.js'), "server.registerAppResource('ui://demo/app', { _meta: { ui: {} } });\n");
  await writeFile(path.join(dir, 'dist', 'app.html'), '<!doctype html><html><body><img src="https://img.example/a.png"><script>fetch("https://api.example/x")</script></body></html>');
  return dir;
}

test('--dir with a trailing slash gives single-slash locations; the package MCPAPP001 suggests a CSP', async () => {
  const dir = await packageFixture();
  try {
    const rel = path.relative(process.cwd(), dir);
    const findings = lintPackageScan(await scanPackageDir(dir), `${rel}/`);
    assert.ok(findings.length > 0);
    for (const f of findings) assert.ok(!f.uri.includes('//'), f.uri);
    const missing = findings.find((f) => f.ruleId === 'MCPAPP001');
    assert.equal(missing.uri, rel);
    assert.deepEqual(missing.properties.suggestedCsp, { connectDomains: ['https://api.example'], resourceDomains: ['https://img.example'] });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--suggest-csp prints the declaration per document, as JSON or text, and exits 0', async () => {
  const dir = await packageFixture();
  const html = path.join(dir, 'dist', 'app.html');
  try {
    const out = [];
    const io = { stdout: { write: (s) => out.push(s) }, stderr: { write: () => {} } };
    assert.equal(await run(['--html', html, '--suggest-csp'], io), 0);
    const rel = path.relative(process.cwd(), html);
    assert.deepEqual(JSON.parse(out.join('')), { [rel]: { connectDomains: ['https://api.example'], resourceDomains: ['https://img.example'] } });
    out.length = 0;
    assert.equal(await run(['--dir', `${dir}${path.sep}`, '--suggest-csp', '--format', 'text'], io), 0);
    assert.match(out.join(''), /dist\/app\.html\n {2}connectDomains: https:\/\/api\.example\n {2}resourceDomains: https:\/\/img\.example\n/);
    assert.ok(!out.join('').includes('//dist'));
    // A URL with no known key is a hint: a line in text, stderr next to JSON (stdout stays the declaration).
    const tiles = path.join(dir, 'tiles.html');
    await writeFile(tiles, '<script>new Tiles({ url: "https://tile.osm.test/{z}/{x}/{y}.png" })</script>');
    out.length = 0;
    await run(['--html', tiles, '--suggest-csp', '--format', 'text'], io);
    assert.match(out.join(''), /also in script, key unknown \(check whether the UI loads them\): https:\/\/tile\.osm\.test\n/);
    out.length = 0;
    const err = [];
    await run(['--html', tiles, '--suggest-csp'], { stdout: io.stdout, stderr: { write: (s) => err.push(s) } });
    assert.deepEqual(Object.values(JSON.parse(out.join(''))), [null]);
    assert.match(err.join(''), /the script also holds https:\/\/tile\.osm\.test; the key is unknown/);
    // Self-contained documents need none.
    const plain = path.join(dir, 'plain.html');
    await writeFile(plain, '<p>hi</p>');
    out.length = 0;
    await run(['--html', plain, '--suggest-csp', '--format', 'text'], io);
    assert.match(out.join(''), /needs no CSP/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

