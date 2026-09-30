import type { RenderPolicy, UrlHeuristics } from './policy.js';

export interface ParsedUrl {
  readonly raw: string;
  /** The value after the same preprocessing browsers apply before parsing. */
  readonly normalized: string;
  /** Lower-case scheme, or null for relative URLs. */
  readonly scheme: string | null;
  /** Parsed absolute URL, or null for relative URLs. */
  readonly url: URL | null;
}

export type UrlVerdict =
  | { readonly ok: true; readonly parsed: ParsedUrl }
  | { readonly ok: false; readonly reason: string; readonly normalized: string };

const SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
const RELATIVE_BASE = 'https://relative.invalid/';
const RELATIVE_HOST = 'relative.invalid';

/**
 * Browsers strip ASCII tab and newline anywhere in a URL, and leading/trailing
 * C0 controls and spaces, before looking for a scheme. `java\tscript:` is `javascript:`.
 */
export function normalizeUrl(raw: string): string {
  return raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

/** Scheme allowlist check. Relative URLs are checked by resolving them against a dummy base. */
export function checkUrl(raw: string, policy: Pick<RenderPolicy, 'allowedSchemes' | 'allowRelativeUrls'>): UrlVerdict {
  const normalized = normalizeUrl(raw);
  if (normalized === '') {
    return { ok: true, parsed: { raw, normalized, scheme: null, url: null } };
  }

  if (SCHEME_RE.test(normalized)) {
    const scheme = normalized.slice(0, normalized.indexOf(':')).toLowerCase();
    if (!policy.allowedSchemes.includes(scheme)) {
      return { ok: false, reason: `scheme "${scheme}" is not allowed`, normalized };
    }
    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      return { ok: false, reason: 'URL does not parse', normalized };
    }
    if (url.protocol !== `${scheme}:`) {
      return { ok: false, reason: 'scheme changed while parsing', normalized };
    }
    return { ok: true, parsed: { raw, normalized, scheme, url } };
  }

  let resolved: URL;
  try {
    resolved = new URL(normalized, RELATIVE_BASE);
  } catch {
    return { ok: false, reason: 'URL does not parse', normalized };
  }
  if (resolved.protocol !== 'https:') {
    return { ok: false, reason: `relative URL resolved to scheme "${resolved.protocol.slice(0, -1)}"`, normalized };
  }
  if (resolved.host !== RELATIVE_HOST) {
    // Protocol-relative (`//host/x`, or `\\host\x` which browsers treat the same): a cross-host web URL.
    if (!policy.allowedSchemes.includes('https') && !policy.allowedSchemes.includes('http')) {
      return { ok: false, reason: 'protocol-relative URLs are not allowed', normalized };
    }
    return { ok: true, parsed: { raw, normalized, scheme: 'https', url: resolved } };
  }
  if (!policy.allowRelativeUrls) {
    return { ok: false, reason: 'relative URLs are not allowed', normalized };
  }
  return { ok: true, parsed: { raw, normalized, scheme: null, url: null } };
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
