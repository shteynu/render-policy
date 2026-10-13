/**
 * The smallest MCP clients that can ask a server what it publishes: initialize, initialized,
 * resources/list, resources/read, tools/list. Read-only by construction: they never call a tool.
 * McpHttpClient speaks Streamable HTTP (answers as JSON or as an SSE stream); McpStdioClient
 * starts a local command and speaks newline-delimited JSON-RPC over its stdin and stdout.
 */
import { spawn } from 'node:child_process';
import { TOOL_VERSION } from './sarif.mjs';

/**
 * @import { ChildProcessWithoutNullStreams } from 'node:child_process'
 */
/**
 * @typedef {object} ClientOptions
 * @property {number} [timeoutMs] per request
 * @property {string} [clientName] `clientInfo.name` sent at initialize
 * @property {string} [clientVersion]
 */
/**
 * What a server publishes, as the linter needs it.
 * @typedef {object} ServerSnapshot
 * @property {Record<string, any> | null} serverInfo
 * @property {any[]} resources the resources/list entries
 * @property {any[]} contents the resources/read content items of the UI resources
 * @property {any[]} tools the tools/list entries ([] when the server has no tools capability)
 * @property {{ uri: string, message: string }[]} errors reads that failed; the rest is still linted
 */

const PROTOCOL_VERSION = '2025-06-18';
export const UI_MIME_PREFIX = 'text/html';

/** @type {(r: any) => boolean} */
export const isUiResource = (r) => String(r?.mimeType ?? '').startsWith(UI_MIME_PREFIX) || String(r?.uri ?? '').startsWith('ui://');

/**
 * initialize, then the requests every client shares. Subclasses provide `request` and `notify`.
 */
class BaseClient {
  /** @param {ClientOptions} options */
  constructor({ timeoutMs = 20000, clientName = 'mcp-app-lint', clientVersion = TOOL_VERSION } = {}) {
    this.timeoutMs = timeoutMs;
    this.clientName = clientName;
    this.clientVersion = clientVersion;
    this.nextId = 1;
    /** @type {Record<string, any> | null} */
    this.serverInfo = null;
    /** @type {Record<string, any>} */
    this.capabilities = {};
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<any>}
   */
  async request(method, params = {}) {
    throw new Error(`${method}: no transport`);
  }

  /**
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<void>}
   */
  async notify(method, params = {}) {
    throw new Error(`${method}: no transport`);
  }

  async initialize() {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: this.clientName, version: this.clientVersion },
    });
    this.serverInfo = result?.serverInfo ?? null;
    this.capabilities = result?.capabilities ?? {};
    await this.notify('notifications/initialized');
    return result;
  }

  /**
   * Every page of a paginated list (at most 50 pages).
   * @param {string} method
   * @param {string} key
   */
  async listAll(method, key) {
    /** @type {any[]} */
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

  /** @param {string} uri */
  async readResource(uri) {
    const result = await this.request('resources/read', { uri });
    return Array.isArray(result?.contents) ? result.contents : [];
  }

  async close() {}
}

/**
 * A JSON-RPC error answer as an Error.
 * @param {string} method
 * @param {any} error
 */
const rpcError = (method, error) => Object.assign(new Error(`${method}: ${error?.message ?? 'error'}`), { rpc: error, kind: 'protocol' });

/**
 * Streamable HTTP. `headers` go on every request (for example an Authorization header).
 */
export class McpHttpClient extends BaseClient {
  /**
   * @param {string} url
   * @param {ClientOptions & { userAgent?: string, headers?: Record<string, string>, fetch?: typeof globalThis.fetch }} [options]
   */
  constructor(url, { userAgent, headers = {}, fetch = globalThis.fetch, ...options } = {}) {
    super(options);
    this.url = url;
    this.fetch = fetch;
    this.userAgent = userAgent ?? `mcp-app-lint/${TOOL_VERSION} (+https://github.com/shteynu/render-policy)`;
    this.headers = headers;
    /** @type {string | null} */
    this.sessionId = null;
  }

  /**
   * @override
   * @type {BaseClient['request']}
   */
  async request(method, params = {}) {
    const id = this.nextId;
    this.nextId += 1;
    const payload = await this.post({ jsonrpc: '2.0', id, method, params });
    if (!payload) throw Object.assign(new Error(`${method}: empty response`), { kind: 'protocol' });
    if (payload.error) throw rpcError(method, payload.error);
    return payload.result;
  }

  /**
   * @override
   * @type {BaseClient['notify']}
   */
  async notify(method, params = {}) {
    await this.post({ jsonrpc: '2.0', method, params }, { expectBody: false });
  }

  /**
   * @param {{ jsonrpc: string, id?: number, method: string, params: unknown }} body
   * @param {{ expectBody?: boolean }} [options]
   * @returns {Promise<any>}
   */
  async post(body, { expectBody = true } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      /** @type {Record<string, string>} */
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': PROTOCOL_VERSION,
        'user-agent': this.userAgent,
        ...this.headers,
      };
      if (this.sessionId) headers['mcp-session-id'] = this.sessionId;
      const response = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal, redirect: 'follow' });
      const session = response.headers.get('mcp-session-id');
      if (session) this.sessionId = session;
      if (response.status === 401 || response.status === 403) {
        const text = await readText(response, controller.signal).catch(() => '');
        const kind = /Host not in allowlist|egress/i.test(text) ? 'egress-blocked' : 'auth';
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

  /**
   * Ends the session on the server, if it gave one; a server that does not support it is fine.
   * @override
   */
  async close() {
    if (!this.sessionId) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.timeoutMs, 5000));
    try {
      const response = await this.fetch(this.url, { method: 'DELETE', headers: { 'mcp-session-id': this.sessionId, 'mcp-protocol-version': PROTOCOL_VERSION, 'user-agent': this.userAgent, ...this.headers }, signal: controller.signal });
      await response.body?.cancel().catch(() => {});
    } catch {
      /* best effort */
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * response.text() that gives up when the signal aborts. The fetch abort does not always reach a
 * body read in progress (seen with a brotli-encoded chunked answer over TLS that never sent a
 * byte): the read then never settles, and once the timeout timer has fired nothing keeps the
 * process alive.
 * @param {Response} response
 * @param {AbortSignal} signal
 * @returns {Promise<string>}
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

/**
 * The JSON-RPC message with the given id (or the first one) out of an SSE body.
 * @param {string} text
 * @param {number} [id]
 * @returns {any}
 */
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

/**
 * A local server started as a child process: `command` runs through the shell, so it is written
 * the way the user types it (`node dist/server.js`, `uv run server.py`). The server's stderr is
 * kept (the last lines go into a startup error) and not printed.
 */
export class McpStdioClient extends BaseClient {
  /**
   * @param {string} command
   * @param {ClientOptions & { cwd?: string, env?: NodeJS.ProcessEnv }} [options]
   */
  constructor(command, { cwd, env, ...options } = {}) {
    super(options);
    this.command = command;
    /** @type {ChildProcessWithoutNullStreams} */
    this.child = spawn(command, { shell: true, cwd, env: env ?? process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Map<number, { resolve: (v: any) => void, reject: (e: Error) => void, method: string, timer: NodeJS.Timeout }>} */
    this.pending = new Map();
    this.stderrTail = '';
    this.buffer = '';
    /** @type {Error | null} */
    this.exited = null;
    this.child.stdout.setEncoding('utf8');
    this.child.stdout.on('data', (/** @type {string} */ chunk) => this.onData(chunk));
    this.child.stderr.setEncoding('utf8');
    this.child.stderr.on('data', (/** @type {string} */ chunk) => {
      this.stderrTail = (this.stderrTail + chunk).slice(-2000);
    });
    // A write after the child exited raises EPIPE on stdin; the exit handler reports it.
    this.child.stdin.on('error', () => {});
    this.child.on('error', (error) => this.fail(Object.assign(new Error(`${command}: ${error.message}`), { kind: 'spawn' })));
    this.child.on('exit', (code, signal) => {
      const tail = this.stderrTail.trim().split('\n').slice(-5).join('\n');
      this.fail(Object.assign(new Error(`server exited (${signal ?? `code ${code}`})${tail ? `:\n${tail}` : ''}`), { kind: 'exit' }));
    });
  }

  /** @param {Error} error */
  fail(error) {
    this.exited ??= error;
    for (const [id, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(this.exited);
      this.pending.delete(id);
    }
  }

  /** @param {string} chunk */
  onData(chunk) {
    this.buffer += chunk;
    let newline;
    while ((newline = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, newline).trim();
      this.buffer = this.buffer.slice(newline + 1);
      if (!line) continue;
      /** @type {any} */
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        continue; // a server that logs to stdout; not ours to parse
      }
      this.onMessage(message);
    }
  }

  /** @param {any} message */
  onMessage(message) {
    if (message && 'method' in message) {
      // A request from the server (ping, roots/list, sampling…): answer ping, decline the rest.
      if (message.id === undefined || message.id === null) return;
      const reply = message.method === 'ping' ? { jsonrpc: '2.0', id: message.id, result: {} } : { jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'mcp-app-lint is a read-only client' } };
      this.write(reply);
      return;
    }
    const waiter = this.pending.get(message?.id);
    if (!waiter) return;
    clearTimeout(waiter.timer);
    this.pending.delete(message.id);
    if (message.error) waiter.reject(rpcError(waiter.method, message.error));
    else waiter.resolve(message.result);
  }

  /** @param {unknown} message */
  write(message) {
    if (!this.exited) this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  /**
   * @override
   * @type {BaseClient['request']}
   */
  request(method, params = {}) {
    if (this.exited) return Promise.reject(this.exited);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(Object.assign(new Error(`${method}: no answer in ${this.timeoutMs} ms`), { kind: 'timeout' }));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, method, timer });
      this.write({ jsonrpc: '2.0', id, method, params });
    });
  }

  /**
   * @override
   * @type {BaseClient['notify']}
   */
  async notify(method, params = {}) {
    this.write({ jsonrpc: '2.0', method, params });
  }

  /**
   * Closes stdin, the shutdown the stdio transport defines, then terminates a server that lingers.
   * @override
   */
  async close() {
    if (this.exited) return;
    const exited = new Promise((resolve) => this.child.once('exit', resolve));
    this.child.stdin.end();
    const timer = setTimeout(() => this.child.kill('SIGTERM'), 2000);
    const hard = setTimeout(() => this.child.kill('SIGKILL'), 5000);
    await exited;
    clearTimeout(timer);
    clearTimeout(hard);
  }
}

/**
 * Classify an error thrown by a client: auth, egress-blocked, not-mcp, http, timeout, network, spawn, exit, protocol.
 * @param {any} error
 * @returns {string}
 */
export function failureKind(error) {
  if (error?.kind) return error.kind;
  if (error?.name === 'AbortError') return 'timeout';
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|certificate|fetch failed/i.test(error?.message ?? '') || /fetch failed/i.test(error?.cause?.message ?? '')) return 'network';
  if (/Host not in allowlist/i.test(error?.message ?? '')) return 'egress-blocked';
  return 'protocol';
}

/**
 * Everything the linter reads from a live server: listing, the read result of every UI resource,
 * tools. A failed read is recorded and the rest goes on; a failed initialize or listing throws.
 * @param {BaseClient} client
 * @returns {Promise<ServerSnapshot>}
 */
export async function snapshotServer(client) {
  await client.initialize();
  const resources = await listOrEmpty(() => client.listResources());
  /** @type {any[]} */
  const contents = [];
  /** @type {ServerSnapshot['errors']} */
  const errors = [];
  for (const resource of resources.filter(isUiResource)) {
    try {
      contents.push(...(await client.readResource(resource.uri)).map((/** @type {any} */ item) => ({ uri: resource.uri, ...item })));
    } catch (error) {
      errors.push({ uri: resource.uri, message: /** @type {Error} */ (error).message });
    }
  }
  const tools = await listOrEmpty(() => client.listTools());
  return { serverInfo: client.serverInfo, resources, contents, tools, errors };
}

/**
 * A list the server answers with a JSON-RPC error (method not found: no such capability) is empty;
 * a transport failure still throws.
 * @param {() => Promise<any[]>} list
 */
async function listOrEmpty(list) {
  try {
    return await list();
  } catch (error) {
    if (/** @type {any} */ (error)?.rpc) return [];
    throw error;
  }
}

export { BaseClient };
