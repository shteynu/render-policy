/**
 * Bundle sizes of the published packages: own code (dependencies external) and, for the core,
 * everything a page would ship (DOMPurify and marked included). Minified with esbuild,
 * then gzip and brotli. Run after `npm run build`:
 *   node scripts/size.mjs [--json]
 */
import { build } from 'esbuild';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`;

async function measure({ label, entry, external }) {
  const result = await build({
    entryPoints: [entry],
    bundle: true,
    minify: true,
    format: 'esm',
    target: 'es2022',
    write: false,
    external,
    absWorkingDir: root,
    logLevel: 'silent',
  });
  const code = Buffer.from(result.outputFiles[0].contents);
  return {
    label,
    minified: code.length,
    gzip: gzipSync(code, { level: 9 }).length,
    brotli: brotliCompressSync(code, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  };
}

async function packageInfo(dir) {
  const pkg = JSON.parse(await readFile(path.join(root, 'packages', dir, 'package.json'), 'utf8'));
  const deps = Object.keys(pkg.dependencies ?? {});
  const peers = Object.keys(pkg.peerDependencies ?? {});
  return { pkg, deps, peers };
}

const targets = [];
{
  const { pkg, deps } = await packageInfo('core');
  const entry = 'packages/core/dist/index.js';
  targets.push({ label: `${pkg.name} (own code)`, entry, external: deps });
  targets.push({ label: `${pkg.name} + dompurify + marked (everything a page ships)`, entry, external: [] });
}
for (const dir of ['react', 'mermaid', 'a2ui']) {
  const { pkg, deps, peers } = await packageInfo(dir);
  targets.push({ label: `${pkg.name} (own code)`, entry: `packages/${dir}/dist/index.js`, external: [...deps, ...peers, '@render-policy/core'] });
}
{
  const { pkg, deps, peers } = await packageInfo('angular');
  const entry = 'packages/angular/dist/fesm2022/render-policy-angular.mjs';
  if (existsSync(path.join(root, entry))) targets.push({ label: `${pkg.name} (own code)`, entry, external: [...deps, ...peers, '@angular/*', 'rxjs', '@render-policy/core'] });
}

const rows = [];
for (const target of targets) {
  if (!existsSync(path.join(root, target.entry))) throw new Error(`scripts/size.mjs: ${target.entry} missing; run npm run build first`);
  rows.push(await measure(target));
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  console.log('| Bundle | minified | gzip | brotli |');
  console.log('| --- | --- | --- | --- |');
  for (const row of rows) console.log(`| ${row.label} | ${kb(row.minified)} | ${kb(row.gzip)} | ${kb(row.brotli)} |`);
}
