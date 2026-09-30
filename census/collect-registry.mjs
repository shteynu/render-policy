/**
 * Snapshot of the official MCP registry: every server, normalized, to census/data/registry.json.
 *   node census/collect-registry.mjs
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dataDir, ensureDataDir } from './lib/io.mjs';
import { latestOnly, listAllServers } from './lib/registry.mjs';

await ensureDataDir();
const servers = await listAllServers({ onPage: ({ page, total }) => { if (page % 25 === 0) console.log(`registry: page ${page}, ${total} entries`); } });
const latest = latestOnly(servers);
const transports = {};
for (const server of latest) for (const remote of server.remotes) transports[remote.type] = (transports[remote.type] ?? 0) + 1;
const packageRegistries = {};
for (const server of latest) for (const pkg of server.packages) packageRegistries[pkg.registry] = (packageRegistries[pkg.registry] ?? 0) + 1;
const snapshot = { collectedAt: new Date().toISOString(), total: servers.length, latest: latest.length, transports, packageRegistries, servers: latest };
await writeFile(path.join(dataDir, 'registry.json'), JSON.stringify(snapshot, null, 1));
console.log(`servers ${servers.length}, latest versions ${latest.length}, with remotes ${latest.filter((s) => s.remotes.length).length}, with packages ${latest.filter((s) => s.packages.length).length}`);
console.log('transports', transports, 'package registries', packageRegistries);
