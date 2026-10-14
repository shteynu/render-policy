import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { test } from 'node:test';
import { handleMessage, MCP_TOOLS, McpHttpClient, McpStdioClient, serveMcp, snapshotServer } from '../src/index.mjs';
import { redactArgv, run } from '../src/cli.mjs';

const UI_HTML = '<!doctype html><html><body><div id="o"></div><img src="https://img.example/a.png"><script>\nwindow.onmessage = (e) => { document.getElementById("o").innerHTML = e.data.text; };\n</script></body></html>';
const READ_META = { ui: { csp: { connectDomains: ['https://webhook.site'], resourceDomains: ['https://img.example'] } } };
const TOOLS = [{ name: 'delete_all', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://demo/app' } } }];

/**
 * Answers for a fake server, shared by the HTTP and stdio fixtures. `calls` records every method.
 * @param {any} message
 */
function answer(message) {
  const ok = (result) => ({ jsonrpc: '2.0', id: message.id, result });
  switch (message.method) {
    case 'initialize':
      return ok({ protocolVersion: '2025-06-18', serverInfo: { name: 'fake', version: '9' }, capabilities: { resources: {}, tools: {} } });
    case 'resources/list':
      return ok({ resources: [{ uri: 'ui://demo/app', mimeType: 'text/html;profile=mcp-app' }, { uri: 'file:///notes.txt', mimeType: 'text/plain' }] });
    case 'resources/read':
      return ok({ contents: [{ uri: message.params.uri, mimeType: 'text/html;profile=mcp-app', text: UI_HTML, _meta: READ_META }] });
    case 'tools/list':
      return ok({ tools: TOOLS });
    default:
      return { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: `no ${message.method}` } };
  }
}

function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

async function httpServer({ status } = {}) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      calls.push({ method: req.method, rpc: data ? JSON.parse(data).method : null, auth: req.headers.authorization ?? null, session: req.headers['mcp-session-id'] ?? null });
      if (status) return res.writeHead(status).end();
      if (req.method === 'DELETE') return res.writeHead(200).end();
      const message = JSON.parse(data);
      if (message.id === undefined) return res.writeHead(202).end();
      // Answer one request as SSE, the rest as JSON: the client takes both.
      if (message.method === 'resources/read') {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        return res.end(`event: message\ndata: ${JSON.stringify(answer(message))}\n\n`);
      }
      res.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 's-1' });
      res.end(JSON.stringify(answer(message)));
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, calls, url: `http://127.0.0.1:${server.address().port}/mcp` };
}

test('--url lints what a live server publishes: CSP, HTML and tools; headers are sent; no tool is called', async () => {
  const { server, calls, url } = await httpServer();
  try {
    const io = capture();
    const code = await run(['--url', url, '--header', 'Authorization: Bearer test-token', '--format', 'text'], io);
    assert.equal(code, 1); // MCPAPP005 is an error
    const text = io.out();
    for (const id of ['MCPAPP005', 'MCPAPP010', 'MCPAPP020', 'MCPAPP008', 'MCPAPP009']) assert.match(text, new RegExp(`${id} `), id);
    assert.match(text, /MCPAPP005 ui:\/\/demo\/app /);
    assert.match(text, /MCPAPP008 tools\/list /);
    assert.match(io.err(), /fake 9: 2 resource\(s\), 1 UI resource\(s\) read, 1 tool\(s\)/);
    const rpc = calls.map((c) => c.rpc).filter(Boolean);
    assert.deepEqual(rpc, ['initialize', 'notifications/initialized', 'resources/list', 'resources/read', 'tools/list'], 'only the UI resource is read, and no tools/call');
    assert.ok(calls.every((c) => c.auth === 'Bearer test-token'));
    assert.equal(calls.at(-1).method, 'DELETE', 'the session is ended');
    assert.equal(calls.at(-1).session, 's-1');
  } finally {
    server.close();
  }
});

test('--url: a 401 tells the user how to pass credentials', async () => {
  const { server, url } = await httpServer({ status: 401 });
  try {
    await assert.rejects(run(['--url', url], capture()), /HTTP 401 \(the server wants credentials; pass them with --header/);
  } finally {
    server.close();
  }
});

/** A stdio server written in plain Node: logs to stdout once (not JSON), pings the client, then answers. */
async function stdioServer() {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-app-lint-stdio-'));
  const file = path.join(dir, 'server.mjs');
  await writeFile(
    file,
    [
      "import { createInterface } from 'node:readline';",
      `const answer = ${answer.toString()};`,
      `const UI_HTML = ${JSON.stringify(UI_HTML)}; const READ_META = ${JSON.stringify(READ_META)}; const TOOLS = ${JSON.stringify(TOOLS)};`,
      "process.stdout.write('starting fake server\\n');",
      "process.stderr.write('a log line on stderr\\n');",
      'let pinged = false;',
      'const pending = [];',
      "createInterface({ input: process.stdin }).on('line', (line) => {",
      '  const message = JSON.parse(line);',
      "  if (message.id === 'ping-1') { pinged = true; for (const m of pending.splice(0)) process.stdout.write(JSON.stringify(answer(m)) + '\\n'); return; }",
      '  if (message.id === undefined) return;',
      "  if (message.method === 'tools/call') process.exit(42);",
      "  if (message.method === 'initialize') { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: 'ping-1', method: 'ping' }) + '\\n'); pending.push(message); return; }",
      "  if (!pinged) { pending.push(message); return; }",
      "  process.stdout.write(JSON.stringify(answer(message)) + '\\n');",
      '});',
    ].join('\n'),
  );
  return { dir, command: `node ${JSON.stringify(file)}` };
}

test('--stdio starts the server, answers its ping, skips non-JSON stdout, lints, and shuts it down', async () => {
  const { dir, command } = await stdioServer();
  try {
    const io = capture();
    const code = await run(['--stdio', command, '--format', 'text', '--fail-on', 'none'], io);
    assert.equal(code, 0);
    assert.match(io.out(), /MCPAPP005 ui:\/\/demo\/app /);
    assert.match(io.out(), /MCPAPP008 tools\/list /);
    assert.match(io.err(), /fake 9: 2 resource\(s\)/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('McpStdioClient: a server that exits reports its stderr tail', async () => {
  const client = new McpStdioClient(`node -e "process.stderr.write('missing API_KEY\\n'); process.exit(3)"`, { timeoutMs: 5000 });
  await assert.rejects(client.initialize(), /server exited \(code 3\):\nmissing API_KEY/);
  await client.close();
});

test('snapshotServer: a server without resources or tools capabilities gives empty lists', async () => {
  const client = new McpHttpClient('https://x.example/mcp', {
    fetch: async (_url, init) => {
      const message = JSON.parse(init.body);
      if (message.id === undefined) return new Response(null, { status: 202 });
      const body = message.method === 'initialize' ? { jsonrpc: '2.0', id: message.id, result: { capabilities: {} } } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    },
  });
  const snapshot = await snapshotServer(client);
  assert.deepEqual([snapshot.resources, snapshot.contents, snapshot.tools], [[], [], []]);
});

test('--mcp: initialize, tools/list (all read-only), tools/call, errors', async () => {
  const init = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.deepEqual(init.result.capabilities, { tools: {} });
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);

  const list = await handleMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
  assert.deepEqual(list.result.tools.map((t) => t.name), MCP_TOOLS.map((t) => t.name));
  for (const tool of list.result.tools) {
    assert.equal(tool.annotations.readOnlyHint, true, tool.name);
    assert.equal(tool.inputSchema.type, 'object', tool.name);
    assert.equal('run' in tool, false);
  }
  assert.ok(!list.result.tools.some((t) => /stdio|command/i.test(t.name)), 'no tool runs a command');

  const lint = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lint_ui_resource', arguments: { html: UI_HTML, meta: READ_META, uri: 'ui://demo/app' } } });
  assert.equal(lint.result.isError, false);
  assert.equal(lint.result.structuredContent.counts.error, 1);
  assert.ok(lint.result.structuredContent.findings.some((f) => f.ruleId === 'MCPAPP005' && f.level === 'error'));
  assert.match(lint.result.content[0].text, /MCPAPP010 ui:\/\/demo\/app:2:/);

  const csp = await handleMessage({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'suggest_csp', arguments: { html: UI_HTML } } });
  assert.deepEqual(csp.result.structuredContent, { csp: { resourceDomains: ['https://img.example'] }, mentioned: [] });
  const tiles = await handleMessage({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'suggest_csp', arguments: { html: '<script>new Tiles({ url: "https://tile.osm.test/{z}.png" })</script>' } } });
  assert.deepEqual(tiles.result.structuredContent, { csp: null, mentioned: ['https://tile.osm.test'] });
  assert.match(tiles.result.content[0].text, /No origin with a known key\.\nThe script also holds https:\/\/tile\.osm\.test/);

  const bad = await handleMessage({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'suggest_csp', arguments: {} } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /html must be a non-empty string/);

  const unknown = await handleMessage({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'run_command' } });
  assert.equal(unknown.error.code, -32602);
  assert.equal((await handleMessage({ jsonrpc: '2.0', id: 7, method: 'prompts/list' })).error.code, -32601);
});

test('--mcp: lint_server over HTTP, and the stdio loop writes only protocol lines', async () => {
  const { server, url } = await httpServer();
  try {
    const input = new PassThrough();
    const lines = [];
    const done = serveMcp({ input, output: { write: (s) => lines.push(s) } });
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } })}\n`);
    input.write('not json\n');
    input.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'lint_server', arguments: { url } } })}\n`);
    input.end();
    await done;
    // Answers may arrive in any order (JSON-RPC matches them by id); the parse error has none.
    const messages = new Map(lines.map((l) => JSON.parse(l)).map((m) => [m.id, m]));
    assert.deepEqual([...messages.keys()].sort(), [1, 2, null]);
    assert.equal(messages.get(null).error.code, -32700);
    const result = messages.get(2).result;
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.server.name, 'fake');
    assert.ok(result.structuredContent.findings.some((f) => f.ruleId === 'MCPAPP008' && f.uri === 'tools/list'));
    const refused = await handleMessage({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'lint_server', arguments: { url: 'file:///etc/passwd' } } });
    assert.equal(refused.result.isError, true);
  } finally {
    server.close();
  }
});

test('the SARIF command line masks header values, URL credentials and query values, and env assignments', async () => {
  assert.deepEqual(
    redactArgv(['--url', 'https://user:pw@x.example/mcp?key=s3cret&v=1', '--header', 'Authorization: Bearer abc', '--stdio', 'API_KEY=xyz OTHER="a b" node s.js --port=3', '--format', 'sarif']),
    ['--url', 'https://***@x.example/mcp?key=***&v=***', '--header', 'Authorization: ***', '--stdio', 'API_KEY=*** OTHER=*** node s.js --port=3', '--format', 'sarif'],
  );
  const { server, url } = await httpServer();
  try {
    const io = capture();
    await run(['--url', url, '--header', 'Authorization: Bearer test-token'], io);
    const log = JSON.parse(io.out());
    assert.ok(!JSON.stringify(log).includes('test-token'));
    assert.match(log.runs[0].invocations[0].commandLine, /--header Authorization: \*\*\*/);
  } finally {
    server.close();
  }
});
