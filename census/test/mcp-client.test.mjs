import assert from 'node:assert/strict';
import http from 'node:http';
import { test } from 'node:test';
import { failureKind, McpHttpClient } from '../lib/mcp-client.mjs';

function serve(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}/mcp` })));
}

const body = (req) => new Promise((resolve) => {
  let data = '';
  req.on('data', (c) => (data += c));
  req.on('end', () => resolve(data ? JSON.parse(data) : null));
});

test('client: initialize, session header, paginated resources, read, tools; JSON and SSE answers', async () => {
  const seen = [];
  const { server, url } = await serve(async (req, res) => {
    const message = await body(req);
    seen.push({ method: message?.method, session: req.headers['mcp-session-id'] ?? null, accept: req.headers.accept });
    if (message.method === 'initialize') {
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-1' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { protocolVersion: '2025-06-18', serverInfo: { name: 'fake', version: '1' }, capabilities: {} } }));
      return;
    }
    if (!message.id) {
      res.writeHead(202).end();
      return;
    }
    if (message.method === 'resources/list') {
      const page = message.params?.cursor ? { resources: [{ uri: 'ui://b', mimeType: 'text/html;profile=mcp-app' }] } : { resources: [{ uri: 'file://a' }], nextCursor: 'c2' };
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: page })}\n\n`);
      return;
    }
    if (message.method === 'resources/read') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { contents: [{ uri: message.params.uri, mimeType: 'text/html;profile=mcp-app', text: '<html></html>', _meta: { ui: { csp: { connectDomains: ['*'] } } } }] } }));
      return;
    }
    if (message.method === 'tools/list') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: [{ name: 't', _meta: { ui: { resourceUri: 'ui://b' } } }] } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'unknown' } }));
  });
  try {
    const client = new McpHttpClient(url);
    const init = await client.initialize();
    assert.equal(init.serverInfo.name, 'fake');
    const resources = await client.listResources();
    assert.deepEqual(resources.map((r) => r.uri), ['file://a', 'ui://b']);
    const contents = await client.readResource('ui://b');
    assert.equal(contents[0]._meta.ui.csp.connectDomains[0], '*');
    const tools = await client.listTools();
    assert.equal(tools[0].name, 't');
    assert.deepEqual(seen.map((s) => s.method), ['initialize', 'notifications/initialized', 'resources/list', 'resources/list', 'resources/read', 'tools/list']);
    assert.ok(seen.slice(1).every((s) => s.session === 'sess-1'), 'session id echoed after initialize');
    assert.ok(seen.every((s) => s.accept.includes('text/event-stream')));
    await assert.rejects(client.request('nope'), /unknown/);
  } finally {
    server.close();
  }
});

test('client: 401 is auth, egress proxy 403 is egress-blocked, HTML is not-mcp', async () => {
  const { server, url } = await serve((req, res) => {
    if (req.url.endsWith('/auth')) return res.writeHead(401).end('');
    if (req.url.endsWith('/egress')) return res.writeHead(403).end('Host not in allowlist: x. Add this host to your network egress settings');
    res.writeHead(200, { 'content-type': 'text/html' }).end('<html>not mcp</html>');
  });
  try {
    for (const [suffix, kind] of [['/auth', 'auth'], ['/egress', 'egress-blocked'], ['/html', 'not-mcp']]) {
      const client = new McpHttpClient(url.replace('/mcp', suffix));
      await client.initialize().then(() => assert.fail('should throw'), (error) => assert.equal(failureKind(error), kind, suffix));
    }
    const dead = new McpHttpClient('http://127.0.0.1:1/mcp');
    await dead.initialize().then(() => assert.fail(), (error) => assert.equal(failureKind(error), 'network'));
  } finally {
    server.close();
  }
});
