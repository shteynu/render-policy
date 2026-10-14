/**
 * mcp-app-lint: SARIF findings about what an MCP App declares and what its HTML does.
 *
 *   mcp-app-lint --url https://host/mcp [--header "Authorization: Bearer …"]
 *                                                  # a live server over Streamable HTTP (read-only)
 *   mcp-app-lint --stdio "node dist/server.js"     # a local server started as a process (read-only)
 *   mcp-app-lint --dir ./my-server                 # a package directory (built or source)
 *   mcp-app-lint --package @scope/name             # an npm package (downloaded, scanned, deleted)
 *   mcp-app-lint --read read.json [--list list.json] [--tools tools.json]
 *                                                  # results of resources/read, resources/list, tools/list
 *   mcp-app-lint --html app.html                   # one UI document
 *   mcp-app-lint --a2ui stream.jsonl               # A2UI v0.9 messages (JSON, JSON array, { messages } or JSONL)
 *   mcp-app-lint --mcp                             # run as an MCP server over stdio
 * Options: --out file.sarif, --format sarif|text (default sarif), --fail-on error|warning|note|none (default error),
 * --suggest-csp (print the _meta.ui.csp each UI document needs instead of findings), --timeout ms (live servers)
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { lintA2uiMessages, parseA2uiMessages } from './a2ui.mjs';
import { analyzeHtml } from './analyze.mjs';
import { failureKind, McpHttpClient, McpStdioClient, snapshotServer } from './client.mjs';
import { mergeNeeds, suggestCsp } from './csp.mjs';
import { lintHtml, lintPackageScan, lintSnapshot, lintTools, levelOf } from './lint.mjs';
import { packageMeta, scanPackage, scanPackageDir } from './npm.mjs';
import { toSarif, toText } from './sarif.mjs';

/**
 * @import { Writable } from 'node:stream'
 * @import { BaseClient, ServerSnapshot } from './client.mjs'
 * @import { CspNeeds } from './csp.mjs'
 * @import { Finding } from './lint.mjs'
 * @import { PackageScan } from './npm.mjs'
 */
/**
 * @typedef {object} CliOptions
 * @property {string} format
 * @property {string} failOn
 * @property {string} [dir]
 * @property {string} [package]
 * @property {string} [read]
 * @property {string} [list]
 * @property {string} [tools]
 * @property {string} [html]
 * @property {string} [a2ui]
 * @property {string} [url]
 * @property {string} [stdio]
 * @property {Record<string, string>} headers
 * @property {number} [timeout]
 * @property {string} [out]
 * @property {boolean} [suggestCsp]
 * @property {boolean} [mcp]
 * @property {boolean} [help]
 */

/** @type {Record<string, number>} */
const LEVEL_RANK = { error: 3, warning: 2, note: 1, none: 0 };

/** @param {readonly string[]} argv */
function parseArgs(argv) {
  /** @type {CliOptions} */
  const options = { format: 'sarif', failOn: 'error', headers: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`${arg} needs a value`);
      return value;
    };
    if (arg === '--dir') options.dir = next();
    else if (arg === '--package') options.package = next();
    else if (arg === '--read') options.read = next();
    else if (arg === '--list') options.list = next();
    else if (arg === '--tools') options.tools = next();
    else if (arg === '--html') options.html = next();
    else if (arg === '--a2ui') options.a2ui = next();
    else if (arg === '--url') options.url = next();
    else if (arg === '--stdio') options.stdio = next();
    else if (arg === '--header') {
      const header = next();
      const colon = header.indexOf(':');
      if (colon <= 0) throw new Error(`--header needs "Name: value", got ${header}`);
      options.headers[header.slice(0, colon).trim()] = header.slice(colon + 1).trim();
    } else if (arg === '--timeout') {
      options.timeout = Number(next());
      if (!Number.isFinite(options.timeout) || options.timeout <= 0) throw new Error('--timeout needs a number of milliseconds');
    } else if (arg === '--suggest-csp') options.suggestCsp = true;
    else if (arg === '--mcp') options.mcp = true;
    else if (arg === '--out') options.out = next();
    else if (arg === '--format') options.format = next();
    else if (arg === '--fail-on') options.failOn = next();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

/** @type {(file: string) => Promise<any>} */
const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
/** @type {Record<string, string>} */
const FAILURE_HINTS = {
  auth: 'the server wants credentials; pass them with --header "Authorization: Bearer <token>"',
  'not-mcp': 'no MCP endpoint at this URL; servers usually answer at /mcp',
  timeout: 'no answer in time; raise --timeout',
  network: 'the host could not be reached',
};

/**
 * Connects, takes the snapshot, disconnects. Connection errors get a hint for the usual causes.
 * @param {BaseClient} client
 * @param {string} target what to name in an error
 * @param {Pick<Writable, 'write'>} stderr
 * @returns {Promise<ServerSnapshot>}
 */
async function snapshotOf(client, target, stderr) {
  try {
    const snapshot = await snapshotServer(client);
    const name = snapshot.serverInfo?.name ? `${snapshot.serverInfo.name}${snapshot.serverInfo.version ? ` ${snapshot.serverInfo.version}` : ''}` : target;
    stderr.write(`mcp-app-lint: ${name}: ${snapshot.resources.length} resource(s), ${new Set(snapshot.contents.map((c) => c.uri)).size} UI resource(s) read, ${snapshot.tools.length} tool(s)\n`);
    for (const error of snapshot.errors) stderr.write(`mcp-app-lint: resources/read ${error.uri} failed: ${error.message}\n`);
    return snapshot;
  } catch (error) {
    const hint = FAILURE_HINTS[failureKind(error)];
    throw new Error(`${target}: ${/** @type {Error} */ (error).message}${hint ? ` (${hint})` : ''}`);
  } finally {
    await client.close();
  }
}

/**
 * A filesystem path under the working directory becomes a forward-slash repo-relative uri; anything else is unchanged.
 * @param {string} uri
 */
function relativeUri(uri) {
  if (typeof uri !== 'string' || !path.isAbsolute(uri)) return uri;
  const rel = path.relative(process.cwd(), uri);
  return rel && !rel.startsWith('..') ? rel.split(path.sep).join('/') : uri;
}

const USAGE = [
  'usage: mcp-app-lint <input…> [options]',
  'inputs:',
  '  --url <endpoint> [--header "Name: value"]…   a live server over Streamable HTTP (read-only: never calls a tool)',
  '  --stdio "<command>"                          a local server started as a process (read-only)',
  '  --dir <path> | --package <name>              a package directory, or an npm package (downloaded, scanned, deleted)',
  '  --read <read.json> [--list <list.json>]      saved results of resources/read and resources/list',
  '  --tools <tools.json> | --html <file> | --a2ui <messages>',
  'options:',
  '  --format sarif|text   --out <file>   --fail-on error|warning|note|none   --timeout <ms>',
  '  --suggest-csp         print the _meta.ui.csp each UI document needs, instead of findings',
  '  --mcp                 run as an MCP server over stdio',
].join('\n');

/**
 * One block per document: its uri, then each key with the origins it needs, then the absolute URLs
 * the script holds whose key is unknown (see mentionedOrigins).
 * @param {Record<string, Partial<CspNeeds> | null>} suggestions
 * @param {Record<string, string[]>} mentioned
 */
function suggestionsText(suggestions, mentioned) {
  const blocks = Object.entries(suggestions).map(([uri, csp]) => {
    const lines = csp ? Object.entries(csp).map(([key, origins]) => `  ${key}: ${origins.join(' ')}`) : [];
    const extra = mentioned[uri] ?? [];
    if (extra.length > 0) lines.push(`  also in script, key unknown (check whether the UI loads them): ${extra.join(' ')}`);
    else if (!csp) lines.push('  needs no CSP (references no external host)');
    return `${uri}\n${lines.join('\n')}`;
  });
  return blocks.length > 0 ? `${blocks.join('\n')}\n` : 'no UI documents\n';
}

/**
 * The command line as the SARIF log records it, which code scanning stores and shows: header values,
 * credentials and query values in a URL, and environment assignments in a --stdio command are masked.
 * @param {readonly string[]} argv
 */
export function redactArgv(argv) {
  return argv.map((arg, i) => {
    const flag = argv[i - 1];
    if (flag === '--header') return arg.replace(/:.*$/s, ': ***');
    if (flag === '--url') {
      try {
        const url = new URL(arg);
        if (url.username || url.password) {
          url.username = '***';
          url.password = '';
        }
        for (const key of [...url.searchParams.keys()]) url.searchParams.set(key, '***');
        return url.href;
      } catch {
        return arg;
      }
    }
    if (flag === '--stdio') return arg.replace(/(^|\s)([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|'[^']*'|\S+)/g, '$1$2=***');
    return arg;
  });
}

/**
 * The command line, without the process exit: resolves to the exit code (0 clean, 1 findings at or
 * above --fail-on, 2 usage error). Throws on unreadable input or a failed download.
 * @param {readonly string[]} argv arguments after the program name
 * @param {{ stdout?: Pick<Writable, 'write'>, stderr?: Pick<Writable, 'write'> }} [io]
 * @returns {Promise<number>}
 */
export async function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = parseArgs(argv);
  if (options.mcp) {
    const { serveMcp } = await import('./server.mjs');
    await serveMcp();
    return 0;
  }
  const inputs = ['dir', 'package', 'read', 'html', 'tools', 'a2ui', 'url', 'stdio'];
  if (options.help || !inputs.some((key) => options[/** @type {keyof CliOptions} */ (key)])) {
    stderr.write(`${USAGE}\n`);
    return 2;
  }
  /** @type {Finding[]} */
  const findings = [];
  /** @type {Record<string, Partial<CspNeeds> | null>} */
  const suggestions = {};
  /** @type {Record<string, string[]>} */
  const mentioned = {};
  /** @param {string} uri @param {Partial<CspNeeds> | undefined} needs @param {string[] | undefined} [extra] */
  const suggest = (uri, needs, extra) => {
    suggestions[relativeUri(uri)] = needs ? suggestCsp(mergeNeeds([needs])) : null;
    if (extra?.length) mentioned[relativeUri(uri)] = extra;
  };
  /** @param {PackageScan} scan @param {string} root */
  const suggestPackage = (scan, root) => {
    for (const doc of scan.html ?? []) suggest(`${root.replace(/[\\/]+$/, '') || root}/${doc.file}`.replace(/^\.\//, ''), doc.cspNeeds, doc.cspMentioned);
  };
  /** @param {{ contents: readonly any[] }} snapshot */
  const suggestSnapshot = ({ contents }) => {
    for (const item of contents) {
      if (typeof item.text !== 'string') continue;
      const analysis = analyzeHtml(item.text);
      suggest(item.uri ?? 'resources/read', analysis.cspNeeds, analysis.cspMentioned);
    }
  };
  const timeoutMs = options.timeout;

  if (options.url) {
    const snapshot = await snapshotOf(new McpHttpClient(options.url, { headers: options.headers, timeoutMs }), options.url, stderr);
    findings.push(...lintSnapshot(snapshot));
    suggestSnapshot(snapshot);
  }
  if (options.stdio) {
    const snapshot = await snapshotOf(new McpStdioClient(options.stdio, { timeoutMs }), options.stdio, stderr);
    findings.push(...lintSnapshot(snapshot));
    suggestSnapshot(snapshot);
  }
  if (options.dir) {
    const scan = await scanPackageDir(path.resolve(options.dir));
    findings.push(...lintPackageScan(scan, options.dir));
    suggestPackage(scan, options.dir);
  }
  if (options.package) {
    const meta = await packageMeta(options.package);
    if (!meta.tarball) throw new Error(`${options.package}: no tarball`);
    const work = await mkdtemp(path.join(os.tmpdir(), 'mcp-app-lint-'));
    try {
      const scan = await scanPackage(meta, work);
      findings.push(...lintPackageScan(scan, `npm:${meta.name}@${meta.version}`));
      suggestPackage(scan, `npm:${meta.name}@${meta.version}`);
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  if (options.read) {
    const read = await readJson(options.read);
    const contents = Array.isArray(read?.contents) ? read.contents : Array.isArray(read) ? read : [read];
    const listing = options.list ? await readJson(options.list) : null;
    const resources = Array.isArray(listing?.resources) ? listing.resources : Array.isArray(listing) ? listing : listing ? [listing] : [];
    findings.push(...lintSnapshot({ contents, resources }, { uri: options.read }));
    suggestSnapshot({ contents });
  }
  if (options.html) {
    const html = await readFile(options.html, 'utf8');
    findings.push(...lintHtml(html, options.html));
    const analysis = analyzeHtml(html);
    suggest(options.html, analysis.cspNeeds, analysis.cspMentioned);
  }
  if (options.a2ui) {
    findings.push(...lintA2uiMessages(parseA2uiMessages(await readFile(options.a2ui, 'utf8')), options.a2ui));
  }
  if (options.tools) {
    const tools = await readJson(options.tools);
    findings.push(...lintTools(Array.isArray(tools?.tools) ? tools.tools : tools, options.tools));
  }

  if (options.suggestCsp) {
    const output = options.format === 'text' ? suggestionsText(suggestions, mentioned) : `${JSON.stringify(suggestions, null, 2)}\n`;
    // The JSON stays a declaration to copy; the hints go to stderr.
    if (options.format !== 'text') {
      for (const [uri, extra] of Object.entries(mentioned)) stderr.write(`mcp-app-lint: ${uri}: the script also holds ${extra.join(', ')}; the key is unknown, check whether the UI loads them\n`);
    }
    if (options.out) await writeFile(options.out, output);
    else stdout.write(output);
    return 0;
  }

  // Code scanning maps a SARIF location by a repo-relative path. A filesystem uri under the
  // working directory is made relative; ui://, npm: and tools/list locations are left as they are.
  const located = findings.map((f) => ({ ...f, uri: relativeUri(f.uri) }));

  const output = options.format === 'text' ? toText(located) : `${JSON.stringify(toSarif(located, { invocation: { commandLine: `mcp-app-lint ${redactArgv(argv).join(' ')}` } }), null, 2)}\n`;
  if (options.out) await writeFile(options.out, output);
  else stdout.write(output);

  const threshold = LEVEL_RANK[options.failOn] ?? 3;
  const worst = Math.max(0, ...located.map((f) => LEVEL_RANK[f.level ?? levelOf(f.ruleId)] ?? 0));
  return threshold > 0 && worst >= threshold ? 1 : 0;
}
