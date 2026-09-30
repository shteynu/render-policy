/**
 * Classification of the domain patterns MCP Apps declare in `_meta.ui.csp`
 * (connectDomains, resourceDomains, frameDomains, baseUriDomains). A pattern may be a bare
 * host, a host with a scheme, or carry a wildcard. Sink hosts come from the render-policy
 * denylist: services that exist to receive whatever is sent to them.
 */
import { SINK_DENYLIST } from '@render-policy/core';

export function parseDomainPattern(raw) {
  const value = String(raw ?? '').trim();
  const withoutScheme = value.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
  const hostPort = withoutScheme.split('/')[0] ?? '';
  const host = hostPort.split(':')[0]?.toLowerCase() ?? '';
  const scheme = /^([a-z][a-z0-9+.-]*):\/\//i.exec(value)?.[1]?.toLowerCase() ?? null;
  const wildcard = host.includes('*');
  const full = host === '*' || host === '' || withoutScheme === '*';
  const leadingWildcard = host.startsWith('*.');
  const bareHost = leadingWildcard ? host.slice(2) : host.replace(/\*/g, '');
  return { raw: value, scheme, host, wildcard, full, leadingWildcard, bareHost, insecureScheme: scheme === 'http' };
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

export function classifyDomains(list) {
  const patterns = (Array.isArray(list) ? list : []).map(parseDomainPattern);
  return {
    count: patterns.length,
    wildcards: patterns.filter((p) => p.wildcard).length,
    fullWildcards: patterns.filter((p) => p.full).length,
    insecure: patterns.filter((p) => p.insecureScheme).length,
    sinks: patterns.map((p) => sinkFor(p.bareHost)).filter(Boolean).map((e) => e.category),
    hosts: patterns.map((p) => p.host),
  };
}
