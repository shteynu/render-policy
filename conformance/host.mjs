/**
 * The Content-Security-Policy and the iframe `allow` attribute a spec-compliant MCP Apps host
 * applies to a UI resource, built from its `_meta.ui`. Pure functions, so the conformance
 * checks read as "the host must construct this, and the browser must enforce it".
 *
 * The formula is the one in the MCP Apps specification (SEP-1865, Security Implications →
 * Content Security Policy Enforcement), including the restrictive default the host MUST apply
 * when `ui.csp` is omitted. This is a reference the suite tests against, not a host to ship.
 */

/** Applied verbatim when the resource declares no `ui.csp`: no network, inline script/style only. */
export const RESTRICTIVE_DEFAULT = [
  "default-src 'none'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' data:",
  "connect-src 'none'",
].join('; ');

const list = (values) => (Array.isArray(values) ? values.filter((v) => typeof v === 'string' && v.length > 0) : []);
const withDomains = (base, domains) => (domains.length > 0 ? `${base} ${domains.join(' ')}` : base);

/**
 * The CSP for a resource's `_meta.ui`. `connectDomains` widen `connect-src`; `resourceDomains`
 * widen the fetching directives; `frameDomains` and `baseUriDomains` set `frame-src` and
 * `base-uri`, each locked down when absent. Undeclared hosts are never allowed.
 */
export function buildCsp(meta) {
  const csp = meta?.ui?.csp;
  if (!csp || typeof csp !== 'object') return RESTRICTIVE_DEFAULT;
  const resource = list(csp.resourceDomains);
  const connect = list(csp.connectDomains);
  const frame = list(csp.frameDomains);
  const base = list(csp.baseUriDomains);
  return [
    "default-src 'none'",
    withDomains("script-src 'self' 'unsafe-inline'", resource),
    withDomains("style-src 'self' 'unsafe-inline'", resource),
    withDomains("connect-src 'self'", connect),
    withDomains("img-src 'self' data:", resource),
    withDomains("font-src 'self'", resource),
    withDomains("media-src 'self' data:", resource),
    `frame-src ${frame.length > 0 ? frame.join(' ') : "'none'"}`,
    "object-src 'none'",
    `base-uri ${base.length > 0 ? base.join(' ') : "'self'"}`,
  ].join('; ');
}

/** The Permissions-Policy `allow` attribute for the sandbox iframe, from `_meta.ui.permissions`. */
export function buildAllowAttribute(permissions) {
  if (!permissions || typeof permissions !== 'object') return '';
  const features = ['camera', 'microphone', 'geolocation'];
  return features.filter((feature) => permissions[feature]).join('; ');
}

/**
 * The tool visibility a host sees. `visibility` defaults to ["model", "app"], so a tool that
 * names a UI resource is app-callable unless it opts out. A host MUST require consent before an
 * app-callable tool without `readOnlyHint` runs; this returns whether that gate is required.
 */
export function toolNeedsConsent(tool) {
  const ui = tool?._meta?.ui;
  const visibility = Array.isArray(ui?.visibility) ? ui.visibility : ['model', 'app'];
  const appCallable = visibility.includes('app');
  const readOnly = tool?.annotations?.readOnlyHint === true;
  return appCallable && !readOnly;
}
