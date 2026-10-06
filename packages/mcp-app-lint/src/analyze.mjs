/**
 * Pure analysis over what a server or package declares: the `_meta.ui` of its UI resources,
 * its tools, and the HTML of the resources themselves. No network here.
 */
import { createRequire } from 'node:module';
import { classifyDomains } from './domains.mjs';

const require = createRequire(import.meta.url);

const CSP_KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'];
const PERMISSION_KEYS = ['camera', 'microphone', 'geolocation', 'clipboardWrite'];
export const UI_MIME = 'text/html;profile=mcp-app';

/** `_meta.ui` in the modern shape, or the legacy flat `ui/...` keys folded into one object. */
export function uiMetaOf(meta) {
  if (!meta || typeof meta !== 'object') return null;
  const modern = meta.ui && typeof meta.ui === 'object' ? { ...meta.ui } : {};
  for (const [key, value] of Object.entries(meta)) {
    if (key.startsWith('ui/')) modern[key.slice(3)] = value;
  }
  return Object.keys(modern).length > 0 ? modern : null;
}

export function analyzeUiMeta(meta) {
  const ui = uiMetaOf(meta);
  const csp = ui?.csp && typeof ui.csp === 'object' ? ui.csp : null;
  const domains = {};
  for (const key of CSP_KEYS) domains[key] = classifyDomains(csp?.[key]);
  const permissions = ui?.permissions && typeof ui.permissions === 'object' ? PERMISSION_KEYS.filter((k) => k in ui.permissions) : [];
  return {
    hasUiMeta: ui !== null,
    cspDeclared: csp !== null,
    cspEmpty: csp !== null && CSP_KEYS.every((k) => !Array.isArray(csp[k]) || csp[k].length === 0),
    domains,
    anyWildcard: CSP_KEYS.some((k) => domains[k].wildcards > 0),
    anyFullWildcard: CSP_KEYS.some((k) => domains[k].fullWildcards > 0),
    anyInsecure: CSP_KEYS.some((k) => domains[k].insecure > 0),
    sinks: CSP_KEYS.flatMap((k) => domains[k].sinks),
    tenantSinks: CSP_KEYS.flatMap((k) => domains[k].tenantSinks),
    permissions,
    domain: typeof ui?.domain === 'string' ? ui.domain : null,
    prefersBorder: ui?.prefersBorder === true,
  };
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}

/** Does `resources/read` declare a different policy than `resources/list`? The host that checked list is then wrong. */
export function compareListRead(listMeta, readMeta) {
  const a = uiMetaOf(listMeta);
  const b = uiMetaOf(readMeta);
  if (!a && !b) return { comparable: false, mismatch: false };
  const pick = (m) => (m ? { csp: m.csp ?? null, permissions: m.permissions ?? null, domain: m.domain ?? null } : null);
  const left = JSON.stringify(canonical(pick(a)));
  const right = JSON.stringify(canonical(pick(b)));
  const readWider = (() => {
    if (!a?.csp || !b?.csp) return false;
    return CSP_KEYS.some((k) => (b.csp[k]?.length ?? 0) > (a.csp[k]?.length ?? 0) || (b.csp[k] ?? []).some((d) => String(d).includes('*') && !(a.csp[k] ?? []).includes(d)));
  })();
  return { comparable: true, mismatch: left !== right, readWider, listOnly: !!a && !b, readOnly: !a && !!b };
}

export function analyzeTools(tools) {
  const list = Array.isArray(tools) ? tools : [];
  let withUi = 0;
  let visibleToApp = 0;
  let sideEffectsVisibleToApp = 0;
  let appOnly = 0;
  for (const tool of list) {
    const ui = uiMetaOf(tool?._meta);
    if (!ui) continue;
    if (ui.resourceUri) withUi += 1;
    const visibility = Array.isArray(ui.visibility) ? ui.visibility : ['model', 'app'];
    const app = visibility.includes('app');
    if (app) visibleToApp += 1;
    if (app && !visibility.includes('model')) appOnly += 1;
    const readOnly = tool?.annotations?.readOnlyHint === true;
    if (app && !readOnly) sideEffectsVisibleToApp += 1;
  }
  return { total: list.length, withUi, visibleToApp, appOnly, sideEffectsVisibleToApp };
}

/** Escaping helpers whose result the census treats as text: by name, not by implementation. */
export const ESCAPE_FUNCTIONS = ['esc', 'escapeHtml', 'escapeHTML', 'htmlEscape', 'escapeAttr', 'escapeHtmlAttr', 'DOMPurify.sanitize'];

let linter = null;
// The rule runs twice over each script: strict, and with ESCAPE_FUNCTIONS. A sink only the strict
// run reports gets every dynamic part through an escaping helper.
function lintInlineScript(code) {
  if (!linter) {
    const { Linter } = require('eslint');
    const plugin = require('eslint-plugin-render-policy').default;
    const instance = new Linter({ configType: 'flat' });
    const config = [
      {
        files: ['**/*.js'],
        plugins: { 'render-policy': plugin, escaped: plugin },
        rules: { 'render-policy/no-unsafe-innerhtml': 'error', 'escaped/no-unsafe-innerhtml': ['error', { escapeFunctions: ESCAPE_FUNCTIONS }] },
        languageOptions: { ecmaVersion: 2024, sourceType: 'module', parserOptions: { ecmaFeatures: { jsx: true } } },
      },
    ];
    linter = (source) => instance.verify(source, config, { filename: 'inline.js' });
  }
  return linter(code);
}

const SCRIPT_RE = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
const POST_MESSAGE_RE = /([\w$.]*)\s*\.\s*postMessage\s*\(/g;
const PROTOCOL_TARGET_RE = /(^|\.)(parent|top)$/;
// MCP Apps JSON-RPC, and the message types of the mcp-ui protocol.
const PROTOCOL_MESSAGE_RE = /\bjsonrpc\s*:|\bmethod\s*:\s*['"`]ui\/|\btype\s*:\s*['"`](ui-[a-z-]+|prompt|link|tool|intent|notify)['"`]/;

/** The argument text of a call whose opening parenthesis ends at `start`, or null if unbalanced. */
function callArguments(code, start) {
  let depth = 1;
  let quote = null;
  for (let i = start; i < code.length && i < start + 20000; i += 1) {
    const c = code[i];
    if (quote) {
      if (c === '\\') i += 1;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(' || c === '{' || c === '[') depth += 1;
    else if (c === ')' || c === '}' || c === ']') {
      depth -= 1;
      if (depth === 0) return code.slice(start, i);
    }
  }
  return null;
}

/** postMessage calls whose target origin is '*', with position and whether they carry the app protocol to the host. */
export function postMessageStarCalls(code) {
  const calls = [];
  for (const match of code.matchAll(POST_MESSAGE_RE)) {
    const args = callArguments(code, match.index + match[0].length);
    if (args === null || !/,\s*['"`]\*['"`]\s*(,[^,]*)?,?\s*$/.test(args)) continue;
    const before = code.slice(0, match.index);
    const line = before.split('\n').length;
    const column = match.index - before.lastIndexOf('\n');
    calls.push({ line, column, protocol: PROTOCOL_TARGET_RE.test(match[1]) && PROTOCOL_MESSAGE_RE.test(args) });
  }
  return calls;
}
const URL_ATTR_RE = /\b(?:src|href|action|poster|data)\s*=\s*["']([^"']+)["']/gi;

/** Static signals in a UI resource's HTML. Heuristic by design; the report says so. */
export function analyzeHtml(html) {
  const text = String(html ?? '');
  const result = {
    bytes: text.length,
    inlineScripts: 0,
    handwrittenScripts: 0,
    externalScripts: [],
    unsafeInnerHtml: 0,
    unsafeInnerHtmlHandwritten: 0,
    evalLikeHandwritten: 0,
    postMessageStarHandwritten: 0,
    postMessageStarHandwrittenNonProtocol: 0,
    unsafeInnerHtmlHandwrittenUnescaped: 0,
    postMessages: [],
    lintErrors: 0,
    unparsedScripts: 0,
    inlineHandlers: (text.match(/\son[a-z]+\s*=/gi) ?? []).length,
    sinks: [],
    evalLike: (text.match(/\beval\s*\(|new\s+Function\s*\(/g) ?? []).length,
    postMessageStar: (text.match(/postMessage\s*\([^)]*['"]\*['"]/g) ?? []).length,
    forms: (text.match(/<form\b/gi) ?? []).length,
    formsWithAction: (text.match(/<form\b[^>]*\baction\s*=/gi) ?? []).length,
    metaCsp: /<meta\b[^>]*http-equiv\s*=\s*["']content-security-policy["']/i.test(text),
    externalHosts: [],
    sinkHosts: [],
  };
  const hosts = new Set();
  for (const match of text.matchAll(URL_ATTR_RE)) {
    const value = match[1];
    if (!/^(https?:)?\/\//i.test(value)) continue;
    try {
      hosts.add(new URL(value.startsWith('//') ? `https:${value}` : value).hostname.toLowerCase());
    } catch {
      /* ignore */
    }
  }
  result.externalHosts = [...hosts].sort();
  for (const match of text.matchAll(SCRIPT_RE)) {
    const attrs = match[1] ?? '';
    const body = match[2] ?? '';
    const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1];
    if (src) {
      result.externalScripts.push(src);
      continue;
    }
    const type = /\btype\s*=\s*["']([^"']+)["']/i.exec(attrs)?.[1]?.toLowerCase();
    if (type && !/javascript|module|ecmascript/.test(type)) continue;
    result.inlineScripts += 1;
    // A bundled or minified script mostly carries framework internals; "handwritten" scripts
    // (short lines, few of them) are what the app author wrote and can change.
    const handwritten = isHandwritten(body);
    if (handwritten) {
      result.handwrittenScripts += 1;
      result.evalLikeHandwritten += (body.match(/\beval\s*\(|new\s+Function\s*\(/g) ?? []).length;
      result.postMessageStarHandwritten += (body.match(/postMessage\s*\([^)]*['"]\*['"]/g) ?? []).length;
    }
    const scriptLine = text.slice(0, match.index).split('\n').length + (match[0].slice(0, match[0].indexOf('>') + 1).split('\n').length - 1);
    for (const call of postMessageStarCalls(body)) {
      result.postMessages.push({ ...call, line: scriptLine + call.line - 1, handwritten });
      if (handwritten && !call.protocol) result.postMessageStarHandwrittenNonProtocol += 1;
    }
    try {
      const messages = lintInlineScript(body);
      const fatal = messages.filter((m) => m.fatal);
      if (fatal.length > 0) {
        result.unparsedScripts += 1;
        continue;
      }
      const hits = messages.filter((m) => m.ruleId === 'render-policy/no-unsafe-innerhtml');
      const unescaped = new Set(messages.filter((m) => m.ruleId === 'escaped/no-unsafe-innerhtml').map((m) => `${m.line}:${m.column}`));
      result.unsafeInnerHtml += hits.length;
      for (const hit of hits) {
        const escaped = !unescaped.has(`${hit.line}:${hit.column}`);
        if (handwritten) result.unsafeInnerHtmlHandwritten += 1;
        if (handwritten && !escaped) result.unsafeInnerHtmlHandwrittenUnescaped += 1;
        result.sinks.push({ line: scriptLine + hit.line - 1, column: hit.column, handwritten, escaped, message: hit.message });
      }
    } catch {
      result.unparsedScripts += 1;
    }
  }
  return result;
}

/** Short lines and not too many of them: written by a person, not emitted by a bundler. */
export function isHandwritten(code) {
  const lines = code.split('\n');
  const longest = Math.max(0, ...lines.map((l) => l.length));
  const average = code.length / Math.max(1, lines.length);
  return longest < 2000 && average < 200 && lines.length < 3000;
}

/** Everything the HTML analysis reports about hosts, joined with the sink denylist. */
export function withSinkHosts(analysis) {
  const { sinkFor } = require('./domains.mjs');
  return { ...analysis, sinkHosts: analysis.externalHosts.filter((h) => sinkFor(h) !== null) };
}
