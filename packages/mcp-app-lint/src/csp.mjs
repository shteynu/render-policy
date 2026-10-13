/**
 * What CSP a UI document needs, and how a declared `_meta.ui.csp` covers it. The directives follow
 * the host formula in the specification (see `conformance/host.mjs`): `connectDomains` widen
 * connect-src; `resourceDomains` widen script-src, style-src, img-src, font-src and media-src;
 * `frameDomains` set frame-src. Static and heuristic: a URL assembled at run time is not seen.
 */
import { parseDomainPattern } from './domains.mjs';

/**
 * Origins a document loads from or calls, by the `_meta.ui.csp` key that has to allow them.
 * @typedef {{ connectDomains: string[], resourceDomains: string[], frameDomains: string[] }} CspNeeds
 */

/** Tags whose URL attributes the browser fetches as subresources (or, for frames, navigates). */
const ELEMENT_RE = /<(script|img|video|audio|source|track|link|iframe|frame|image|use|input)\b([^>]*)>/gi;
const ATTR_RE = /(?:^|\s)(src|href|xlink:href|poster|srcset|rel)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// rel values of a <link> that fetch nothing (or nothing the CSP governs).
const NON_FETCHING_REL_RE = /^(?:canonical|alternate|author|help|license|next|prev|search|me|bookmark|external|dns-prefetch|preconnect)$/i;
const CSS_URL_RE = /url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|@import\s+["']((?:https?:)?\/\/[^"']+)/gi;
// fetch, sendBeacon, WebSocket, EventSource, XHR open: connect-src.
const CONNECT_CALL_RE = /(?:\b(?:fetch|sendBeacon)\s*\(|\bnew\s+(?:WebSocket|EventSource)\s*\(|\.open\s*\(\s*["'`][A-Za-z]+["'`]\s*,)\s*["'`]((?:https?|wss?):\/\/[^"'`\s]+)/g;
// import() and static imports from a URL: script-src.
const IMPORT_RE = /(?:\bimport\s*\(\s*|\bimport\s+(?:[\w$*{}\s,]+\s+from\s+)?|\bfrom\s+)["'`]((?:https?:)?\/\/[^"'`\s]+)["'`]/g;
/** A stylesheet host whose CSS loads fonts from a second host the document never names. */
const COMPANION_HOSTS = new Map([['fonts.googleapis.com', 'https://fonts.gstatic.com']]);

/**
 * The origin of an absolute or protocol-relative URL, or null.
 * @param {string} url
 */
function originOf(url) {
  try {
    const parsed = new URL(url.startsWith('//') ? `https:${url}` : url);
    return /^(https?|wss?):$/.test(parsed.protocol) ? parsed.origin : null;
  } catch {
    return null;
  }
}

/**
 * The origins a document needs, by CSP key, sorted and without duplicates.
 * @param {unknown} html
 * @returns {CspNeeds}
 */
export function cspNeeds(html) {
  const text = String(html ?? '');
  /** @type {Record<keyof CspNeeds, Set<string>>} */
  const sets = { connectDomains: new Set(), resourceDomains: new Set(), frameDomains: new Set() };
  /** @param {keyof CspNeeds} key @param {string | undefined} url */
  const add = (key, url) => {
    const origin = url && /^(?:[a-z][a-z0-9+.-]*:)?\/\//i.test(url.trim()) ? originOf(url.trim()) : null;
    if (!origin) return;
    sets[key].add(origin);
    const companion = COMPANION_HOSTS.get(new URL(origin).hostname);
    if (companion && key === 'resourceDomains') sets.resourceDomains.add(companion);
  };
  for (const element of text.matchAll(ELEMENT_RE)) {
    const tag = (element[1] ?? '').toLowerCase();
    /** @type {Record<string, string>} */
    const attrs = {};
    for (const attr of (element[2] ?? '').matchAll(ATTR_RE)) attrs[(attr[1] ?? '').toLowerCase()] = attr[2] ?? attr[3] ?? '';
    if (tag === 'input' && !/\btype\s*=\s*["']?image/i.test(element[2] ?? '')) continue;
    if (tag === 'link' && (attrs.rel ?? '').split(/\s+/).filter(Boolean).every((rel) => NON_FETCHING_REL_RE.test(rel)) && attrs.rel) continue;
    const key = tag === 'iframe' || tag === 'frame' ? 'frameDomains' : 'resourceDomains';
    add(key, attrs.src);
    if (tag === 'link' || tag === 'image' || tag === 'use') add(key, attrs.href ?? attrs['xlink:href']);
    add(key, attrs.poster);
    for (const candidate of (attrs.srcset ?? '').split(',')) add(key, candidate.trim().split(/\s+/)[0]);
  }
  for (const match of text.matchAll(CSS_URL_RE)) add('resourceDomains', match[1] ?? match[2]);
  for (const match of text.matchAll(CONNECT_CALL_RE)) add('connectDomains', match[1]);
  for (const match of text.matchAll(IMPORT_RE)) add('resourceDomains', match[1]);
  return {
    connectDomains: [...sets.connectDomains].sort(),
    resourceDomains: [...sets.resourceDomains].sort(),
    frameDomains: [...sets.frameDomains].sort(),
  };
}

/**
 * A suggestion in the `_meta.ui.csp` shape: only the keys with origins, or null when the document
 * needs none (the restrictive default fits it).
 * @param {CspNeeds} needs
 * @returns {Partial<CspNeeds> | null}
 */
export function suggestCsp(needs) {
  const csp = Object.fromEntries(Object.entries(needs).filter(([, origins]) => origins.length > 0));
  return Object.keys(csp).length > 0 ? csp : null;
}

/**
 * The needs of several documents (a package with more than one), merged.
 * @param {Iterable<Partial<CspNeeds> | undefined>} all
 * @returns {CspNeeds}
 */
export function mergeNeeds(all) {
  /** @type {CspNeeds} */
  const merged = { connectDomains: [], resourceDomains: [], frameDomains: [] };
  for (const needs of all) {
    for (const key of /** @type {(keyof CspNeeds)[]} */ (Object.keys(merged))) merged[key] = [...new Set([...merged[key], ...(needs?.[key] ?? [])])].sort();
  }
  return merged;
}

/**
 * Does one declared entry allow the origin? Hosts are compared, not schemes or ports: a host that
 * builds the CSP may widen schemes (https to wss), and a false "undeclared" is worse than a missed one.
 * @param {string} entry
 * @param {string} origin
 */
export function entryCovers(entry, origin) {
  const pattern = parseDomainPattern(entry);
  if (pattern.full) return true;
  if (pattern.localScheme || !pattern.host) return false;
  const host = new URL(origin).hostname.toLowerCase();
  if (pattern.leadingWildcard) return host.endsWith(`.${pattern.bareHost}`);
  return host === pattern.host;
}

/**
 * Needed origins the declared CSP does not allow, by key. The host blocks them: a broken UI.
 * @param {Record<string, unknown> | null | undefined} csp the declared `_meta.ui.csp`
 * @param {CspNeeds} needs
 * @returns {Partial<CspNeeds>}
 */
export function undeclaredOrigins(csp, needs) {
  /** @type {Partial<CspNeeds>} */
  const missing = {};
  for (const key of /** @type {(keyof CspNeeds)[]} */ (Object.keys(needs))) {
    const declared = Array.isArray(csp?.[key]) ? /** @type {unknown[]} */ (csp[key]).map(String) : [];
    const uncovered = needs[key].filter((origin) => !declared.some((entry) => entryCovers(entry, origin)));
    if (uncovered.length > 0) missing[key] = uncovered;
  }
  return missing;
}

/**
 * Declared entries whose host the document never mentions: wider than the UI needs. Wildcards,
 * scheme-only and local-scheme entries are left to the other rules; `baseUriDomains` is not
 * checked. The test is a substring search over the whole document, so a host that appears only
 * in a URL assembled at run time from parts is reported; the rule says so.
 * @param {Record<string, unknown> | null | undefined} csp
 * @param {unknown} html
 * @returns {{ key: keyof CspNeeds, entry: string }[]}
 */
export function unusedEntries(csp, html) {
  const text = String(html ?? '').toLowerCase();
  /** @type {{ key: keyof CspNeeds, entry: string }[]} */
  const unused = [];
  for (const key of /** @type {const} */ (['connectDomains', 'resourceDomains', 'frameDomains'])) {
    for (const entry of Array.isArray(csp?.[key]) ? /** @type {unknown[]} */ (csp[key]).map(String) : []) {
      const pattern = parseDomainPattern(entry);
      if (pattern.full || pattern.wildcard || pattern.localScheme || !pattern.host) continue;
      if (!text.includes(pattern.host)) unused.push({ key, entry });
    }
  }
  return unused;
}
