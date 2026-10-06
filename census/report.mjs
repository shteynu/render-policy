/**
 * Aggregates over the collected data into census/SUMMARY.md and census/data/summary.json.
 * No server or package is named: findings are counts and shares.
 *   node census/report.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { categorizeHost, classifyDomains, DOMAIN_CATEGORIES, lintPackageScan, RULES } from 'mcp-app-lint';
import { censusRoot, dataDir, latestByName, readJsonl } from './lib/io.mjs';

const CSP_KEYS = ['connectDomains', 'resourceDomains', 'frameDomains', 'baseUriDomains'];

const pct = (part, whole) => (whole ? `${((100 * part) / whole).toFixed(0)}%` : 'n/a');
const count = (items, predicate) => items.filter(predicate).length;
const tally = (items, key) => {
  const map = {};
  for (const item of items) for (const value of key(item)) map[value] = (map[value] ?? 0) + 1;
  return Object.fromEntries(Object.entries(map).sort((a, b) => b[1] - a[1]));
};

const summary = { generatedAt: new Date().toISOString() };
const lines = ['# MCP Apps UI census: summary', '', `Generated ${summary.generatedAt.slice(0, 10)} by \`census/report.mjs\`. Aggregates only; see \`census/README.md\` for method and limits.`, ''];

let registry = null;
try {
  registry = JSON.parse(await readFile(path.join(dataDir, 'registry.json'), 'utf8'));
} catch {
  /* no snapshot */
}
if (registry) {
  const s = registry.servers;
  summary.registry = {
    collectedAt: registry.collectedAt,
    entries: registry.total,
    servers: registry.latest,
    withRemotes: count(s, (x) => x.remotes.length > 0),
    withStreamableHttp: count(s, (x) => x.remotes.some((r) => r.type === 'streamable-http')),
    withSse: count(s, (x) => x.remotes.some((r) => r.type === 'sse')),
    withPackages: count(s, (x) => x.packages.length > 0),
    packageRegistries: registry.packageRegistries,
  };
  const r = summary.registry;
  lines.push('## Registry composition', '', `Snapshot ${registry.collectedAt.slice(0, 10)} of registry.modelcontextprotocol.io.`, '', '| Measure | Count |', '| --- | --- |',
    `| servers (latest version of each) | ${r.servers} |`, `| with a remote endpoint | ${r.withRemotes} (${pct(r.withRemotes, r.servers)}) |`,
    `| remote: streamable-http | ${r.withStreamableHttp} |`, `| remote: sse (legacy) | ${r.withSse} |`, `| with a package (stdio) | ${r.withPackages} (${pct(r.withPackages, r.servers)}) |`,
    `| package registries | ${Object.entries(r.packageRegistries).map(([k, v]) => `${k} ${v}`).join(', ')} |`, '');
}

const npm = await readJsonl(path.join(dataDir, 'npm-packages.jsonl'));
if (npm.length > 0) {
  const meta = npm.filter((p) => !p.error);
  const sdk = meta.filter((p) => p.uiSdks?.length > 0);
  const scanned = sdk.filter((p) => p.scan?.ok);
  const declaring = scanned.filter((p) => p.scan.declaresUi);
  const withCsp = declaring.filter((p) => p.scan.cspDeclared);
  // Classify from the raw domain lists when the scan kept them, so the report follows the
  // current classifier without a rescan; older scans only carry the classification.
  const classified = new Map(withCsp.map((p) => [p, p.scan.domains ? Object.fromEntries(Object.entries(p.scan.domains).map(([k, v]) => [k, classifyDomains(v)])) : p.scan.domainsClassified]));
  const lists = (p) => Object.values(classified.get(p));
  const anyWild = (p) => lists(p).some((d) => d.wildcards > 0);
  const anyFull = (p) => lists(p).some((d) => d.fullWildcards > 0);
  const anyInsecure = (p) => lists(p).some((d) => d.insecure > 0);
  const anySink = (p) => lists(p).some((d) => d.sinks.length > 0);
  const anyTenantSink = (p) => lists(p).some((d) => (d.tenantSinks ?? []).length > 0);
  const categories = Object.fromEntries(DOMAIN_CATEGORIES.map((c) => [c, { packages: 0, entries: 0, byList: Object.fromEntries(CSP_KEYS.map((k) => [k, 0])) }]));
  let cspEntries = 0;
  const cspHosts = new Set();
  for (const p of withCsp) {
    const seen = new Set();
    for (const [key, d] of Object.entries(classified.get(p))) {
      cspEntries += d.count;
      d.hosts.forEach((h) => h && cspHosts.add(h));
      (d.categories ?? []).forEach((c) => {
        categories[c].entries += 1;
        categories[c].byList[key] = (categories[c].byList[key] ?? 0) + 1;
        seen.add(c);
      });
    }
    for (const c of seen) categories[c].packages += 1;
  }
  const ruleHits = Object.fromEntries(RULES.map((r) => [r.id, { name: r.name, level: r.level, packages: 0, findings: 0 }]));
  for (const p of scanned) {
    const seen = new Set();
    for (const f of lintPackageScan(p.scan, '.')) {
      ruleHits[f.ruleId].findings += 1;
      seen.add(f.ruleId);
    }
    for (const id of seen) ruleHits[id].packages += 1;
  }
  const htmlDocs = scanned.flatMap((p) => p.scan.html);
  const htmlHostCategories = Object.fromEntries(DOMAIN_CATEGORIES.map((c) => [c, 0]));
  for (const h of htmlDocs) for (const c of new Set((h.externalHosts ?? []).map(categorizeHost))) htmlHostCategories[c] += 1;
  summary.npm = {
    candidates: npm.length,
    metadataOk: meta.length,
    usingUiSdk: sdk.length,
    bySdk: tally(sdk, (p) => p.uiSdks),
    scanned: scanned.length,
    declaringUiResources: declaring.length,
    cspDeclared: withCsp.length,
    cspWithWildcard: count(withCsp, anyWild),
    cspWithFullWildcard: count(withCsp, anyFull),
    cspWithInsecureScheme: count(withCsp, anyInsecure),
    cspWithSinkHost: count(withCsp, anySink),
    cspWithTenantSinkHost: count(withCsp, anyTenantSink),
    cspEntries,
    cspDistinctHosts: cspHosts.size,
    cspCategories: categories,
    htmlExternalHostCategories: htmlHostCategories,
    lintFindings: ruleHits,
    permissions: tally(declaring, (p) => p.scan.permissions),
    toolsVisibleToApp: count(declaring, (p) => p.scan.toolVisibility.app > 0),
    htmlDocuments: htmlDocs.length,
    htmlWithInlineScripts: count(htmlDocs, (h) => h.inlineScripts > 0),
    htmlWithHandwrittenScripts: count(htmlDocs, (h) => (h.handwrittenScripts ?? 0) > 0),
    htmlWithUnsafeInnerHtml: count(htmlDocs, (h) => h.unsafeInnerHtml > 0),
    htmlWithUnsafeInnerHtmlHandwritten: count(htmlDocs, (h) => (h.unsafeInnerHtmlHandwritten ?? 0) > 0),
    htmlWithPostMessageStar: count(htmlDocs, (h) => h.postMessageStar > 0),
    htmlWithPostMessageStarHandwritten: count(htmlDocs, (h) => (h.postMessageStarHandwritten ?? 0) > 0),
    htmlWithInlineHandlers: count(htmlDocs, (h) => h.inlineHandlers > 0),
    htmlWithEval: count(htmlDocs, (h) => h.evalLike > 0),
    htmlWithEvalHandwritten: count(htmlDocs, (h) => (h.evalLikeHandwritten ?? 0) > 0),
    htmlWithExternalHosts: count(htmlDocs, (h) => h.externalHosts.length > 0),
    htmlWithSinkHosts: count(htmlDocs, (h) => h.sinkHosts.length > 0),
    htmlWithFormsAction: count(htmlDocs, (h) => h.formsWithAction > 0),
    htmlWithMetaCsp: count(htmlDocs, (h) => h.metaCsp),
    errors: tally(npm.filter((p) => p.error), (p) => [p.error.kind]),
  };
  const n = summary.npm;
  lines.push('## Static census over npm packages', '',
    `Candidates come from npm keyword searches and the npm packages named in the registry. Tarballs were downloaded and scanned only for packages that depend on a UI SDK (${Object.keys(n.bySdk).join(', ') || 'none found'}). "Declaring UI resources" means the source registers an app resource, mentions the \`text/html;profile=mcp-app\` MIME type or a \`ui://\` URI.`, '',
    '| Measure | Count |', '| --- | --- |',
    `| candidate packages | ${n.candidates} |`, `| depending on a UI SDK | ${n.usingUiSdk} (${Object.entries(n.bySdk).map(([k, v]) => `${k} ${v}`).join(', ')}) |`,
    `| scanned (tarball downloaded) | ${n.scanned} |`, `| declaring UI resources | ${n.declaringUiResources} |`,
    `| of which declare a CSP (any domain list) | ${n.cspDeclared} (${pct(n.cspDeclared, n.declaringUiResources)}) |`,
    `| CSP with a wildcard domain | ${n.cspWithWildcard} (${pct(n.cspWithWildcard, n.cspDeclared)} of declared) |`,
    `| CSP with a full wildcard (\`*\`) | ${n.cspWithFullWildcard} |`, `| CSP with an http: domain | ${n.cspWithInsecureScheme} |`,
    `| CSP naming a sink host anyone can use (denylist) | ${n.cspWithSinkHost} |`, `| CSP naming one account on a storage or serverless service from the denylist | ${n.cspWithTenantSinkHost} |`,
    `| requesting sandbox permissions | ${Object.entries(n.permissions).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} |`,
    `| tools declared visible to the app | ${n.toolsVisibleToApp} packages |`, '',
    '### What the declared domains are', '',
    `${n.cspEntries} entries (${n.cspDistinctHosts} distinct hosts) across the ${n.cspDeclared} packages that declare a list, by a heuristic category of the host (\`categorizeDomain\` in mcp-app-lint; a host fits the first category listed). A package counts once per category.`, '',
    '| Category | Packages | Entries | connect | resource | frame | base-uri |', '| --- | --- | --- | --- | --- | --- | --- |',
    ...DOMAIN_CATEGORIES.filter((c) => n.cspCategories[c].entries > 0).map((c) => `| ${c} | ${n.cspCategories[c].packages} | ${n.cspCategories[c].entries} | ${CSP_KEYS.map((k) => n.cspCategories[c].byList[k] ?? 0).join(' | ')} |`), '',
    '### The HTML of the UI resources', '', '| Measure | Count |', '| --- | --- |',
    `| HTML documents found (files and embedded) | ${n.htmlDocuments} |`, `| with inline scripts | ${n.htmlWithInlineScripts} (${n.htmlWithHandwrittenScripts} with a handwritten script, the rest bundles) |`,
    `| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | ${n.htmlWithUnsafeInnerHtml} in any script; ${n.htmlWithUnsafeInnerHtmlHandwritten} in handwritten scripts (${pct(n.htmlWithUnsafeInnerHtmlHandwritten, n.htmlWithHandwrittenScripts)} of those) |`,
    `| with postMessage(…, '*') | ${n.htmlWithPostMessageStar} in any script (the MCP Apps SDK bridge posts to '*' by design, so bundles count the SDK); ${n.htmlWithPostMessageStarHandwritten} in handwritten scripts |`,
    `| with inline event handlers | ${n.htmlWithInlineHandlers} |`, `| with eval or new Function | ${n.htmlWithEval} in any script; ${n.htmlWithEvalHandwritten} in handwritten scripts |`,
    `| loading from external hosts | ${n.htmlWithExternalHosts} (${DOMAIN_CATEGORIES.filter((c) => n.htmlExternalHostCategories[c] > 0).map((c) => `${c} ${n.htmlExternalHostCategories[c]}`).join(', ') || 'none'}) |`, `| referencing a sink host | ${n.htmlWithSinkHosts} |`, `| with a form that posts somewhere | ${n.htmlWithFormsAction} |`,
    `| with a CSP meta tag of its own | ${n.htmlWithMetaCsp} |`, '',
    `Metadata errors: ${Object.entries(n.errors).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`, '',
    '### What mcp-app-lint reports over the same packages', '',
    `The scanner's rules run over the ${n.scanned} scanned packages from the stored scans (static data, so MCPAPP008/009 on tools and MCPAPP017/018 on list/read differences, which need a live server, do not occur here). "Packages" is packages with at least one finding of the rule.`, '',
    '| Rule | Level | Packages | Findings |', '| --- | --- | --- | --- |',
    ...Object.entries(n.lintFindings).filter(([, r]) => r.findings > 0).map(([id, r]) => `| ${id} ${r.name} | ${r.level} | ${r.packages} | ${r.findings} |`), '');
}

const remote = latestByName(await readJsonl(path.join(dataDir, 'remote-servers.jsonl')));
if (remote.length > 0) {
  const reachable = remote.filter((r) => !r.error);
  const withUi = reachable.filter((r) => (r.uiResourceCount ?? 0) > 0);
  const entries = withUi.flatMap((r) => r.uiResources);
  const declared = entries.filter((e) => e.list.cspDeclared || e.read?.cspDeclared);
  // Re-classify from the hosts each scan kept, so the report follows the current classifier.
  const sides = (e) => [e.list, e.read].filter((side) => side?.domains).flatMap((side) => Object.values(side.domains).map((d) => classifyDomains(d.hosts)));
  const hasSink = (e) => sides(e).some((d) => d.sinks.length > 0);
  const hasTenantSink = (e) => sides(e).some((d) => d.tenantSinks.length > 0);
  const servers = (predicate) => count(withUi, (r) => r.uiResources.some(predicate));
  summary.remote = {
    probed: remote.length,
    reachable: reachable.length,
    failures: tally(remote.filter((r) => r.error), (r) => [r.error.kind]),
    withUiResources: withUi.length,
    uiResourcesSeen: entries.length,
    mcpAppMime: count(entries, (e) => e.isMcpApp),
    cspDeclared: declared.length,
    cspWithWildcard: count(declared, (e) => e.list.anyWildcard || e.read?.anyWildcard),
    cspWithFullWildcard: count(declared, (e) => e.list.anyFullWildcard || e.read?.anyFullWildcard),
    cspWithSinkHost: count(declared, hasSink),
    cspWithSinkHostServers: servers(hasSink),
    cspWithTenantSinkHost: count(declared, hasTenantSink),
    cspWithTenantSinkHostServers: servers(hasTenantSink),
    listReadComparable: count(entries, (e) => e.listVsRead?.comparable),
    listReadMismatch: count(entries, (e) => e.listVsRead?.mismatch),
    listReadWider: count(entries, (e) => e.listVsRead?.readWider),
    listReadWiderServers: servers((e) => e.listVsRead?.readWider),
    htmlWithUnsafeInnerHtml: count(entries, (e) => (e.html?.unsafeInnerHtml ?? 0) > 0),
    htmlWithPostMessageStar: count(entries, (e) => (e.html?.postMessageStar ?? 0) > 0),
    toolsSideEffectsVisibleToApp: count(withUi, (r) => (r.tools?.sideEffectsVisibleToApp ?? 0) > 0),
  };
  const m = summary.remote;
  lines.push('## Protocol census over remote servers', '', 'Read-only: initialize, resources/list, resources/read of UI resources, tools/list. No tool was called. Servers that require authentication were not probed further. From "declaring a CSP" down, rows count UI resources unless they say servers.', '',
    '| Measure | Count |', '| --- | --- |',
    `| servers probed | ${m.probed} |`, `| reachable and speaking MCP | ${m.reachable} |`, `| failures | ${Object.entries(m.failures).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} |`,
    `| with UI resources | ${m.withUiResources} |`, `| UI resources read | ${m.uiResourcesSeen} (${m.mcpAppMime} with the MCP Apps MIME type) |`,
    `| declaring a CSP | ${m.cspDeclared} (${pct(m.cspDeclared, m.uiResourcesSeen)}) |`, `| CSP with a wildcard | ${m.cspWithWildcard} |`, `| CSP with a full wildcard | ${m.cspWithFullWildcard} |`, `| CSP naming a sink host anyone can use | ${m.cspWithSinkHost} on ${m.cspWithSinkHostServers} servers |`, `| CSP naming one account on a storage or serverless service from the denylist | ${m.cspWithTenantSinkHost} on ${m.cspWithTenantSinkHostServers} servers |`,
    `| list vs read policy differs | ${m.listReadMismatch} of ${m.listReadComparable} comparable (${m.listReadWider} where read is wider, on ${m.listReadWiderServers} servers) |`,
    `| HTML with a dynamic innerHTML sink | ${m.htmlWithUnsafeInnerHtml} |`, `| HTML with postMessage(…, '*') | ${m.htmlWithPostMessageStar} |`,
    `| servers with side-effect tools visible to the app | ${m.toolsSideEffectsVisibleToApp} |`, '');
}

await writeFile(path.join(censusRoot, 'SUMMARY.md'), lines.join('\n'));
await writeFile(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(lines.join('\n'));
