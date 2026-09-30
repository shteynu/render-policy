export type SinkCategory = 'oast' | 'webhook' | 'tunnel' | 'serverless' | 'forms' | 'blob-storage';

export interface SinkEntry {
  /** `host` matches the host and its subdomains; `host/path` additionally requires the path prefix. */
  readonly pattern: string;
  readonly category: SinkCategory;
}

export interface SinkDenylist {
  /** Date of the list, so a stale list is visible in the journal and in bug reports. */
  readonly version: string;
  readonly entries: readonly SinkEntry[];
}

/** Match a URL against the denylist. Hosts match exactly or as a subdomain; an optional path prefix narrows the match. */
export function matchSink(url: URL, list: SinkDenylist): SinkEntry | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  for (const entry of list.entries) {
    const slash = entry.pattern.indexOf('/');
    const hostPattern = (slash === -1 ? entry.pattern : entry.pattern.slice(0, slash)).toLowerCase();
    const pathPattern = slash === -1 ? null : entry.pattern.slice(slash);
    if (host !== hostPattern && !host.endsWith(`.${hostPattern}`)) continue;
    if (pathPattern !== null && !path.startsWith(pathPattern)) continue;
    return entry;
  }
  return null;
}

/** Merge lists; later entries win nothing, they are simply appended. */
export function mergeSinkDenylists(...lists: readonly SinkDenylist[]): SinkDenylist {
  return {
    version: lists.map((l) => l.version).sort().at(-1) ?? '0',
    entries: lists.flatMap((l) => l.entries),
  };
}
