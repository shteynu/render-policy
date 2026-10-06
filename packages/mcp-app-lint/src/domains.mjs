/**
 * Classification of the domain patterns MCP Apps declare in `_meta.ui.csp`
 * (connectDomains, resourceDomains, frameDomains, baseUriDomains). A pattern may be a bare
 * host, a host with a scheme, a scheme alone, or carry a wildcard. Sink hosts come from the
 * render-policy denylist: services that exist to receive whatever is sent to them.
 */
import { SINK_DENYLIST } from '@render-policy/core';

/** @import { SinkCategory, SinkEntry } from '@render-policy/core' */

/** Schemes that never name a network host; alone they widen nothing. */
const LOCAL_SCHEMES = new Set(['blob', 'data', 'filesystem', 'mediastream', 'about']);
/** Schemes whose transport is cleartext. */
const INSECURE_SCHEMES = new Set(['http', 'ws']);

const SCHEME_ONLY_RE = /^([a-z][a-z0-9+.-]*):$/i;
const SCHEME_HOST_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.localhost)$/i;

/**
 * One CSP domain entry, taken apart: scheme, host, wildcard and what the entry widens.
 * @param {unknown} raw
 */
export function parseDomainPattern(raw) {
  const value = String(raw ?? '').trim();
  const schemeOnly = SCHEME_ONLY_RE.exec(value);
  const schemeHost = schemeOnly ? null : SCHEME_HOST_RE.exec(value);
  const scheme = (schemeOnly ?? schemeHost)?.[1]?.toLowerCase() ?? null;
  const withoutScheme = schemeOnly ? '' : value.slice(schemeHost?.[0].length ?? 0);
  const hostPort = withoutScheme.split('/')[0] ?? '';
  const host = (hostPort.startsWith('[') ? hostPort.slice(0, hostPort.indexOf(']') + 1) : (hostPort.split(':')[0] ?? '')).toLowerCase();
  const localScheme = scheme !== null && LOCAL_SCHEMES.has(scheme);
  const wildcard = host.includes('*');
  // A bare '*' or a scheme-source such as 'https:' expands to a CSP source matching every host.
  const full = host === '*' || (schemeOnly !== null && !localScheme);
  const leadingWildcard = host.startsWith('*.');
  const bareHost = leadingWildcard ? host.slice(2) : host.replace(/\*/g, '');
  return {
    raw: value,
    scheme,
    schemeOnly: schemeOnly !== null,
    localScheme,
    development: DEV_HOST_RE.test(host),
    host,
    wildcard,
    full,
    leadingWildcard,
    bareHost,
    insecureScheme: scheme !== null && INSECURE_SCHEMES.has(scheme),
  };
}

/** @typedef {ReturnType<typeof parseDomainPattern>} DomainPattern */
/**
 * Where a sink entry reaches: other people's accounts ('shared') or one named account ('tenant').
 * @typedef {{ entry: SinkEntry, scope: 'shared' | 'tenant' }} SinkScope
 */

/** @type {WeakMap<SinkEntry, RegExp>} */
const hostMatchers = new WeakMap();

// The host part of a denylist entry as core reads it: a `*` stands for part of one label. The
// capture is whatever precedes the service host, for example the account in acct.blob.core.windows.net.
/** @param {SinkEntry} entry */
function hostMatcher(entry) {
  let re = hostMatchers.get(entry);
  if (!re) {
    const body = (entry.pattern.split('/')[0] ?? '').toLowerCase().split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^.]*');
    re = new RegExp(`^(?:(.+)\\.)?${body}$`);
    hostMatchers.set(entry, re);
  }
  return re;
}

/**
 * @param {unknown} host
 * @returns {{ entry: SinkEntry, prefix: string | null } | null}
 */
function sinkMatch(host) {
  const candidate = String(host ?? '').toLowerCase().replace(/^\*\./, '');
  if (!candidate) return null;
  for (const entry of SINK_DENYLIST.entries) {
    const m = hostMatcher(entry).exec(candidate);
    if (m) return { entry, prefix: m[1] ?? null };
  }
  return null;
}

/**
 * The sink denylist entry a host pattern falls under, or null.
 * @param {unknown} host
 * @returns {SinkEntry | null}
 */
export function sinkFor(host) {
  return sinkMatch(host)?.entry ?? null;
}

/**
 * Sink categories where a subdomain names one customer's account (a bucket, a worker, an app).
 * Tunnels, request catchers, OAST services and form builders are sinks whoever owns the name.
 */
/** @type {ReadonlySet<SinkCategory>} */
const TENANT_CATEGORIES = new Set(['blob-storage', 'serverless']);
/** Anonymous file drops on the blob-storage list: their subdomains are shards, not accounts. */
const NO_TENANT_HOSTS = /(^|\.)(file\.io|transfer\.sh|0x0\.st|catbox\.moe|tmpfiles\.org|gofile\.io)$/;
/** Path-style endpoints: one host serves every customer's buckets as `<endpoint>/<bucket>/…`. */
const PATH_STYLE_ENDPOINTS = /^([a-z]+\d+\.digitaloceanspaces\.com|(f\d+|s3\.[a-z0-9-]+)\.backblazeb2\.com|s3(\.[a-z0-9-]+)?\.wasabisys\.com)$/;

/**
 * Whether a CSP pattern on the sink denylist reaches other people's accounts. 'shared': the
 * service host itself (storage.googleapis.com and s3.amazonaws.com serve any bucket by path), a
 * wildcard over the tenants (*.blob.core.windows.net, *.ngrok-free.dev), a path-style endpoint, or
 * a category where every name is a sink. 'tenant': one account on a multi-tenant storage or
 * serverless service (acct.blob.core.windows.net, pub-<id>.r2.dev); not a channel to a stranger
 * while the owner keeps the name. Null when the host is not on the denylist.
 * @param {string | DomainPattern} pattern
 * @returns {SinkScope | null}
 */
export function sinkScope(pattern) {
  const p = typeof pattern === 'string' ? parseDomainPattern(pattern) : pattern;
  const match = sinkMatch(p.bareHost);
  if (!match) {
    // A wildcard above a sink service covers it: *.amazonaws.com includes s3.amazonaws.com.
    const covered = p.leadingWildcard && p.bareHost.includes('.') ? SINK_DENYLIST.entries.find((e) => (e.pattern.split('/')[0] ?? '').toLowerCase().endsWith(`.${p.bareHost}`)) : null;
    return covered ? { entry: covered, scope: 'shared' } : null;
  }
  const tenant = TENANT_CATEGORIES.has(match.entry.category)
    && match.prefix !== null
    && !(p.wildcard && !p.leadingWildcard)
    && !NO_TENANT_HOSTS.test(p.bareHost)
    && !PATH_STYLE_ENDPOINTS.test(p.bareHost);
  return { entry: match.entry, scope: tenant ? 'tenant' : 'shared' };
}

/**
 * Coarse categories for the hosts apps declare or load from. Heuristic, by well-known hosts
 * and naming conventions; a host that fits several falls into the first one listed. Used for
 * aggregates only, so a misfiled host moves a count by one and names nothing.
 */
/** @typedef {typeof DOMAIN_CATEGORIES[number]} DomainCategory */
export const DOMAIN_CATEGORIES = /** @type {const} */ (['every-host', 'development', 'local-scheme', 'sink', 'fonts', 'analytics', 'maps', 'storage', 'media', 'cdn', 'api', 'other']);

/** @type {ReadonlyArray<[DomainCategory, RegExp]>} */
const HOST_RULES = [
  ['fonts', /^(fonts\.googleapis\.com|fonts\.gstatic\.com|(use|p)\.typekit\.net|fonts\.bunny\.net|rsms\.me|(use|kit|ka-f)\.fontawesome\.com|fonts\.cdnfonts\.com)$/],
  ['analytics', /(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|segment\.(io|com)|mixpanel\.com|amplitude\.com|plausible\.io|posthog\.com|sentry\.io|hotjar\.com|clarity\.ms|newrelic\.com|nr-data\.net|datadoghq-browser-agent\.com|browser-intake-datadoghq\.com|events\.mapbox\.com|fullstory\.com|heap\.io|intercom\.io|launchdarkly\.com)$/],
  ['maps', /(^|\.)(mapbox\.com|openstreetmap\.org|maptiler\.com|arcgis\.com|here\.com|tomtom\.com|geojson\.io|cartocdn\.com|stadiamaps\.com|maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com)$/],
  ['storage', /(^|\.)(storage\.googleapis\.com|firebasestorage\.googleapis\.com|amazonaws\.com|blob\.core\.windows\.net|myqcloud\.com|aliyuncs\.com|r2\.dev|r2\.cloudflarestorage\.com|digitaloceanspaces\.com|backblazeb2\.com|supabase\.co|storage\.yandexcloud\.net)$|^(s3|storage|bucket|blob|files|uploads)\./],
  ['media', /(^|\.)(googleusercontent\.com|scdn\.co|spotifycdn\.com|licdn\.com|cdninstagram\.com|fbcdn\.net|tiktokcdn(-[a-z]+)?\.com|media-amazon\.com|ssl-images-amazon\.com|ytimg\.com|imgur\.com|giphy\.com|unsplash\.com|pexels\.com|gravatar\.com|ui-avatars\.com|replicate\.delivery|fal\.media|twimg\.com|wp\.com|slack-edge\.com)$|^(img|imgs|image|images|media|avatars?|photos?|pics?|icons?|thumbs?)(-[a-z0-9]+)?\./],
  ['cdn', /(^|\.)(unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|esm\.run|skypack\.dev|jspm\.io|githubusercontent\.com|github\.io|gitlab\.io|cdn\.tailwindcss\.com|code\.jquery\.com|bootstrapcdn\.com|ajax\.googleapis\.com|gstatic\.com|cloudfront\.net|akamaihd\.net|akamaized\.net|fastly\.net|azureedge\.net|cdn\.socket\.io|polyfill\.io|vercel\.app|netlify\.app|pages\.dev)$|^(cdn|static|assets|s)\d*(-[a-z0-9]+)?\.|cdn/],
  ['api', /^(api|apis|rest|graphql|gateway)(-[a-z0-9]+)?\d*\.|\.api\.|(^|\.)googleapis\.com$/],
];

/**
 * Category of a parsed domain pattern (see parseDomainPattern).
 * @param {string | DomainPattern} pattern
 * @returns {DomainCategory}
 */
export function categorizeDomain(pattern) {
  const p = typeof pattern === 'string' ? parseDomainPattern(pattern) : pattern;
  if (p.full) return 'every-host';
  if (p.development) return 'development';
  if (p.localScheme) return 'local-scheme';
  if (sinkScope(p)?.scope === 'shared') return 'sink';
  for (const [category, re] of HOST_RULES) if (re.test(p.bareHost)) return category;
  return 'other';
}

/**
 * Category of a bare host (as found in HTML: script src, img src, …).
 * @param {unknown} host
 */
export function categorizeHost(host) {
  const value = String(host ?? '');
  return categorizeDomain(parseDomainPattern(value.includes('://') ? value : `https://${value}`));
}

/**
 * Counts and categories over one domain list; anything that is not an array counts as empty.
 * @param {unknown} list
 */
export function classifyDomains(list) {
  const patterns = (Array.isArray(list) ? list : []).map(parseDomainPattern);
  const scopes = patterns.map(sinkScope);
  return {
    count: patterns.length,
    wildcards: patterns.filter((p) => p.wildcard).length,
    fullWildcards: patterns.filter((p) => p.full).length,
    insecure: patterns.filter((p) => p.insecureScheme).length,
    sinks: scopes.flatMap((s) => (s?.scope === 'shared' ? [s.entry.category] : [])),
    tenantSinks: scopes.flatMap((s) => (s?.scope === 'tenant' ? [s.entry.category] : [])),
    hosts: patterns.map((p) => p.host),
    categories: patterns.map(categorizeDomain),
  };
}

/** @typedef {ReturnType<typeof classifyDomains>} ClassifiedDomains */
