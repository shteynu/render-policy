/**
 * The official MCP registry: paginated listing with retries. Public metadata only.
 */
const DEFAULT_BASE = 'https://registry.modelcontextprotocol.io';

async function fetchJson(url, { retries = 4, timeoutMs = 30000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'mcp-ui-census/0.1 (+https://github.com/shteynu/render-policy)' } });
      if (response.status === 429 || response.status >= 500) throw new Error(`HTTP ${response.status}`);
      if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { fatal: true });
      const data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('non-object response');
      return data;
    } catch (error) {
      lastError = error;
      if (error.fatal) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export function normalizeServer(entry) {
  const server = entry?.server ?? entry ?? {};
  const official = entry?._meta?.['io.modelcontextprotocol.registry/official'] ?? {};
  return {
    name: server.name ?? '',
    title: server.title ?? '',
    version: server.version ?? '',
    description: server.description ?? '',
    repository: server.repository?.url ?? null,
    websiteUrl: server.websiteUrl ?? null,
    remotes: (server.remotes ?? []).map((r) => ({ type: r.type ?? r.transportType ?? 'unknown', url: r.url ?? '' })),
    packages: (server.packages ?? []).map((p) => ({ registry: p.registryType ?? p.registry_type ?? 'unknown', identifier: p.identifier ?? '', version: p.version ?? '', transport: p.transport?.type ?? null })),
    status: official.status ?? null,
    isLatest: official.isLatest !== false,
    publishedAt: official.publishedAt ?? null,
  };
}

/** Every server the registry lists, normalized. `onPage` receives progress. */
export async function listAllServers({ base = DEFAULT_BASE, pageSize = 100, onPage = () => {}, maxPages = 5000 } = {}) {
  const servers = [];
  let cursor = null;
  for (let page = 1; page <= maxPages; page += 1) {
    const url = `${base}/v0/servers?limit=${pageSize}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await fetchJson(url);
    const entries = Array.isArray(data.servers) ? data.servers : [];
    for (const entry of entries) servers.push(normalizeServer(entry));
    onPage({ page, received: entries.length, total: servers.length });
    cursor = data.metadata?.nextCursor ?? data.metadata?.next_cursor ?? null;
    if (!cursor || entries.length === 0) break;
  }
  return servers;
}

/** Only the newest version of each server name. */
export function latestOnly(servers) {
  const byName = new Map();
  for (const server of servers) {
    const existing = byName.get(server.name);
    if (!existing || (server.isLatest && !existing.isLatest) || (server.publishedAt ?? '') > (existing.publishedAt ?? '')) byName.set(server.name, server);
  }
  return [...byName.values()];
}
