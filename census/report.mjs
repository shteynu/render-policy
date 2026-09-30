/**
 * Aggregates over the collected data into census/SUMMARY.md and census/data/summary.json.
 * No server or package is named: findings are counts and shares.
 *   node census/report.mjs
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { censusRoot, dataDir, readJsonl } from './lib/io.mjs';

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
    `| entries (all versions) | ${r.entries} |`, `| servers (latest version each) | ${r.servers} |`, `| with a remote endpoint | ${r.withRemotes} (${pct(r.withRemotes, r.servers)}) |`,
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
  const anyWild = (p) => Object.values(p.scan.domainsClassified).some((d) => d.wildcards > 0);
  const anyFull = (p) => Object.values(p.scan.domainsClassified).some((d) => d.fullWildcards > 0);
  const anyInsecure = (p) => Object.values(p.scan.domainsClassified).some((d) => d.insecure > 0);
  const anySink = (p) => Object.values(p.scan.domainsClassified).some((d) => d.sinks.length > 0);
  const htmlDocs = scanned.flatMap((p) => p.scan.html);
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
    permissions: tally(declaring, (p) => p.scan.permissions),
    toolsVisibleToApp: count(declaring, (p) => p.scan.toolVisibility.app > 0),
    htmlDocuments: htmlDocs.length,
    htmlWithInlineScripts: count(htmlDocs, (h) => h.inlineScripts > 0),
    htmlWithUnsafeInnerHtml: count(htmlDocs, (h) => h.unsafeInnerHtml > 0),
    htmlWithPostMessageStar: count(htmlDocs, (h) => h.postMessageStar > 0),
    htmlWithInlineHandlers: count(htmlDocs, (h) => h.inlineHandlers > 0),
    htmlWithEval: count(htmlDocs, (h) => h.evalLike > 0),
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
    `| CSP naming a sink host (denylist) | ${n.cspWithSinkHost} |`,
    `| requesting sandbox permissions | ${Object.entries(n.permissions).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} |`,
    `| tools declared visible to the app | ${n.toolsVisibleToApp} packages |`, '',
    '### The HTML of the UI resources', '', '| Measure | Count |', '| --- | --- |',
    `| HTML documents found (files and embedded) | ${n.htmlDocuments} |`, `| with inline scripts | ${n.htmlWithInlineScripts} |`,
    `| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | ${n.htmlWithUnsafeInnerHtml} (${pct(n.htmlWithUnsafeInnerHtml, n.htmlWithInlineScripts)} of those with inline scripts) |`,
    `| with postMessage(…, '*') | ${n.htmlWithPostMessageStar} |`, `| with inline event handlers | ${n.htmlWithInlineHandlers} |`, `| with eval or new Function | ${n.htmlWithEval} |`,
    `| loading from external hosts | ${n.htmlWithExternalHosts} |`, `| referencing a sink host | ${n.htmlWithSinkHosts} |`, `| with a form that posts somewhere | ${n.htmlWithFormsAction} |`,
    `| with a CSP meta tag of its own | ${n.htmlWithMetaCsp} |`, '',
    `Metadata errors: ${Object.entries(n.errors).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}.`, '');
}

const remote = await readJsonl(path.join(dataDir, 'remote-servers.jsonl'));
if (remote.length > 0) {
  const reachable = remote.filter((r) => !r.error);
  const withUi = reachable.filter((r) => (r.uiResourceCount ?? 0) > 0);
  const entries = withUi.flatMap((r) => r.uiResources);
  const declared = entries.filter((e) => e.list.cspDeclared || e.read?.cspDeclared);
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
    cspWithSinkHost: count(declared, (e) => e.list.sinks.length > 0 || (e.read?.sinks.length ?? 0) > 0),
    listReadComparable: count(entries, (e) => e.listVsRead?.comparable),
    listReadMismatch: count(entries, (e) => e.listVsRead?.mismatch),
    listReadWider: count(entries, (e) => e.listVsRead?.readWider),
    htmlWithUnsafeInnerHtml: count(entries, (e) => (e.html?.unsafeInnerHtml ?? 0) > 0),
    htmlWithPostMessageStar: count(entries, (e) => (e.html?.postMessageStar ?? 0) > 0),
    toolsSideEffectsVisibleToApp: count(withUi, (r) => (r.tools?.sideEffectsVisibleToApp ?? 0) > 0),
  };
  const m = summary.remote;
  lines.push('## Protocol census over remote servers', '', 'Read-only: initialize, resources/list, resources/read of UI resources, tools/list. No tool was called. Servers that require authentication were not probed further.', '',
    '| Measure | Count |', '| --- | --- |',
    `| servers probed | ${m.probed} |`, `| reachable and speaking MCP | ${m.reachable} |`, `| failures | ${Object.entries(m.failures).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'} |`,
    `| with UI resources | ${m.withUiResources} |`, `| UI resources read | ${m.uiResourcesSeen} (${m.mcpAppMime} with the MCP Apps MIME type) |`,
    `| declaring a CSP | ${m.cspDeclared} (${pct(m.cspDeclared, m.uiResourcesSeen)}) |`, `| CSP with a wildcard | ${m.cspWithWildcard} |`, `| CSP with a full wildcard | ${m.cspWithFullWildcard} |`, `| CSP naming a sink host | ${m.cspWithSinkHost} |`,
    `| list vs read policy differs | ${m.listReadMismatch} of ${m.listReadComparable} comparable (${m.listReadWider} where read is wider) |`,
    `| HTML with a dynamic innerHTML sink | ${m.htmlWithUnsafeInnerHtml} |`, `| HTML with postMessage(…, '*') | ${m.htmlWithPostMessageStar} |`,
    `| servers with side-effect tools visible to the app | ${m.toolsSideEffectsVisibleToApp} |`, '');
}

await writeFile(path.join(censusRoot, 'SUMMARY.md'), lines.join('\n'));
await writeFile(path.join(dataDir, 'summary.json'), JSON.stringify(summary, null, 2));
console.log(lines.join('\n'));
