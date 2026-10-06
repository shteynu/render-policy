/**
 * From analysis to findings. A finding is { ruleId, level?, message, uri, region?, logical?, properties? }.
 */
import { analyzeHtml, analyzeTools, analyzeUiMeta, compareListRead, uiMetaOf, withSinkHosts } from './analyze.mjs';
import { parseDomainPattern, sinkScope } from './domains.mjs';
import { RULES } from './rules.mjs';

const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i;
const CSP_KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'];

const finding = (ruleId, message, uri, extra = {}) => ({ ruleId, message, uri, ...extra });

/** Findings about one CSP domain entry. `extra` carries the location (logical name, or file region). */
function cspEntryFindings(key, raw, uri, extra) {
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

/** Findings about one `_meta.ui` object (the resolved one: read, falling back to list). */
export function lintUiMeta(meta, uri) {
  const findings = [];
  const ui = uiMetaOf(meta);
  const analysis = analyzeUiMeta(meta);
  if (!analysis.cspDeclared) {
    findings.push(finding('MCPAPP001', 'No ui.csp declared; a compliant host applies default-src \'none\'.', uri));
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

/** Findings about a UI resource as served: listing entry, read result content item, HTML. */
export function lintResource({ uri, listMeta = null, readMeta = null, html = null }) {
  const findings = [];
  const effective = readMeta ?? listMeta;
  findings.push(...lintUiMeta(effective, uri));
  if (listMeta && readMeta) {
    const compared = compareListRead(listMeta, readMeta);
    if (compared.readWider) findings.push(finding('MCPAPP018', 'resources/read declares a wider policy than resources/list.', uri));
    else if (compared.mismatch) findings.push(finding('MCPAPP017', 'resources/read and resources/list declare different policies.', uri));
  }
  if (typeof html === 'string') findings.push(...lintHtml(html, uri));
  return findings;
}

/** Findings about the HTML of a UI resource. */
export function lintHtml(html, uri) {
  return htmlFindings(withSinkHosts(analyzeHtml(html)), uri);
}

/** The HTML rules over one analysis, from a live document or a stored scan. */
function htmlFindings(a, uri) {
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
  if ((a.externalHosts?.length ?? 0) > 0) findings.push(finding('MCPAPP015', `References external hosts: ${a.externalHosts.join(', ')}.`, uri, { properties: { hosts: a.externalHosts } }));
  for (const host of a.sinkHosts ?? []) findings.push(finding('MCPAPP016', `References sink host ${host}.`, uri));
  return findings;
}

/** Findings about a tools/list result. */
export function lintTools(tools, uri = 'tools/list') {
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

/** Findings about a scanned package directory (see scanPackageDir). */
export function lintPackageScan(scan, root = '.') {
  const findings = [];
  // Scans that know whether the package serves a UI resource use that; older ones only knew it mentions one.
  const servesUi = scan.servesUi ?? scan.declaresUi;
  if (servesUi || (Array.isArray(scan.domainSites) && scan.domainSites.length > 0)) {
    const fake = { ui: { csp: scan.cspDeclared ? Object.fromEntries(Object.entries(scan.domains).filter(([, v]) => v.length > 0)) : undefined, permissions: Object.fromEntries(scan.permissions.map((p) => [p, {}])) } };
    if (!scan.cspDeclared) delete fake.ui.csp;
    if (Array.isArray(scan.domainSites)) {
      // Each entry where it is written, so code scanning can point at the line.
      if (!scan.cspDeclared && servesUi) findings.push(...lintUiMeta({ ui: {} }, root));
      for (const site of scan.domainSites) findings.push(...cspEntryFindings(site.key, site.raw, `${root}/${site.file}`.replace(/^\.\//, ''), { region: { startLine: site.line } }));
      findings.push(...lintUiMeta({ ui: { csp: {}, permissions: fake.ui.permissions } }, root).filter((f) => f.ruleId === 'MCPAPP007'));
    } else {
      findings.push(...lintUiMeta(fake, root));
    }
  }
  for (const doc of scan.html ?? []) {
    findings.push(...htmlFindings(doc, `${root}/${doc.file}`.replace(/^\.\//, '')));
  }
  return findings;
}

export function levelOf(ruleId) {
  return RULES.find((r) => r.id === ruleId)?.level ?? 'warning';
}

export { analyzeTools };
