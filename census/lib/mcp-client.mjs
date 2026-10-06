/**
 * The smallest MCP client that can ask a Streamable HTTP server what it publishes:
 * initialize, initialized, resources/list, resources/read, tools/list. Read-only by
 * construction: it never calls a tool. Answers may come as JSON or as an SSE stream.
 */
const PROTOCOL_VERSION = '2025-06-18';

export class McpHttpClient {
  constructor(url, { timeoutMs = 20000, userAgent = 'mcp-ui-census/0.1 (+https://github.com/shteynu/render-policy)', fetch = globalThis.fetch } = {}) {
    this.url = url;
    this.timeoutMs = timeoutMs;
    this.fetch = fetch;
    this.userAgent = userAgent;
    this.sessionId = null;
    this.nextId = 1;
    this.serverInfo = null;
  }

  async request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = await this.post({ jsonrpc: '2.0', id, method, params });
    if (!payload) throw new Error(`${method}: empty response`);
    if (payload.error) throw Object.assign(new Error(`${method}: ${payload.error.message ?? 'error'}`), { rpc: payload.error });
    return payload.result;
  }

  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params }, { expectBody: false });
  }

  async post(body, { expectBody = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
        'user-agent': this.userAgent,
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const response = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'follow' });
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      if (response.status === 401 || response.status === 403) {
        const body = await readText(response, controller.signal).catch(() => '');
        const kind = /Host not in allowlist|egress/i.test(body) ? 'egress-blocked' : 'auth';
        throw Object.assign(new Error(`HTTP ${response.status}`), { kind, status: response.status });
      }
      if (response.status === 404 || response.status === 405) throw Object.assign(new Error(`HTTP ${response.status}`), { kind: 'not-mcp', status: response.status });
      if (!response.ok && response.status !== 202) throw Object.assign(new Error(`HTTP ${response.status}`), { kind: 'http', status: response.status });
      if (!expectBody || response.status === 202 || response.status === 204) return null;
      const type = response.headers.get('content-type') ?? '';
      const text = await readText(response, controller.signal);
      if (type.includes('text/event-stream')) return firstJsonRpcFromSse(text, body.id);
      if (!text.trim()) return null;
      try {
        return JSON.parse(text);
      } catch {
        throw Object.assign(new Error('response is not JSON'), { kind: 'not-mcp' });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'mcp-ui-census', version: '0.1.0' },
    });
    this.serverInfo = result?.serverInfo ?? null;
    this.capabilities = result?.capabilities ?? {};
    await this.notify('notifications/initialized');
    return result;
  }

  async listAll(method, key) {
    const items = [];
    let cursor;
    for (let page = 0; page < 50; page += 1) {
      const result = await this.request(method, cursor ? { cursor } : {});
      items.push(...(Array.isArray(result?.[key]) ? result[key] : []));
      cursor = result?.nextCursor;
      if (!cursor) break;
    }
    return items;
  }

  listResources() {
    return this.listAll('resources/list', 'resources');
  }

  listTools() {
    return this.listAll('tools/list', 'tools');
  }

  async readResource(uri) {
    const result = await this.request('resources/read', { uri });
    return Array.isArray(result?.contents) ? result.contents : [];
  }
}

/**
 * response.text() that gives up when the signal aborts. The fetch abort does not always reach a
 * body read in progress (seen with a brotli-encoded chunked answer over TLS that never sent a
 * byte): the read then never settles, and once the timeout timer has fired nothing keeps the
 * process alive, so the census run ended with that probe unrecorded.
 */
function readText(response, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => {
      response.body?.cancel().catch(() => {});
      reject(signal.reason ?? Object.assign(new Error('aborted'), { name: 'AbortError' }));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    response.text().then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

/** The JSON-RPC message with the given id (or the first one) out of an SSE body. */
export function firstJsonRpcFromSse(text, id) {
  let fallback = null;
  for (const block of text.split(/\n\n+/)) {
    const data = block
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
      .join('\n');
    if (!data) continue;
    try {
      const message = JSON.parse(data);
      if (id !== undefined && message.id === id) return message;
      fallback ??= message;
    } catch {
      /* not JSON */
    }
  }
  return fallback;
}

/** Classify an error thrown by the client for the report. */
export function failureKind(error) {
  if (error?.kind) return error.kind;
  if (error?.name === 'AbortError') return 'timeout';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|certificate|fetch failed/i.test(error?.message ?? '') || /fetch failed/i.test(error?.cause?.message ?? '')) return 'network';
  if (/Host not in allowlist/i.test(error?.message ?? '')) return 'egress-blocked';
  return 'protocol';
}
