import { appendFile, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const censusRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = path.join(censusRoot, 'data');

export async function ensureDataDir() {
  await mkdir(dataDir, { recursive: true });
}

export async function readJsonl(file) {
  try {
    const text = await readFile(file, 'utf8');
    return text.split('\n').filter(Boolean).map((line) => JSON.parse(line));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
}

/**
 * The last record per name, in file order. Collectors only append, so a server probed again
 * (`--retry`) has several records; the latest one is the result.
 */
export function latestByName(records) {
  const latest = new Map();
  for (const record of records) {
    latest.delete(record.name);
    latest.set(record.name, record);
  }
  return [...latest.values()];
}

/** Names whose latest record is final: absent from the result are servers never probed, and those whose last probe failed with a kind listed in `retry`. */
export function finishedNames(records, retry = new Set()) {
  return new Set(latestByName(records).filter((r) => !retry.has(r.error?.kind)).map((r) => r.name));
}

export async function appendJsonl(file, record) {
  await appendFile(file, `${JSON.stringify(record)}\n`);
}

export function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index === -1 ? fallback : process.argv[index + 1];
}

export function hasFlag(name) {
  return process.argv.includes(name);
}

/** Run `worker` over `items` with at most `limit` in flight. */
export async function mapLimit(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
  return results;
}
