import assert from 'node:assert/strict';
import { test } from 'node:test';
import { analyzeHtml, analyzeTools, analyzeUiMeta, compareListRead, uiMetaOf, withSinkHosts } from '../lib/analyze.mjs';
import { classifyDomains, parseDomainPattern, sinkFor } from '../lib/domains.mjs';
import { firstJsonRpcFromSse } from '../lib/mcp-client.mjs';
import { latestOnly, normalizeServer } from '../lib/registry.mjs';

test('domain patterns: scheme, wildcard, full wildcard, insecure, sinks', () => {
  assert.equal(parseDomainPattern('https://api.example.com').host, 'api.example.com');
  assert.equal(parseDomainPattern('*.example.com').leadingWildcard, true);
  assert.equal(parseDomainPattern('*').full, true);
  assert.equal(parseDomainPattern('http://cdn.example.com').insecureScheme, true);
  assert.equal(sinkFor('abc.webhook.site')?.category, 'webhook');
  assert.equal(sinkFor('*.workers.dev')?.category, 'serverless');
  assert.equal(sinkFor('api.example.com'), null);
  const c = classifyDomains(['https://api.example.com', '*.example.com', '*', 'https://hooks.slack.com']);
  assert.deepEqual([c.count, c.wildcards, c.fullWildcards, c.sinks], [4, 2, 1, ['webhook']]);
});

test('ui meta: modern and legacy shapes, csp classification, permissions', () => {
  assert.equal(uiMetaOf(null), null);
  assert.deepEqual(uiMetaOf({ 'ui/resourceUri': 'ui://a' }), { resourceUri: 'ui://a' });
  const a = analyzeUiMeta({ ui: { csp: { connectDomains: ['https://api.example.com', '*'], resourceDomains: ['https://cdn.example.com'] }, permissions: { camera: {}, clipboardWrite: {} }, prefersBorder: true } });
  assert.equal(a.cspDeclared, true);
  assert.equal(a.anyFullWildcard, true);
  assert.deepEqual(a.permissions, ['camera', 'clipboardWrite']);
  assert.equal(a.domains.connectDomains.count, 2);
  const none = analyzeUiMeta({ ui: { prefersBorder: false } });
  assert.equal(none.cspDeclared, false);
  assert.equal(analyzeUiMeta({ ui: { csp: {} } }).cspEmpty, true);
});

test('list vs read: mismatch and a wider read policy are detected', () => {
  const list = { ui: { csp: { connectDomains: ['https://api.example.com'] } } };
  const same = compareListRead(list, { ui: { csp: { connectDomains: ['https://api.example.com'] } } });
  assert.deepEqual([same.comparable, same.mismatch, same.readWider], [true, false, false]);
  const wider = compareListRead(list, { ui: { csp: { connectDomains: ['https://api.example.com', 'https://evil.example'] } } });
  assert.deepEqual([wider.mismatch, wider.readWider], [true, true]);
  assert.equal(compareListRead(list, null).listOnly, true);
  assert.equal(compareListRead(null, null).comparable, false);
});

test('tools: visibility and side effects visible to the app', () => {
  const t = analyzeTools([
    { name: 'a', _meta: { ui: { resourceUri: 'ui://x', visibility: ['app'] } }, annotations: { readOnlyHint: true } },
    { name: 'b', _meta: { ui: { resourceUri: 'ui://x' } } },
    { name: 'c', _meta: { ui: { visibility: ['model'] } } },
    { name: 'd' },
  ]);
  assert.deepEqual(t, { total: 4, withUi: 2, visibleToApp: 2, appOnly: 1, sideEffectsVisibleToApp: 1 });
});

test('html: inline scripts are linted with no-unsafe-innerhtml, hosts and sinks collected', () => {
  const html = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'self'">
<script src="https://cdn.example.com/app.js"></script></head><body>
<form action="https://forms.gle/abc"><button onclick="go()">x</button></form>
<img src="https://webhook.site/abc/p.png">
<script>const el = document.getElementById('out'); el.innerHTML = data.html; window.parent.postMessage({a:1}, '*');</script>
<script type="application/json">{"not":"code"}</script>
<script>this is not javascript (</script>
</body></html>`;
  const a = withSinkHosts(analyzeHtml(html));
  assert.equal(a.inlineScripts, 2);
  assert.equal(a.handwrittenScripts, 2);
  assert.equal(a.unsafeInnerHtml, 1);
  assert.equal(a.unsafeInnerHtmlHandwritten, 1);
  assert.equal(a.postMessageStarHandwritten, 1);
  assert.equal(a.unparsedScripts, 1);
  assert.equal(a.inlineHandlers, 1);
  assert.equal(a.postMessageStar, 1);
  assert.equal(a.formsWithAction, 1);
  assert.equal(a.metaCsp, true);
  assert.deepEqual(a.externalScripts, ['https://cdn.example.com/app.js']);
  assert.deepEqual(a.externalHosts, ['cdn.example.com', 'forms.gle', 'webhook.site']);
  assert.deepEqual(a.sinkHosts, ['forms.gle', 'webhook.site']);
});

test('html: a minified bundle is not counted as handwritten', () => {
  const bundle = `<script>${'var e=document.createElement("div");e.innerHTML=window.x;'.repeat(60)}</script>`;
  const a = analyzeHtml(bundle);
  assert.equal(a.inlineScripts, 1);
  assert.equal(a.handwrittenScripts, 0);
  assert.equal(a.unsafeInnerHtml, 60);
  assert.equal(a.unsafeInnerHtmlHandwritten, 0);
});

test('sse: the message with the matching id is picked out of a stream', () => {
  const sse = 'event: message\ndata: {"jsonrpc":"2.0","method":"notifications/x"}\n\nevent: message\ndata: {"jsonrpc":"2.0","id":7,"result":{"ok":true}}\n\n';
  assert.deepEqual(firstJsonRpcFromSse(sse, 7).result, { ok: true });
  assert.equal(firstJsonRpcFromSse('data: not json\n\n', 1), null);
});

test('registry: normalization and latest-only filtering', () => {
  const entry = { server: { name: 'x/y', version: '1.0.0', remotes: [{ type: 'streamable-http', url: 'https://x.example/mcp' }], packages: [{ registryType: 'npm', identifier: '@x/y' }] }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: false, publishedAt: '2026-01-01' } } };
  const n = normalizeServer(entry);
  assert.deepEqual([n.name, n.remotes[0].type, n.packages[0].identifier, n.isLatest], ['x/y', 'streamable-http', '@x/y', false]);
  const newer = normalizeServer({ server: { name: 'x/y', version: '1.1.0' }, _meta: { 'io.modelcontextprotocol.registry/official': { isLatest: true, publishedAt: '2026-02-01' } } });
  assert.equal(latestOnly([n, newer])[0].version, '1.1.0');
});
