/**
 * From analysis to findings (see Finding below).
 */
import { analyzeHtml, analyzeTools, analyzeUiMeta, compareListRead, uiMetaOf, withSinkHosts } from './analyze.mjs';
import { parseDomainPattern, sinkScope } from './domains.mjs';
import { RULES } from './rules.mjs';

/**
 * @import { HtmlAnalysis } from './analyze.mjs'
 * @import { PackageScan } from './npm.mjs'
 * @import { Level } from './rules.mjs'
 */

/**
 * One result. `uri` is the SARIF artifact location: a file, a `ui://` resource, `npm:name@version`,
 * or `tools/list`. `region` points into a file, `logical` names a member of the metadata or a tool.
 * @typedef {object} Finding
 * @property {string} ruleId
 * @property {Level} [level] the rule's level when absent
 * @property {string} message
 * @property {string} uri
 * @property {{ startLine: number, startColumn?: number }} [region]
 * @property {{ name: string, kind: string }} [logical]
 * @property {Record<string, unknown>} [properties]
 */
/** @typedef {Omit<Finding, 'ruleId' | 'message' | 'uri'>} FindingExtra */
/**
 * A UI resource as a server serves it: the `_meta` of its `resources/list` entry and of its
 * `resources/read` content item, and the HTML text when there is one.
 * @typedef {object} ResourceInput
 * @property {string} uri
 * @property {unknown} [listMeta]
 * @property {unknown} [readMeta]
 * @property {string | null} [html]
 */

const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const CSP_KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'];

/**
 * @param {string} ruleId
 * @param {string} message
 * @param {string} uri
 * @param {FindingExtra} [extra]
 * @returns {Finding}
 */
const finding = (ruleId, message, uri, extra = {}) => ({ ruleId, message, uri, ...extra });

/**
 * Findings about one CSP domain entry. `extra` carries the location (logical name, or file region).
 * @param {string} key
 * @param {string} raw
 * @param {string} uri
 * @param {FindingExtra} extra
 */
function cspEntryFindings(key, raw, uri, extra) {
  /** @type {Finding[]} */
  const findings = [];
  const pattern = parseDomainPattern(raw);
  const development = DEV_HOST_RE.test(pattern.host);
  if (pattern.full) findings.push(finding('MCPAPP002', `${key} entry "${raw}" allows every host.`, uri, extra));
  else if (pattern.wildcard) findings.push(finding('MCPAPP003', `${key} entry "${raw}" allows every subdomain.`, uri, extra));
  // A loopback origin never leaves the machine; MCPAPP006 reports it as a development origin instead.
  if (pattern.insecureScheme && !development) findings.push(finding('MCPAPP004', `${key} entry "${raw}" uses ${pattern.scheme}:.`, uri, extra));
  const sink = sinkScope(pattern);
  if (sink?.scope === 'shared') findings.push(finding('MCPAPP005', `${key} entry "${raw}" is on the sink denylist (${sink.entry.category}: ${sink.entry.pattern}).`, uri, extra));
  else if (sink) findings.push(finding('MCPAPP019', `${key} entry "${raw}" names one account on a multi-tenant service (${sink.entry.category}: ${sink.entry.pattern}).`, uri, extra));
  if (development) findings.push(finding('MCPAPP006', `${key} entry "${raw}" is a development origin.`, uri, extra));
  return findings;
}

/**
 * The hosts a UI document loads from or calls, sorted and without duplicates.
 * @param {Iterable<{ externalHosts?: string[], networkHosts?: string[] }>} docs
 */
function referencedHosts(docs) {
  const hosts = new Set();
  for (const doc of docs) for (const host of [...(doc.externalHosts ?? []), ...(doc.networkHosts ?? [])]) hosts.add(host);
  return [...hosts].sort();
}

/**
 * Findings about one `_meta` object of a UI resource (the resolved one: read, falling back to list).
 * `hosts` are the hosts the UI references (see lintResource); without a CSP the host blocks them,
 * and that is MCPAPP001. A UI that references none needs no CSP: the restrictive default fits it.
 * @param {unknown} meta
 * @param {string} uri
 * @param {readonly string[]} [hosts]
 */
export function lintUiMeta(meta, uri, hosts = []) {
  /** @type {Finding[]} */
  const findings = [];
  const ui = uiMetaOf(meta);
  const analysis = analyzeUiMeta(meta);
  if (!analysis.cspDeclared) {
    if (hosts.length > 0) findings.push(cspMissing(hosts, uri));
  } else {
    for (const key of CSP_KEYS) {
      for (const raw of ui?.csp?.[key] ?? []) findings.push(...cspEntryFindings(key, raw, uri, { logical: { name: `csp.${key}`, kind: 'member' } }));
    }
  }
  for (const permission of analysis.permissions) {
    if (permission !== 'clipboardWrite') findings.push(finding('MCPAPP007', `Requests the ${permission} permission.`, uri, { logical: { name: `permissions.${permission}`, kind: 'member' } }));
  }
  return findings;
}

/**
 * @param {readonly string[]} hosts
 * @param {string} uri
 */
const cspMissing = (hosts, uri) =>
  finding('MCPAPP001', `No ui.csp declared, but the UI references ${hosts.join(', ')}; a compliant host applies default-src 'none' and blocks them.`, uri, { properties: { hosts: [...hosts] } });

/**
 * Findings about a UI resource as served: listing entry, read result content item, HTML.
 * @param {ResourceInput} resource
 */
export function lintResource({ uri, listMeta = null, readMeta = null, html = null }) {
  /** @type {Finding[]} */
  const findings = [];
  const effective = readMeta ?? listMeta;
  const analysis = typeof html === 'string' ? withSinkHosts(analyzeHtml(html)) : null;
  findings.push(...lintUiMeta(effective, uri, analysis ? referencedHosts([analysis]) : []));
  if (listMeta && readMeta) {
    const compared = compareListRead(listMeta, readMeta);
    if (compared.readWider) findings.push(finding('MCPAPP018', 'resources/read declares a wider policy than resources/list.', uri));
    else if (compared.mismatch) findings.push(finding('MCPAPP017', 'resources/read and resources/list declare different policies.', uri));
  }
  if (analysis) findings.push(...htmlFindings(analysis, uri));
  return findings;
}

/**
 * Findings about the HTML of a UI resource.
 * @param {string} html
 * @param {string} uri
 */
export function lintHtml(html, uri) {
  return htmlFindings(withSinkHosts(analyzeHtml(html)), uri);
}

/**
 * The HTML rules over one analysis, from a live document or a stored scan (older scans lack
 * positions, so every field is optional).
 * @param {Partial<HtmlAnalysis>} a
 * @param {string} uri
 */
function htmlFindings(a, uri) {
  /** @type {Finding[]} */
  const findings = [];
  if (Array.isArray(a.sinks)) {
    // Sinks whose every dynamic part goes through an escaping helper are left out (ESCAPE_FUNCTIONS in analyze.mjs).
    for (const sink of a.sinks.filter((s) => s.handwritten && !s.escaped)) findings.push(finding('MCPAPP010', sink.message, uri, { region: { startLine: sink.line, startColumn: sink.column } }));
  } else if ((a.unsafeInnerHtmlHandwritten ?? 0) > 0) {
    // A scan from before sinks carried positions: one finding per document.
    findings.push(finding('MCPAPP010', `${a.unsafeInnerHtmlHandwritten} dynamic HTML sink(s) in hand-written script.`, uri));
  }
  if (Array.isArray(a.postMessages)) {
    // The app protocol to the host (JSON-RPC, mcp-ui message types, sent to parent or top) posts to '*' by design.
    for (const call of a.postMessages.filter((c) => c.handwritten && !c.protocol)) findings.push(finding('MCPAPP011', "Hand-written postMessage(…, '*') outside the app protocol.", uri, { region: { startLine: call.line, startColumn: call.column } }));
  } else if ((a.postMessageStarHandwritten ?? 0) > 0) {
    findings.push(finding('MCPAPP011', `${a.postMessageStarHandwritten} hand-written postMessage(…, '*') call(s).`, uri));
  }
  if ((a.inlineHandlers ?? 0) > 0) findings.push(finding('MCPAPP012', `${a.inlineHandlers} inline event handler attribute(s).`, uri));
  if ((a.evalLikeHandwritten ?? 0) > 0) findings.push(finding('MCPAPP013', `${a.evalLikeHandwritten} eval/new Function use(s) in hand-written script.`, uri));
  if ((a.formsWithAction ?? 0) > 0) findings.push(finding('MCPAPP014', `${a.formsWithAction} form(s) with an action.`, uri));
  const hosts = a.externalHosts ?? [];
  if (hosts.length > 0) findings.push(finding('MCPAPP015', `References external hosts: ${hosts.join(', ')}.`, uri, { properties: { hosts } }));
  for (const host of a.sinkHosts ?? []) findings.push(finding('MCPAPP016', `References sink host ${host}.`, uri));
  return findings;
}

/**
 * Findings about the tools of a tools/list result.
 * @param {unknown} tools
 * @param {string} [uri]
 */
export function lintTools(tools, uri = 'tools/list') {
  /** @type {Finding[]} */
  const findings = [];
  for (const tool of Array.isArray(tools) ? tools : []) {
    const ui = uiMetaOf(tool?._meta);
    if (!ui) continue;
    const explicit = Array.isArray(ui.visibility);
    const visibility = explicit ? ui.visibility : ['model', 'app'];
    const logical = { name: tool.name ?? '?', kind: 'function' };
    if (!explicit && ui.resourceUri) findings.push(finding('MCPAPP009', `Tool "${tool.name}" relies on the default visibility ["model", "app"].`, uri, { logical }));
    if (visibility.includes('app') && tool?.annotations?.readOnlyHint !== true) {
      findings.push(finding('MCPAPP008', `Tool "${tool.name}" has no readOnlyHint and is callable by the app.`, uri, { logical }));
    }
  }
  return findings;
}

/**
 * Findings about a scanned package directory (see scanPackageDir). `root` prefixes file locations.
 * @param {PackageScan} scan
 * @param {string} [root]
 */
export function lintPackageScan(scan, root = '.') {
  /** @type {Finding[]} */
  const findings = [];
  // Scans that know whether the package serves a UI resource use that; older ones only knew it mentions one.
  const servesUi = scan.servesUi ?? scan.declaresUi;
  if (servesUi || (Array.isArray(scan.domainSites) && scan.domainSites.length > 0)) {
    const fake = { ui: { csp: scan.cspDeclared ? Object.fromEntries(Object.entries(scan.domains).filter(([, v]) => v.length > 0)) : undefined, permissions: Object.fromEntries(scan.permissions.map((p) => [p, {}])) } };
    if (!scan.cspDeclared) delete fake.ui.csp;
    if (Array.isArray(scan.domainSites)) {
      // Each entry where it is written, so code scanning can point at the line.
      const hosts = referencedHosts(scan.html ?? []);
      if (!scan.cspDeclared && servesUi && hosts.length > 0) findings.push(cspMissing(hosts, root));
      for (const site of scan.domainSites) findings.push(...cspEntryFindings(site.key, site.raw, `${root}/${site.file}`.replace(/^\.\//, ''), { region: { startLine: site.line } }));
      findings.push(...lintUiMeta({ ui: { csp: {}, permissions: fake.ui.permissions } }, root).filter((f) => f.ruleId === 'MCPAPP007'));
    } else {
      findings.push(...lintUiMeta(fake, root, servesUi ? referencedHosts(scan.html ?? []) : []));
    }
  }
  for (const doc of scan.html ?? []) {
    findings.push(...htmlFindings(doc, `${root}/${doc.file}`.replace(/^\.\//, '')));
  }
  return findings;
}

/**
 * The level a rule reports at; unknown ids count as warnings.
 * @param {string} ruleId
 * @returns {Level}
 */
export function levelOf(ruleId) {
  return RULES.find((r) => r.id === ruleId)?.level ?? 'warning';
}

export { analyzeTools };
