/**
 * Snapshot of the official MCP registry: every server, normalized, to census/data/registry.json.
 *   node census/collect-registry.mjs [--budget-seconds N]   # checkpoints and resumes when the budget runs out
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, ensureDataDir } from './lib/io.mjs';
import { latestOnly, listAllServers } from './lib/registry.mjs';

await ensureDataDir();
const partialFile = path.join(dataDir, 'registry.partial.json');
const budget = Number(process.argv[process.argv.indexOf('--budget-seconds') + 1] || 0);
const deadline = process.argv.includes('--budget-seconds') ? Date.now() + budget * 1000 : Infinity;
let resume = null;
try {
  resume = JSON.parse(await readFile(partialFile, 'utf8'));
  console.log(`resuming from a checkpoint with ${resume.servers.length} entries`);
} catch {
  resume = null;
}
const { servers, cursor, complete } = await listAllServers({
  resume,
  deadline,
  onPage: ({ page, total }) => {
    if (page % 25 === 0) console.log(`registry: +${page} pages, ${total} entries`);
  },
});
if (!complete) {
  await writeFile(partialFile, JSON.stringify({ cursor, servers }));
  console.log(`checkpoint: ${servers.length} entries, run again to continue`);
  process.exit(0);
}
await rm(partialFile, { force: true });
const latest = latestOnly(servers);
const transports = {};
for (const server of latest) for (const remote of server.remotes) transports[remote.type] = (transports[remote.type] ?? 0) + 1;
const packageRegistries = {};
for (const server of latest) for (const pkg of server.packages) packageRegistries[pkg.registry] = (packageRegistries[pkg.registry] ?? 0) + 1;
const snapshot = { collectedAt: new Date().toISOString(), total: servers.length, latest: latest.length, transports, packageRegistries, servers: latest };
await writeFile(path.join(dataDir, 'registry.json'), JSON.stringify(snapshot, null, 1));
console.log(`servers ${servers.length}, latest versions ${latest.length}, with remotes ${latest.filter((s) => s.remotes.length).length}, with packages ${latest.filter((s) => s.packages.length).length}`);
console.log('transports', transports, 'package registries', packageRegistries);
