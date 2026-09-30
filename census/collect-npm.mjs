/**
 * Static census over npm: packages found by keyword searches and npm packages named in the
 * MCP registry. Metadata for every candidate; tarballs downloaded and scanned only for packages
 * that depend on a UI SDK (ext-apps, mcp-ui). Output: census/data/npm-packages.jsonl.
 *   node census/collect-npm.mjs [--limit N] [--concurrency 6] [--only name]
 */
import { mkdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { appendJsonl, argValue, dataDir, ensureDataDir, mapLimit, readJsonl } from './lib/io.mjs';
import { packageMeta, scanPackage, searchPackages } from './lib/npm.mjs';

await ensureDataDir();
const out = path.join(dataDir, 'npm-packages.jsonl');
const limit = Number(argValue('--limit', '0'));
const concurrency = Number(argValue('--concurrency', '6'));
const only = argValue('--only', null);
const done = new Set((await readJsonl(out)).map((r) => r.name));

const candidates = new Set();
const sources = new Map();
const add = (name, source) => {
  if (!name) return;
  candidates.add(name);
  sources.set(name, [...(sources.get(name) ?? []), source]);
};
for (const query of ['keywords:mcp-apps', 'keywords:mcp-app', 'keywords:ext-apps', 'keywords:mcp-ui']) {
  const names = await searchPackages(query, { max: 1000 });
  for (const name of names) add(name, query);
  console.log(`search ${query}: ${names.length}`);
}
try {
  const registry = JSON.parse(await readFile(path.join(dataDir, 'registry.json'), 'utf8'));
  for (const server of registry.servers) for (const pkg of server.packages) if (pkg.registry === 'npm') add(pkg.identifier, 'mcp-registry');
  console.log(`registry npm packages added; candidates now ${candidates.size}`);
} catch {
  console.log('no registry snapshot (run collect-registry.mjs first); using search results only');
}

let list = [...candidates].filter((n) => !done.has(n));
if (only) list = list.filter((n) => n === only);
if (limit) list = list.slice(0, limit);
console.log(`candidates ${candidates.size}, already done ${done.size}, to process ${list.length}`);

const work = path.join(os.tmpdir(), 'mcp-ui-census');
await mkdir(work, { recursive: true });
let processed = 0;
await mapLimit(list, concurrency, async (name) => {
  const record = { name, sources: sources.get(name) ?? [], collectedAt: new Date().toISOString() };
  try {
    const meta = await packageMeta(name);
    Object.assign(record, { version: meta.version, uiSdks: meta.uiSdks, dependsOnMcpSdk: meta.dependsOnMcpSdk, unpackedSize: meta.unpackedSize });
    if (meta.uiSdks.length > 0 && meta.tarball) {
      const scan = await scanPackage(meta, work);
      record.scan = scan;
    } else {
      record.scan = null;
    }
  } catch (error) {
    record.error = { kind: error.kind ?? (error.status ? `http-${error.status}` : 'error'), message: String(error.message).slice(0, 200) };
  }
  await appendJsonl(out, record);
  processed += 1;
  if (processed % 100 === 0 || processed === list.length) console.log(`npm: ${processed}/${list.length}`);
});
process.stdout.write('\n');
await rm(work, { recursive: true, force: true });
console.log(`written to ${path.relative(process.cwd(), out)}`);
