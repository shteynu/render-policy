/**
 * A RenderPolicy is the single place where an application decides what
 * agent-generated content may do once it reaches the DOM.
 *
 * Sanitization (no scripts, no event handlers, no unknown elements) is not
 * negotiable and is not part of the policy. The policy covers what a
 * sanitizer alone cannot decide for you: which hosts may receive image
 * requests, whether links may leave the page, whether agent content may
 * restyle or impersonate the host UI, and how blocked content is shown.
 */

export type RenderMode = 'strict' | 'balanced' | 'permissive';

/** `cdn.example.com` matches exactly; `*.example.com` matches subdomains only when `allowWildcardHosts` is on. */
export type HostPattern = string;

/** `'none'`: no remote images at all. `'any'`: every host. An array: an allowlist of host patterns. */
export type ImageHosts = 'none' | 'any' | readonly HostPattern[];

export interface UrlHeuristics {
  /** Longest URL accepted at all, in characters, after normalization. */
  readonly maxLength: number;
  /** A path segment or query value longer than this is inspected for encoded payloads. */
  readonly maxTokenLength: number;
  /** Shannon entropy (bits per character) at or above which a long token counts as an encoded payload. */
  readonly minEntropy: number;
}

export interface RenderPolicy {
  readonly mode: RenderMode;

  /** URL schemes allowed in href/src/etc., lower-case, without the colon. Everything else is dropped. */
  readonly allowedSchemes: readonly string[];
  /** Scheme-less URLs resolve against the host page. Turn off to require absolute URLs. */
  readonly allowRelativeUrls: boolean;

  /** Allow <img> at all. Same-origin and relative images are always allowed when this is on. */
  readonly allowImages: boolean;
  /** Which remote hosts may receive image requests (image requests happen without a click). */
  readonly imageHosts: ImageHosts;
  /** Honour `*.example.com` patterns in imageHosts. Off by default: a wildcard allows every subdomain, including user-controlled ones. */
  readonly allowWildcardHosts: boolean;
  /** Query strings on remote images: keep them, strip them (breaks signed URLs, defeats `?data=` exfiltration) or reject the image. */
  readonly imageQuery: 'keep' | 'strip' | 'deny';
  /** Rewrite allowed remote image URLs, for example through an image proxy. Return null to block the image. */
  readonly rewriteImageUrl: ((url: URL) => string | null) | null;
  /** Show a blocked image as a "click to open" placeholder link, or remove it silently. */
  readonly blockedImage: 'remove' | 'placeholder';
  /** Length and entropy checks on remote image URLs. `false` disables them. */
  readonly urlHeuristics: UrlHeuristics | false;
  /** Hosts known to receive arbitrary data (webhook catchers, tunnels, forms, blob storage): block, log only, or ignore. */
  readonly sinkDenylist: 'block' | 'log' | 'off';

  /** Allow target="_blank" on links. rel="noopener noreferrer" is always enforced when a target is present. */
  readonly allowTargetBlank: boolean;
  /** Allow form controls. Off by default: a rendered password field is a phishing form inside the chat. */
  readonly allowForms: boolean;
  /** Allow inline SVG (a sanitized subset). Off by default. */
  readonly allowSvg: boolean;
  /** Allow audio/video/source/track/picture. Off by default: they request URLs without a click, like images. */
  readonly allowMedia: boolean;
  /** Allow the style attribute. Off by default: agent content must not restyle or overlay the host UI. */
  readonly allowInlineStyles: boolean;
  /** Allow data-* attributes. Off by default: host scripts commonly read them as configuration. */
  readonly allowDataAttributes: boolean;
  /** Class names the content may carry; every other class is stripped. Patterns must not be global regexes. */
  readonly allowedClassPatterns: readonly RegExp[];
  /** Extra tags to forbid on top of the built-in list. */
  readonly forbidTags: readonly string[];
  /** Extra attributes to forbid on top of the built-in list. */
  readonly forbidAttributes: readonly string[];
}

export const DEFAULT_URL_HEURISTICS: UrlHeuristics = Object.freeze({
  maxLength: 2048,
  maxTokenLength: 64,
  minEntropy: 4,
});

const COMMON = {
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowRelativeUrls: true,
  allowImages: true,
  allowWildcardHosts: false,
  rewriteImageUrl: null,
  blockedImage: 'placeholder',
  allowTargetBlank: true,
  allowForms: false,
  allowSvg: false,
  allowMedia: false,
  allowInlineStyles: false,
  allowDataAttributes: false,
  allowedClassPatterns: [/^language-[\w+#.-]+$/, /^rp-[\w-]+$/],
  forbidTags: [],
  forbidAttributes: [],
} satisfies Partial<RenderPolicy>;

/**
 * Mode presets.
 *
 * - strict: no remote images at all; sink hosts blocked; heuristics on.
 * - balanced: remote images only from the allowlist, query strings stripped; sink hosts blocked; heuristics on.
 * - permissive: every host allowed, nothing rewritten; sink hosts and nothing else are only logged.
 *
 * Sanitization is identical in all three modes. Permissive is still XSS-safe; it just stops
 * making decisions about where data may flow.
 */
export const MODE_PRESETS: Readonly<Record<RenderMode, RenderPolicy>> = Object.freeze({
  strict: Object.freeze({
    ...COMMON,
    mode: 'strict',
    imageHosts: 'none',
    imageQuery: 'strip',
    urlHeuristics: DEFAULT_URL_HEURISTICS,
    sinkDenylist: 'block',
  }),
  balanced: Object.freeze({
    ...COMMON,
    mode: 'balanced',
    imageHosts: [],
    imageQuery: 'strip',
    urlHeuristics: DEFAULT_URL_HEURISTICS,
    sinkDenylist: 'block',
  }),
  permissive: Object.freeze({
    ...COMMON,
    mode: 'permissive',
    imageHosts: 'any',
    imageQuery: 'keep',
    urlHeuristics: false,
    sinkDenylist: 'log',
  }),
});

export const DEFAULT_MODE: RenderMode = 'balanced';

/**
 * Build a policy from a mode preset plus explicit overrides.
 * Throws on configurations that silently widen exposure (wildcard hosts without opting in).
 */
export function resolvePolicy(mode: RenderMode = DEFAULT_MODE, overrides: Partial<RenderPolicy> = {}): RenderPolicy {
  const preset = MODE_PRESETS[mode];
  if (!preset) {
    throw new Error(`@render-policy/core: unknown mode "${String(mode)}"`);
  }
  const policy: RenderPolicy = { ...preset, ...stripUndefined(overrides), mode };

  if (Array.isArray(policy.imageHosts) && !policy.allowWildcardHosts) {
    const wildcard = policy.imageHosts.find((h) => h.includes('*'));
    if (wildcard) {
      throw new Error(
        `@render-policy/core: imageHosts contains the wildcard pattern "${wildcard}" but allowWildcardHosts is false. ` +
          'List exact hosts, or set allowWildcardHosts: true deliberately.',
      );
    }
  }
  for (const scheme of policy.allowedSchemes) {
    if (scheme !== scheme.toLowerCase() || scheme.endsWith(':')) {
      throw new Error(`@render-policy/core: allowedSchemes entries must be lower-case and without the colon (got "${scheme}")`);
    }
  }
  for (const pattern of policy.allowedClassPatterns) {
    if (pattern.global || pattern.sticky) {
      throw new Error(`@render-policy/core: allowedClassPatterns must not use the g or y flags (got ${String(pattern)})`);
    }
  }
  return policy;
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {};
  for (const key of Object.keys(value) as (keyof T)[]) {
    if (value[key] !== undefined) {
      out[key] = value[key];
    }
  }
  return out;
}
