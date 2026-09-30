/**
 * Builds the static demo site (site/): the demo bundled with esbuild, an index page,
 * and a trusted-types.html variant that enforces `require-trusted-types-for 'script'`
 * through a CSP meta tag. Deployed to GitHub Pages by .github/workflows/pages.yml.
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'site');
await mkdir(out, { recursive: true });

await build({
  entryPoints: [path.join(root, 'demo/demo.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outfile: path.join(out, 'demo.js'),
  absWorkingDir: root,
  logLevel: 'warning',
});

const source = await readFile(path.join(root, 'demo/index.html'), 'utf8');
const page = source
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, '')
  .replace('href="/demo/demo.css"', 'href="./demo.css"')
  .replace('src="/demo/demo.js"', 'src="./demo.js"');
if (page.includes('/demo/') || page.includes('importmap')) throw new Error('demo/build.mjs: index.html rewrite incomplete');
await writeFile(path.join(out, 'index.html'), page);

const meta = `<meta http-equiv="Content-Security-Policy" content="require-trusted-types-for 'script'; trusted-types dompurify">`;
await writeFile(path.join(out, 'trusted-types.html'), page.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n  ${meta}`));
await cp(path.join(root, 'demo/demo.css'), path.join(out, 'demo.css'));
await cp(path.join(root, 'demo/ok.svg'), path.join(out, 'ok.svg'));
console.log(`demo site written to ${path.relative(root, out)}/`);
