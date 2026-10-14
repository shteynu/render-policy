/**
 * mcp-app-lint as an MCP server over stdio (`mcp-app-lint --mcp`), so an agent that builds an MCP
 * App can check it while it works. Every tool is read-only: it analyses what it is given, reads a
 * local directory, or asks a remote server what it publishes. No tool runs a command; a local
 * server over stdio is linted from the CLI (`--stdio`), where the user sees the command.
 */
import { createInterface } from 'node:readline';
import { lintA2uiMessages, parseA2uiMessages } from './a2ui.mjs';
import { analyzeHtml } from './analyze.mjs';
import { McpHttpClient, snapshotServer } from './client.mjs';
import { suggestCsp } from './csp.mjs';
import { levelOf, lintHtml, lintPackageScan, lintResource, lintSnapshot, lintTools } from './lint.mjs';
import { scanPackageDir } from './npm.mjs';
import { toText, TOOL_VERSION } from './sarif.mjs';

/**
 * @import { Readable, Writable } from 'node:stream'
 * @import { Finding } from './lint.mjs'
 */
/**
 * @typedef {object} ToolDef
 * @property {string} name
 * @property {string} title
 * @property {string} description
 * @property {Record<string, unknown>} inputSchema
 * @property {{ readOnlyHint: true, openWorldHint: boolean }} annotations
 * @property {(args: Record<string, any>) => Promise<{ text: string, structured: Record<string, unknown> }>} run
 */

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const INSTRUCTIONS =
  'Security checks for MCP Apps (ui:// resources with text/html;profile=mcp-app) and A2UI message streams. ' +
  'Use lint_ui_resource on a UI document and its _meta, suggest_csp for the _meta.ui.csp a document needs, ' +
  'lint_directory on a server package, lint_server on a running Streamable HTTP endpoint. Findings carry a rule id ' +
  '(MCPAPP0xx, A2UI0xx), a level and a message; fix errors first. Every tool is read-only.';

/**
 * Findings as tool output: one line each for the model, the objects for a client that reads structured content.
 * @param {Finding[]} findings
 */
function report(findings) {
  const counts = { error: 0, warning: 0, note: 0 };
  for (const f of findings) counts[f.level ?? levelOf(f.ruleId)] += 1;
  return { text: toText(findings), structured: { counts, findings: findings.map((f) => ({ ...f, level: f.level ?? levelOf(f.ruleId) })) } };
}

/**
 * @param {Record<string, any>} args
 * @param {string} key
 */
function requireString(args, key) {
  const value = args[key];
  if (typeof value !== 'string' || value.length === 0) throw new Error(`${key} must be a non-empty string`);
  return value;
}

/** @type {ToolDef[]} */
export const TOOLS = [
  {
    name: 'lint_ui_resource',
    title: 'Lint an MCP App UI resource',
    description:
      'Check one MCP App UI resource: its HTML (dynamic innerHTML, postMessage to "*", eval, sink hosts) and its _meta.ui ' +
      '(CSP entries that allow every host, wildcards, data sinks, development origins, hosts the document needs but the CSP ' +
      'does not allow, declared hosts the document never uses, sensitive permissions). Pass meta as the _meta of the ' +
      'resources/read content item, and list_meta as the _meta of the resources/list entry to compare them.',
    inputSchema: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'The HTML text of the resource.' },
        meta: { type: 'object', description: 'The _meta object of the resources/read content item, for example { "ui": { "csp": { … } } }.' },
        list_meta: { type: 'object', description: 'The _meta object of the resources/list entry.' },
        uri: { type: 'string', description: 'The resource uri, used as the location of findings.' },
      },
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args) {
      const uri = typeof args.uri === 'string' ? args.uri : 'ui://resource';
      const html = typeof args.html === 'string' ? args.html : null;
      if (html === null && !args.meta && !args.list_meta) throw new Error('pass html, meta or both');
      if (!args.meta && !args.list_meta && html !== null) return report(lintHtml(html, uri));
      return report(lintResource({ uri, html, readMeta: args.meta ?? null, listMeta: args.list_meta ?? null }));
    },
  },
  {
    name: 'suggest_csp',
    title: 'Suggest the CSP a UI document needs',
    description:
      'The minimal _meta.ui.csp for an MCP App document: connectDomains for the origins it fetches or opens sockets to, ' +
      'resourceDomains for scripts, styles, fonts, images and media, frameDomains for iframes. Static: a URL the script ' +
      'assembles at run time is not seen. csp is null when no origin has a known key; mentioned lists absolute URLs the ' +
      'script holds whose key cannot be told statically (for example a tile URL handed to a map library), to check by hand.',
    inputSchema: { type: 'object', properties: { html: { type: 'string', description: 'The HTML text of the resource.' } }, required: ['html'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args) {
      const analysis = analyzeHtml(requireString(args, 'html'));
      const csp = suggestCsp(analysis.cspNeeds);
      const mentioned = analysis.cspMentioned;
      const hint = mentioned.length > 0 ? `\nThe script also holds ${mentioned.join(', ')}; the key is unknown. Check whether the UI loads them (a map tile server or a CDN base URL usually belongs in resourceDomains, an API in connectDomains).` : '';
      const text = csp ? `${JSON.stringify({ csp }, null, 2)}${hint}` : mentioned.length > 0 ? `No origin with a known key.${hint}` : 'The document references no external origin; it needs no CSP.';
      return { text, structured: { csp, mentioned } };
    },
  },
  {
    name: 'lint_tools',
    title: 'Lint an MCP tools/list result',
    description: 'Check tools that have UI metadata: side-effecting tools the app can call, and visibility left to the default.',
    inputSchema: { type: 'object', properties: { tools: { type: 'array', items: { type: 'object' }, description: 'The tools array of a tools/list result.' } }, required: ['tools'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args) {
      if (!Array.isArray(args.tools)) throw new Error('tools must be an array');
      return report(lintTools(args.tools));
    },
  },
  {
    name: 'lint_a2ui',
    title: 'Lint A2UI messages',
    description:
      'Check A2UI v0.9 server-to-client messages: openUrl schemes, sink hosts in media and links, encoded payloads in URLs ' +
      'fetched without a click, URLs built from data, markup in Text.',
    inputSchema: {
      type: 'object',
      properties: { messages: { description: 'The messages: an array of message objects, or JSON / JSONL text.', anyOf: [{ type: 'array', items: { type: 'object' } }, { type: 'string' }] } },
      required: ['messages'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args) {
      const messages = typeof args.messages === 'string' ? parseA2uiMessages(args.messages) : Array.isArray(args.messages) ? parseA2uiMessages(JSON.stringify(args.messages)) : null;
      if (!messages) throw new Error('messages must be an array or a string');
      return report(lintA2uiMessages(messages, 'a2ui'));
    },
  },
  {
    name: 'lint_directory',
    title: 'Lint an MCP server package directory',
    description:
      'Scan a local package directory (source or build output) of an MCP server: CSP domain lists where they are written, ' +
      'with file and line, permissions, and the HTML documents it ships. Reads files only.',
    inputSchema: { type: 'object', properties: { path: { type: 'string', description: 'Absolute path of the package directory.' } }, required: ['path'] },
    annotations: { readOnlyHint: true, openWorldHint: false },
    async run(args) {
      const dir = requireString(args, 'path');
      return report(lintPackageScan(await scanPackageDir(dir), dir));
    },
  },
  {
    name: 'lint_server',
    title: 'Lint a running MCP server',
    description:
      'Connect to a Streamable HTTP MCP endpoint, read what it publishes (resources/list, resources/read of UI resources, ' +
      'tools/list) and check it. Never calls a tool on that server.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'The endpoint, for example http://localhost:3001/mcp.' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra request headers, for example an Authorization header.' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
    async run(args) {
      const url = requireString(args, 'url');
      if (!/^https?:\/\//i.test(url)) throw new Error('url must be http or https');
      const headers = args.headers && typeof args.headers === 'object' ? Object.fromEntries(Object.entries(args.headers).map(([k, v]) => [k, String(v)])) : {};
      const client = new McpHttpClient(url, { headers });
      try {
        const snapshot = await snapshotServer(client);
        const result = report(lintSnapshot(snapshot));
        const summary = `${snapshot.serverInfo?.name ?? url}: ${snapshot.resources.length} resource(s), ${snapshot.contents.length} UI content item(s), ${snapshot.tools.length} tool(s).`;
        const failed = snapshot.errors.map((e) => `resources/read ${e.uri} failed: ${e.message}`);
        return { text: [summary, ...failed, result.text].join('\n'), structured: { ...result.structured, server: snapshot.serverInfo, readErrors: snapshot.errors } };
      } finally {
        await client.close();
      }
    },
  },
];

/**
 * The answer to one JSON-RPC message, or null for a notification.
 * @param {any} message
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function handleMessage(message) {
  const id = message?.id;
  const isRequest = id !== undefined && id !== null;
  /** @param {unknown} result */
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  /** @param {number} code @param {string} text */
  const fail = (code, text) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message: text } });
  if (!message || message.jsonrpc !== '2.0' || typeof message.method !== 'string') return isRequest ? fail(-32600, 'invalid request') : null;
  if (!isRequest) return null; // notifications/initialized, cancellations: nothing to do
  switch (message.method) {
    case 'initialize': {
      const requested = message.params?.protocolVersion;
      return ok({
        protocolVersion: SUPPORTED_VERSIONS.includes(requested) ? requested : SUPPORTED_VERSIONS[0],
        capabilities: { tools: {} },
        serverInfo: { name: 'mcp-app-lint', title: 'mcp-app-lint', version: TOOL_VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS.map(({ run: _run, ...tool }) => tool) });
    case 'tools/call': {
      const tool = TOOLS.find((t) => t.name === message.params?.name);
      if (!tool) return fail(-32602, `unknown tool ${message.params?.name}`);
      try {
        const { text, structured } = await tool.run(message.params?.arguments ?? {});
        return ok({ content: [{ type: 'text', text }], structuredContent: structured, isError: false });
      } catch (error) {
        return ok({ content: [{ type: 'text', text: `${tool.name}: ${/** @type {Error} */ (error).message}` }], isError: true });
      }
    }
    default:
      return fail(-32601, `method not found: ${message.method}`);
  }
}

/**
 * Serves newline-delimited JSON-RPC until the input ends. Nothing but protocol messages goes to the output.
 * @param {{ input?: Readable, output?: Pick<Writable, 'write'> }} [io]
 * @returns {Promise<void>}
 */
export function serveMcp({ input = process.stdin, output = process.stdout } = {}) {
  const lines = createInterface({ input, crlfDelay: Infinity });
  /** @type {Promise<void>[]} */
  const inFlight = [];
  lines.on('line', (line) => {
    if (!line.trim()) return;
    /** @type {any} */
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } })}\n`);
      return;
    }
    inFlight.push(
      handleMessage(message).then((answer) => {
        if (answer) output.write(`${JSON.stringify(answer)}\n`);
      }),
    );
  });
  return new Promise((resolve) => lines.on('close', () => Promise.allSettled(inFlight).then(() => resolve())));
}
