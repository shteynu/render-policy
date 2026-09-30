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

/**
 * Every server the registry lists, normalized. `onPage` receives progress. Pass `resume`
 * ({ cursor, servers }) to continue an earlier run, and `deadline` (ms timestamp) to stop
 * early: the result then carries `cursor` so the next run can pick up where this one stopped.
 */
export async function listAllServers({ base = DEFAULT_BASE, pageSize = 100, onPage = () => {}, maxPages = 20000, resume = null, deadline = Infinity, latest = true } = {}) {
  const servers = resume?.servers ? [...resume.servers] : [];
  let cursor = resume?.cursor ?? null;
  let complete = false;
  for (let page = 1; page <= maxPages; page += 1) {
    if (Date.now() > deadline) break;
    const url = `${base}/v0/servers?limit=${pageSize}${latest ? '&version=latest' : ''}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const data = await fetchJson(url);
    const entries = Array.isArray(data.servers) ? data.servers : [];
    for (const entry of entries) servers.push(normalizeServer(entry));
    onPage({ page, received: entries.length, total: servers.length });
    cursor = data.metadata?.nextCursor ?? data.metadata?.next_cursor ?? null;
    if (!cursor || entries.length === 0) {
      complete = true;
      break;
    }
  }
  return { servers, cursor: complete ? null : cursor, complete };
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
