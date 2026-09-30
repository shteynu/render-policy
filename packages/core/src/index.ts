export { createRenderer } from './render.js';
export type { FragmentResult, RenderResult, RenderTarget, Renderer, RendererOptions } from './render.js';

export { DEFAULT_MODE, DEFAULT_URL_HEURISTICS, MODE_PRESETS, resolvePolicy } from './policy.js';
export type { HostPattern, ImageHosts, RenderMode, RenderPolicy, UrlHeuristics } from './policy.js';

export type { DecisionKind, DecisionSubject, RenderDecision } from './decisions.js';

export { createSanitizer } from './sanitize.js';
export type { SanitizeOutcome, Sanitizer } from './sanitize.js';

export { createMarkdownRenderer } from './markdown.js';
export type { MarkdownOptions, MarkdownRenderer } from './markdown.js';

export { closeOpenFences, createRenderStream, frameScheduler, holdIncompleteHtml, holdIncompleteMarkdown } from './stream.js';
export type { RenderStream, Scheduler, StreamOptions, StreamRenderOps } from './stream.js';

export { checkUrl, checkUrlHeuristics, hostMatches, normalizeUrl, shannonEntropy } from './url.js';
export type { ParsedUrl, UrlVerdict } from './url.js';

export { matchSink, mergeSinkDenylists } from './sinks.js';
export type { SinkCategory, SinkDenylist, SinkEntry } from './sinks.js';

export { SINK_DENYLIST } from './data/sink-domains.js';
