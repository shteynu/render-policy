/**
 * Building blocks the public entry does not expose: `@render-policy/core/internal`.
 * They exist for this repository's tests and proofs and for integrators who need the
 * pieces rather than the renderer. They are not covered by semver.
 */
export { patchChildren } from './dom.js';
export { createSanitizer } from './sanitize.js';
export type { SanitizeOutcome, Sanitizer } from './sanitize.js';
export { createRenderStream } from './stream.js';
export type { StreamRenderOps } from './stream.js';
export { checkUrlHeuristics, normalizeUrl, shannonEntropy, usableBase } from './url.js';
