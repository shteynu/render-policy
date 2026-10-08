export { lintA2uiMessages, parseA2uiMessages } from './a2ui.mjs';
export { analyzeHtml, analyzeTools, analyzeUiMeta, compareListRead, ESCAPE_FUNCTIONS, isHandwritten, postMessageStarCalls, UI_MIME, uiMetaOf, withSinkHosts } from './analyze.mjs';
export { categorizeDomain, categorizeHost, classifyDomains, DOMAIN_CATEGORIES, parseDomainPattern, sinkFor, sinkScope } from './domains.mjs';
export { levelOf, lintHtml, lintPackageScan, lintResource, lintTools, lintUiMeta } from './lint.mjs';
export { downloadTarball, extractTarball, packageMeta, scanPackage, scanPackageDir, searchPackages, UI_SDKS } from './npm.mjs';
export { RULES, RULE_INDEX, ruleByName } from './rules.mjs';
export { toSarif, toText, TOOL_VERSION } from './sarif.mjs';
export { run } from './cli.mjs';

/**
 * @typedef {import('./a2ui.mjs').A2uiEntry} A2uiEntry
 * @typedef {import('./analyze.mjs').UiMeta} UiMeta
 * @typedef {import('./analyze.mjs').CspKey} CspKey
 * @typedef {import('./analyze.mjs').HtmlAnalysis} HtmlAnalysis
 * @typedef {import('./analyze.mjs').HtmlSink} HtmlSink
 * @typedef {import('./analyze.mjs').PostMessageCall} PostMessageCall
 * @typedef {import('./domains.mjs').DomainPattern} DomainPattern
 * @typedef {import('./domains.mjs').DomainCategory} DomainCategory
 * @typedef {import('./domains.mjs').ClassifiedDomains} ClassifiedDomains
 * @typedef {import('./domains.mjs').SinkScope} SinkScope
 * @typedef {import('./lint.mjs').Finding} Finding
 * @typedef {import('./lint.mjs').ResourceInput} ResourceInput
 * @typedef {import('./npm.mjs').PackageMeta} PackageMeta
 * @typedef {import('./npm.mjs').PackageScan} PackageScan
 * @typedef {import('./npm.mjs').ScanOptions} ScanOptions
 * @typedef {import('./npm.mjs').DomainSite} DomainSite
 * @typedef {import('./rules.mjs').Rule} Rule
 * @typedef {import('./rules.mjs').Level} Level
 */
