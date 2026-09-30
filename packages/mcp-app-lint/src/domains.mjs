/**
 * Classification of the domain patterns MCP Apps declare in `_meta.ui.csp`
 * (connectDomains, resourceDomains, frameDomains, baseUriDomains). A pattern may be a bare
 * host, a host with a scheme, a scheme alone, or carry a wildcard. Sink hosts come from the
 * render-policy denylist: services that exist to receive whatever is sent to them.
 */
import { SINK_DENYLIST } from '@render-policy/core';

/** Schemes that never name a network host; alone they widen nothing. */
const LOCAL_SCHEMES = new Set(['blob', 'data', 'filesystem', 'mediastream', 'about']);
/** Schemes whose transport is cleartext. */
const INSECURE_SCHEMES = new Set(['http', 'ws']);

const SCHEME_ONLY_RE = /^([a-z][a-z0-9+.-]*):$/i;
const SCHEME_HOST_RE = /^([a-z][a-z0-9+.-]*):\/\//i;
const DEV_HOST_RE = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\]|.*\.localhost)$/i;

export function parseDomainPattern(raw) {
  const value = String(raw ?? '').trim();
  const schemeOnly = SCHEME_ONLY_RE.exec(value);
  const schemeHost = schemeOnly ? null : SCHEME_HOST_RE.exec(value);
  const scheme = (schemeOnly ?? schemeHost)?.[1]?.toLowerCase() ?? null;
  const withoutScheme = schemeOnly ? '' : value.slice(schemeHost?.[0].length ?? 0);
  const hostPort = withoutScheme.split('/')[0] ?? '';
  const host = (hostPort.startsWith('[') ? hostPort.slice(0, hostPort.indexOf(']') + 1) : hostPort.split(':')[0]).toLowerCase();
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
    development: localScheme || DEV_HOST_RE.test(host),
    host,
    wildcard,
    full,
    leadingWildcard,
    bareHost,
    insecureScheme: scheme !== null && INSECURE_SCHEMES.has(scheme),
  };
}

/** The sink denylist entry a host pattern falls under, or null. */
export function sinkFor(host) {
  const candidate = String(host ?? '').toLowerCase().replace(/^\*\./, '');
  if (!candidate) return null;
  for (const entry of SINK_DENYLIST.entries) {
    const hostPattern = entry.pattern.split('/')[0].toLowerCase();
    if (candidate === hostPattern || candidate.endsWith(`.${hostPattern}`)) return entry;
  }
  return null;
}

/**
 * Coarse categories for the hosts apps declare or load from. Heuristic, by well-known hosts
 * and naming conventions; a host that fits several falls into the first one listed. Used for
 * aggregates only, so a misfiled host moves a count by one and names nothing.
 */
export const DOMAIN_CATEGORIES = ['every-host', 'development', 'sink', 'fonts', 'analytics', 'maps', 'storage', 'media', 'cdn', 'api', 'other'];

const HOST_RULES = [
  ['fonts', /^(fonts\.googleapis\.com|fonts\.gstatic\.com|(use|p)\.typekit\.net|fonts\.bunny\.net|rsms\.me|(use|kit|ka-f)\.fontawesome\.com|fonts\.cdnfonts\.com)$/],
  ['analytics', /(^|\.)(google-analytics\.com|googletagmanager\.com|analytics\.google\.com|doubleclick\.net|segment\.(io|com)|mixpanel\.com|amplitude\.com|plausible\.io|posthog\.com|sentry\.io|hotjar\.com|clarity\.ms|newrelic\.com|nr-data\.net|datadoghq-browser-agent\.com|browser-intake-datadoghq\.com|events\.mapbox\.com|fullstory\.com|heap\.io|intercom\.io|launchdarkly\.com)$/],
  ['maps', /(^|\.)(mapbox\.com|openstreetmap\.org|maptiler\.com|arcgis\.com|here\.com|tomtom\.com|geojson\.io|cartocdn\.com|stadiamaps\.com|maps\.googleapis\.com|maps\.gstatic\.com|places\.googleapis\.com)$/],
  ['storage', /(^|\.)(storage\.googleapis\.com|firebasestorage\.googleapis\.com|amazonaws\.com|blob\.core\.windows\.net|myqcloud\.com|aliyuncs\.com|r2\.dev|r2\.cloudflarestorage\.com|digitaloceanspaces\.com|backblazeb2\.com|supabase\.co|storage\.yandexcloud\.net)$|^(s3|storage|bucket|blob|files|uploads)\./],
  ['media', /(^|\.)(googleusercontent\.com|scdn\.co|spotifycdn\.com|licdn\.com|cdninstagram\.com|fbcdn\.net|tiktokcdn(-[a-z]+)?\.com|media-amazon\.com|ssl-images-amazon\.com|ytimg\.com|imgur\.com|giphy\.com|unsplash\.com|pexels\.com|gravatar\.com|ui-avatars\.com|replicate\.delivery|fal\.media|twimg\.com|wp\.com|slack-edge\.com)$|^(img|imgs|image|images|media|avatars?|photos?|pics?|icons?|thumbs?)(-[a-z0-9]+)?\./],
  ['cdn', /(^|\.)(unpkg\.com|jsdelivr\.net|cdnjs\.cloudflare\.com|esm\.sh|esm\.run|skypack\.dev|jspm\.io|githubusercontent\.com|github\.io|gitlab\.io|cdn\.tailwindcss\.com|code\.jquery\.com|bootstrapcdn\.com|ajax\.googleapis\.com|gstatic\.com|cloudfront\.net|akamaihd\.net|akamaized\.net|fastly\.net|azureedge\.net|cdn\.socket\.io|polyfill\.io|vercel\.app|netlify\.app|pages\.dev)$|^(cdn|static|assets|s)\d*(-[a-z0-9]+)?\.|cdn/],
  ['api', /^(api|apis|rest|graphql|gateway)(-[a-z0-9]+)?\d*\.|\.api\.|(^|\.)googleapis\.com$/],
];

/** Category of a parsed domain pattern (see parseDomainPattern). */
export function categorizeDomain(pattern) {
  const p = typeof pattern === 'string' ? parseDomainPattern(pattern) : pattern;
  if (p.full) return 'every-host';
  if (p.development) return 'development';
  if (sinkFor(p.bareHost)) return 'sink';
  for (const [category, re] of HOST_RULES) if (re.test(p.bareHost)) return category;
  return 'other';
}

/** Category of a bare host (as found in HTML: script src, img src, …). */
export function categorizeHost(host) {
  return categorizeDomain(parseDomainPattern(String(host ?? '').includes('://') ? host : `https://${host}`));
}

export function classifyDomains(list) {
  const patterns = (Array.isArray(list) ? list : []).map(parseDomainPattern);
  return {
    count: patterns.length,
    wildcards: patterns.filter((p) => p.wildcard).length,
    fullWildcards: patterns.filter((p) => p.full).length,
    insecure: patterns.filter((p) => p.insecureScheme).length,
    sinks: patterns.map((p) => sinkFor(p.bareHost)).filter(Boolean).map((e) => e.category),
    hosts: patterns.map((p) => p.host),
    categories: patterns.map(categorizeDomain),
  };
}
