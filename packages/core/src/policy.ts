/**
 * A RenderPolicy is the single place where an application decides what
 * agent-generated content may do once it reaches the DOM.
 *
 * Sanitization (no scripts, no event handlers, no unknown elements) is not
 * negotiable and is not part of the policy. The policy covers what a
 * sanitizer alone cannot decide for you, grouped into three concerns:
 *
 * - `content`: which elements, attributes and classes agent output may carry.
 * - `urls`: which URLs any attribute may point at (schemes, sink hosts, encoded
 *   payloads, and an application hook that decides or rewrites each one).
 * - `images`: what happens to the image requests those URLs would make, which
 *   fire without a click (host allowlist, query strings, proxy rewrite, placeholder).
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

/** What a URL decision applies to: an `href` link, an image `src`, or another URL attribute. */
export type UrlSubject = 'link' | 'image' | 'url';

/** What a `urls.decide` hook is told about the URL it is judging. */
export interface UrlContext {
  readonly subject: UrlSubject;
  /** The element's tag, lower-case. */
  readonly tag: string;
  /** The attribute the URL came from, lower-case. */
  readonly attribute: string;
  /** True when the value resolves within the page's own origin without naming a scheme or host. */
  readonly relative: boolean;
}

/**
 * A `urls.decide` verdict. `null` means "no opinion; apply the rest of the policy". A decision may
 * deny the URL (drop the attribute), rewrite it (route a link through a redirector, an image through
 * a proxy — the result is re-checked against the scheme allowlist), and carry a reason for the journal.
 */
export interface UrlDecision {
  /** `false` drops the attribute. Omitted or `true` keeps it (subject to any `rewrite`). */
  readonly allow?: boolean;
  /** Replace the URL with this value. Re-validated against `allowedSchemes`. */
  readonly rewrite?: string;
  /** Recorded in the decision journal. */
  readonly reason?: string;
}

/**
 * An application hook, run for every URL attribute after the scheme, relative and sink-denylist
 * checks pass. It is where a link policy lives (deny or redirect off-site links); it runs for
 * images too, before the image-specific policy. Trusted application code: if it throws, that one
 * URL is dropped and the render goes on.
 */
export type UrlDecider = (url: URL, context: UrlContext) => UrlDecision | null;

/** Which elements, attributes and classes agent output may carry. Sanitization is applied regardless. */
export interface ContentPolicy {
  /** Allow `<img>` at all. Same-origin and relative images are always allowed when this is on. */
  readonly allowImages: boolean;
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
  /** Allow target="_blank" on links. rel="noopener noreferrer" is always enforced when a target is present. */
  readonly allowTargetBlank: boolean;
  /** Class names the content may carry; every other class is stripped. Patterns must not be global regexes. */
  readonly allowedClassPatterns: readonly RegExp[];
  /** Extra tags to forbid on top of the built-in list. */
  readonly forbidTags: readonly string[];
  /** Extra attributes to forbid on top of the built-in list. */
  readonly forbidAttributes: readonly string[];
}

/** Which URLs any attribute may point at. */
export interface UrlPolicy {
  /** URL schemes allowed in href/src/etc., lower-case, without the colon. Everything else is dropped. */
  readonly allowedSchemes: readonly string[];
  /** Scheme-less URLs resolve against the host page. Turn off to require absolute URLs. */
  readonly allowRelativeUrls: boolean;
  /** Length and entropy checks against encoded payloads hidden in a URL. `false` disables them. */
  readonly heuristics: UrlHeuristics | false;
  /** Hosts known to receive arbitrary data (webhook catchers, tunnels, forms, blob storage): block, log only, or ignore. */
  readonly sinkDenylist: 'block' | 'log' | 'off';
  /**
   * Application hook to allow, deny or rewrite each URL. `null` to make no per-URL decisions.
   * An image reaches it only after the image host, query and heuristic checks, with the query
   * already handled, so a rewrite to a same-origin proxy cannot carry what those checks remove.
   */
  readonly decide: UrlDecider | null;
}

/** What happens to the image requests URLs would make (they fire without a click). */
export interface ImagePolicy {
  /** Which remote hosts may receive image requests. */
  readonly hosts: ImageHosts;
  /** Honour `*.example.com` patterns in `hosts`. Off by default: a wildcard allows every subdomain, including user-controlled ones. */
  readonly allowWildcardHosts: boolean;
  /** Query strings on remote images: keep them, strip them (breaks signed URLs, defeats `?data=` exfiltration) or reject the image. */
  readonly query: 'keep' | 'strip' | 'deny';
  /** Rewrite allowed remote image URLs, for example through an image proxy. Return null to block the image. */
  readonly rewriteUrl: ((url: URL) => string | null) | null;
  /** Show a blocked image as a "click to open" placeholder link, or remove it silently. */
  readonly blocked: 'remove' | 'placeholder';
}

export interface RenderPolicy {
  readonly mode: RenderMode;
  readonly content: ContentPolicy;
  readonly urls: UrlPolicy;
  readonly images: ImagePolicy;
}

/** A partial override of any group, merged onto a mode preset by {@link resolvePolicy}. */
export interface RenderPolicyOverrides {
  readonly mode?: RenderMode;
  readonly content?: Partial<ContentPolicy>;
  readonly urls?: Partial<UrlPolicy>;
  readonly images?: Partial<ImagePolicy>;
}

export const DEFAULT_URL_HEURISTICS: UrlHeuristics = Object.freeze({
  maxLength: 2048,
  maxTokenLength: 64,
  minEntropy: 4,
});

/** Content rules are identical in every mode; modes differ only in their URL and image posture. */
const CONTENT: ContentPolicy = Object.freeze({
  allowImages: true,
  allowForms: false,
  allowSvg: false,
  allowMedia: false,
  allowInlineStyles: false,
  allowDataAttributes: false,
  allowTargetBlank: true,
  allowedClassPatterns: Object.freeze([/^language-[\w+#.-]+$/, /^rp-[\w-]+$/]),
  forbidTags: Object.freeze([]),
  forbidAttributes: Object.freeze([]),
});

const URLS_COMMON = { allowedSchemes: Object.freeze(['http', 'https', 'mailto', 'tel']), allowRelativeUrls: true, decide: null } as const;
const IMAGES_COMMON = { allowWildcardHosts: false, rewriteUrl: null, blocked: 'placeholder' } as const;

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
    mode: 'strict',
    content: CONTENT,
    urls: Object.freeze({ ...URLS_COMMON, heuristics: DEFAULT_URL_HEURISTICS, sinkDenylist: 'block' }),
    images: Object.freeze({ ...IMAGES_COMMON, hosts: 'none', query: 'strip' }),
  }),
  balanced: Object.freeze({
    mode: 'balanced',
    content: CONTENT,
    urls: Object.freeze({ ...URLS_COMMON, heuristics: DEFAULT_URL_HEURISTICS, sinkDenylist: 'block' }),
    images: Object.freeze({ ...IMAGES_COMMON, hosts: Object.freeze([]), query: 'strip' }),
  }),
  permissive: Object.freeze({
    mode: 'permissive',
    content: CONTENT,
    urls: Object.freeze({ ...URLS_COMMON, heuristics: false, sinkDenylist: 'log' }),
    images: Object.freeze({ ...IMAGES_COMMON, hosts: 'any', query: 'keep' }),
  }),
});

export const DEFAULT_MODE: RenderMode = 'balanced';

/**
 * Build a policy from a mode preset plus explicit overrides. Each group is merged on top of the
 * preset, so an override names only the fields it changes. Throws on configurations that silently
 * widen exposure (wildcard hosts without opting in).
 */
export function resolvePolicy(mode: RenderMode = DEFAULT_MODE, overrides: RenderPolicyOverrides = {}): RenderPolicy {
  const preset = MODE_PRESETS[mode];
  if (!preset) {
    throw new Error(`@render-policy/core: unknown mode "${String(mode)}"`);
  }
  const policy: RenderPolicy = {
    mode,
    content: { ...preset.content, ...stripUndefined(overrides.content ?? {}) },
    urls: { ...preset.urls, ...stripUndefined(overrides.urls ?? {}) },
    images: { ...preset.images, ...stripUndefined(overrides.images ?? {}) },
  };

  if (Array.isArray(policy.images.hosts) && !policy.images.allowWildcardHosts) {
    const wildcard = policy.images.hosts.find((h) => h.includes('*'));
    if (wildcard) {
      throw new Error(
        `@render-policy/core: images.hosts contains the wildcard pattern "${wildcard}" but images.allowWildcardHosts is false. ` +
          'List exact hosts, or set images.allowWildcardHosts: true deliberately.',
      );
    }
  }
  for (const scheme of policy.urls.allowedSchemes) {
    if (scheme !== scheme.toLowerCase() || scheme.endsWith(':')) {
      throw new Error(`@render-policy/core: urls.allowedSchemes entries must be lower-case and without the colon (got "${scheme}")`);
    }
  }
  for (const pattern of policy.content.allowedClassPatterns) {
    if (pattern.global || pattern.sticky) {
      throw new Error(`@render-policy/core: content.allowedClassPatterns must not use the g or y flags (got ${String(pattern)})`);
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
