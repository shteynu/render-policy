export type SinkCategory = 'oast' | 'webhook' | 'tunnel' | 'serverless' | 'forms' | 'blob-storage';

export interface SinkEntry {
  /**
   * `host` matches the host and its subdomains; `host/path` additionally requires the path prefix.
   * A `*` stands for any part of one host label (`s3.*.amazonaws.com`, `s3-*.amazonaws.com`) or of
   * one path segment (`discord.com/api/*\/webhooks`); it never crosses a `.` or a `/`.
   */
  readonly pattern: string;
  readonly category: SinkCategory;
}

export interface SinkDenylist {
  /** Date of the list, so a stale list is visible in the journal and in bug reports. */
  readonly version: string;
  readonly entries: readonly SinkEntry[];
}

interface CompiledSink {
  readonly host: RegExp;
  readonly path: RegExp | null;
}

const compiled = new WeakMap<SinkEntry, CompiledSink>();

// Literal text, with each `*` standing for a run of characters other than `stop`.
const glob = (text: string, stop: string): string =>
  text
    .split('*')
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join(`[^${stop}]*`);

function compile(entry: SinkEntry): CompiledSink {
  let result = compiled.get(entry);
  if (!result) {
    const slash = entry.pattern.indexOf('/');
    const hostPattern = (slash === -1 ? entry.pattern : entry.pattern.slice(0, slash)).toLowerCase();
    const pathPattern = slash === -1 ? null : entry.pattern.slice(slash);
    result = {
      host: new RegExp(`(?:^|\\.)${glob(hostPattern, '.')}$`),
      path: pathPattern === null ? null : new RegExp(`^${glob(pathPattern, '/')}`),
    };
    compiled.set(entry, result);
  }
  return result;
}

/** Match a URL against the denylist. Hosts match exactly or as a subdomain; an optional path prefix narrows the match. */
export function matchSink(url: URL, list: SinkDenylist): SinkEntry | null {
  const host = url.hostname.toLowerCase();
  const path = url.pathname;
  for (const entry of list.entries) {
    const { host: hostMatch, path: pathMatch } = compile(entry);
    if (!hostMatch.test(host)) continue;
    if (pathMatch !== null && !pathMatch.test(path)) continue;
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
