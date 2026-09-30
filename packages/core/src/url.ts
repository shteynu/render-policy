import type { RenderPolicy, UrlHeuristics } from './policy.js';

export interface ParsedUrl {
  readonly raw: string;
  /** The value after the same preprocessing browsers apply before parsing. */
  readonly normalized: string;
  /** Lower-case scheme the URL resolves to, as the browser would resolve it against the page. */
  readonly scheme: string;
  /** The resolved URL. For a relative URL without a known page base, the base is a placeholder origin. */
  readonly url: URL;
  /** True when the value resolves within the page's own origin without naming a scheme or host. */
  readonly relative: boolean;
}

export type UrlVerdict =
  | { readonly ok: true; readonly parsed: ParsedUrl }
  | { readonly ok: false; readonly reason: string; readonly normalized: string };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
/** Stands in for the page when no base is known; anything that resolves elsewhere is not relative. */
const PLACEHOLDER_BASE = 'https://relative.invalid/';

/**
 * Browsers strip ASCII tab and newline anywhere in a URL, and leading/trailing
 * C0 controls and spaces, before looking for a scheme. `java\tscript:` is `javascript:`.
 */
export function normalizeUrl(raw: string): string {
  return raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

/** A usable base for resolution: the page URL when it is http(s), else nothing. */
export function usableBase(href: string | undefined | null): string | undefined {
  return href && /^https?:\/\//i.test(href) ? href : undefined;
}

/**
 * Scheme allowlist check, resolved the way the browser resolves the value against the page:
 * `//host` takes the page's scheme, `http:path` on an http page stays on the page, and a
 * declared scheme outside the allowlist is rejected before anything is parsed.
 */
export function checkUrl(raw: string, policy: Pick<RenderPolicy, 'allowedSchemes' | 'allowRelativeUrls'>, base?: string): UrlVerdict {
  const normalized = normalizeUrl(raw);
  const declared = SCHEME_RE.test(normalized) ? normalized.slice(0, normalized.indexOf(':')).toLowerCase() : null;
  if (declared !== null && !policy.allowedSchemes.includes(declared)) {
    return { ok: false, reason: `scheme "${declared}" is not allowed`, normalized };
  }

  const baseHref = base ?? PLACEHOLDER_BASE;
  let baseOrigin: string;
  let url: URL;
  try {
    baseOrigin = new URL(baseHref).origin;
    url = new URL(normalized, baseHref);
  } catch {
    return { ok: false, reason: 'URL does not parse', normalized };
  }
  const scheme = url.protocol.slice(0, -1).toLowerCase();
  if (!policy.allowedSchemes.includes(scheme)) {
    return { ok: false, reason: `resolves to scheme "${scheme}", which is not allowed`, normalized };
  }
  const relative = declared === null && url.origin === baseOrigin;
  if (relative && !policy.allowRelativeUrls) {
    return { ok: false, reason: 'relative URLs are not allowed', normalized };
  }
  return { ok: true, parsed: { raw, normalized, scheme, url, relative } };
}

/** Exact host match, or suffix match for `*.example.com` patterns when wildcards are allowed. */
export function hostMatches(host: string, patterns: readonly string[], allowWildcards: boolean): boolean {
  const candidate = host.toLowerCase();
  for (const raw of patterns) {
    const pattern = raw.toLowerCase();
    if (pattern.startsWith('*.')) {
      if (!allowWildcards) continue;
      const suffix = pattern.slice(1);
      if (candidate.endsWith(suffix) && candidate.length > suffix.length) return true;
      continue;
    }
    if (candidate === pattern) return true;
  }
  return false;
}

/** Shannon entropy in bits per character. */
export function shannonEntropy(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

const HEX_RE = /^[0-9a-f]+$/i;
const EXTENSION_RE = /\.[a-z0-9]{1,5}$/i;

/**
 * Length and entropy heuristics against encoded payloads hidden in a URL
 * (`/img/<base64 of the conversation>.png`). Returns the reason to block, or null.
 */
export function checkUrlHeuristics(url: URL, heuristics: UrlHeuristics): string | null {
  if (url.href.length > heuristics.maxLength) {
    return `URL is longer than ${heuristics.maxLength} characters`;
  }
  const tokens: string[] = [];
  for (const segment of url.pathname.split('/')) tokens.push(segment);
  for (const [key, value] of url.searchParams) tokens.push(key, value);
  if (url.hash.length > 1) tokens.push(url.hash.slice(1));
  for (const raw of tokens) {
    const token = raw.replace(EXTENSION_RE, '');
    if (token.length <= heuristics.maxTokenLength) continue;
    if (HEX_RE.test(token) || shannonEntropy(token) >= heuristics.minEntropy) {
      return `URL contains a ${token.length}-character token that looks like an encoded payload`;
    }
  }
  return null;
}
