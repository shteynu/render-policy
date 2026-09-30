/**
 * Protocol census over the remote servers of the registry snapshot: initialize, list resources,
 * read the UI ones, list tools. Read-only; no tool is ever called; no credentials are sent.
 * Servers that answer 401/403 are counted as "auth required" and left alone.
 * Output: census/data/remote-servers.jsonl.
 *   node census/collect-remote.mjs [--limit N] [--concurrency 6] [--only name] [--max-resources 10]
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { analyzeHtml, analyzeTools, analyzeUiMeta, compareListRead, UI_MIME, withSinkHosts } from 'mcp-app-lint';
import { appendJsonl, argValue, dataDir, ensureDataDir, mapLimit, readJsonl } from './lib/io.mjs';
import { failureKind, McpHttpClient } from './lib/mcp-client.mjs';

await ensureDataDir();
const out = path.join(dataDir, 'remote-servers.jsonl');
const limit = Number(argValue('--limit', '0'));
const concurrency = Number(argValue('--concurrency', '6'));
const only = argValue('--only', null);
const maxResources = Number(argValue('--max-resources', '10'));
const registry = JSON.parse(await readFile(path.join(dataDir, 'registry.json'), 'utf8'));
const done = new Set((await readJsonl(out)).map((r) => r.name));

let servers = registry.servers.filter((s) => s.remotes.some((r) => r.type === 'streamable-http') && !done.has(s.name));
if (only) servers = servers.filter((s) => s.name === only);
if (limit) servers = servers.slice(0, limit);
console.log(`remote servers to probe: ${servers.length} (already done ${done.size})`);

const isUiResource = (resource) => (resource?.mimeType ?? '').startsWith('text/html') || String(resource?.uri ?? '').startsWith('ui://');

let processed = 0;
await mapLimit(servers, concurrency, async (server) => {
  const remote = server.remotes.find((r) => r.type === 'streamable-http');
  const record = { name: server.name, url: remote.url, collectedAt: new Date().toISOString() };
  const client = new McpHttpClient(remote.url);
  try {
    const init = await client.initialize();
    record.serverInfo = init?.serverInfo ?? null;
    record.protocolVersion = init?.protocolVersion ?? null;
    const resources = await client.listResources().catch((error) => {
      record.resourcesError = failureKind(error);
      return [];
    });
    record.resources = resources.length;
    const ui = resources.filter(isUiResource);
    record.uiResources = [];
    for (const resource of ui.slice(0, maxResources)) {
      const entry = { uri: resource.uri, mimeType: resource.mimeType ?? null, isMcpApp: resource.mimeType === UI_MIME, list: analyzeUiMeta(resource._meta) };
      try {
        const contents = await client.readResource(resource.uri);
        const first = contents[0] ?? null;
        entry.read = analyzeUiMeta(first?._meta);
        entry.listVsRead = compareListRead(resource._meta, first?._meta);
        if (typeof first?.text === 'string') entry.html = withSinkHosts(analyzeHtml(first.text));
      } catch (error) {
        entry.readError = failureKind(error);
      }
      record.uiResources.push(entry);
    }
    record.uiResourceCount = ui.length;
    const tools = await client.listTools().catch((error) => {
      record.toolsError = failureKind(error);
      return [];
    });
    record.tools = analyzeTools(tools);
  } catch (error) {
    record.error = { kind: failureKind(error), message: String(error.message).slice(0, 160) };
  }
  await appendJsonl(out, record);
  processed += 1;
  process.stdout.write(`\rremote: ${processed}/${servers.length}`);
});
process.stdout.write('\n');
console.log(`written to ${path.relative(process.cwd(), out)}`);
