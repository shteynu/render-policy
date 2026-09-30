/**
 * Parity check between the policy's URL classification and Chromium's URL parser.
 *
 * For every string in the corpus, the browser is asked what an <a href> (set as an attribute
 * and also parsed from HTML markup, so entities decode) resolves to. The policy must:
 *   1. block every string the browser resolves to a scheme outside the allowlist (no under-block);
 *   2. agree with the browser on the scheme and the hostname of every string it allows;
 *   3. after sanitization, leave no href or src whose browser-resolved scheme is outside the allowlist.
 * Over-blocking (the browser resolves to https, the policy blocks) is reported but does not fail.
 *
 * Usage: node e2e/url-parity.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { createChecker, launchBrowser, openPage, repoRoot, startServer } from './lib/harness.mjs';
import { generateUrlCorpus } from './lib/url-corpus.mjs';

const buildDir = path.join(repoRoot, 'e2e/.build');
await mkdir(buildDir, { recursive: true });
await writeFile(
  path.join(buildDir, 'url-parity.entry.mjs'),
  [
    `import { checkUrl, createRenderer, MODE_PRESETS } from ${JSON.stringify(path.join(repoRoot, 'packages/core/src/index.ts'))};`,
    'window.__checkUrl = checkUrl;',
    'window.__policy = MODE_PRESETS.balanced.urls;',
    "window.__renderer = createRenderer({ mode: 'permissive' });",
    'window.__ready = true;',
  ].join('\n'),
);
await build({ entryPoints: [path.join(buildDir, 'url-parity.entry.mjs')], bundle: true, format: 'esm', target: 'es2022', outfile: path.join(buildDir, 'url-parity.js'), absWorkingDir: repoRoot, logLevel: 'warning' });
await writeFile(path.join(buildDir, 'url-parity.html'), '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>url parity</title></head><body><script type="module" src="./url-parity.js"></script></body></html>\n');

const corpus = generateUrlCorpus();
const { base, close } = await startServer();
const browser = await launchBrowser();
const { check, finish } = createChecker(`URL parity with Chromium (${corpus.length} strings)`);

try {
  const { page } = await openPage(browser, base, '/e2e/.build/url-parity.html', { readyFlag: '__ready', settle: 50 });
  const result = await page.evaluate((strings) => {
    const allowed = new Set(window.__policy.allowedSchemes);
    const anchor = document.createElement('a');
    const template = document.createElement('template');
    const resolve = (value) => {
      anchor.setAttribute('href', value);
      const protocol = anchor.protocol;
      return { scheme: protocol && protocol !== ':' ? protocol.slice(0, -1).toLowerCase() : '', hostname: anchor.hostname.toLowerCase() };
    };
    const decodeThroughMarkup = (value) => {
      template.innerHTML = `<a href="${value.replace(/"/g, '&quot;')}"></a>`; // parity oracle only
      return template.content.querySelector('a')?.getAttribute('href') ?? value;
    };
    const failures = { underBlock: [], schemeMismatch: [], hostMismatch: [], survived: [] };
    let overBlock = 0;
    const overBlockSamples = [];
    let dangerousSeen = 0;
    let checked = 0;
    for (const raw of strings) {
      for (const value of new Set([raw, decodeThroughMarkup(raw)])) {
        checked += 1;
        const browser = resolve(value);
        const ours = window.__checkUrl(value, window.__policy, location.href);
        if (browser.scheme && !allowed.has(browser.scheme)) {
          dangerousSeen += 1;
          if (ours.ok) failures.underBlock.push({ value, browser });
          continue;
        }
        if (browser.scheme && allowed.has(browser.scheme)) {
          if (!ours.ok) {
            overBlock += 1;
            if (overBlockSamples.length < 6) overBlockSamples.push({ value, browser, reason: ours.reason });
            continue;
          }
          if (ours.parsed.scheme !== browser.scheme) failures.schemeMismatch.push({ value, browser, ours: ours.parsed.scheme });
          if (ours.parsed.url.hostname.toLowerCase() !== browser.hostname) {
            failures.hostMismatch.push({ value, browser, ours: ours.parsed.url.hostname });
          }
        }
      }
    }
    // End to end: after sanitization no surviving href/src resolves to a scheme outside the allowlist.
    const holder = document.createElement('div');
    for (const raw of strings) {
      const attribute = raw.replace(/"/g, '&quot;');
      const { fragment } = window.__renderer.sanitizeHtml(`<a href="${attribute}">x</a><img src="${attribute}"><a href="${attribute}">y</a>`);
      holder.replaceChildren(fragment);
      for (const element of holder.querySelectorAll('[href], [src]')) {
        const value = element.getAttribute('href') ?? element.getAttribute('src') ?? '';
        const browser = resolve(value);
        if (browser.scheme && !allowed.has(browser.scheme)) failures.survived.push({ value, raw, browser });
      }
    }
    return { checked, dangerousSeen, overBlock, overBlockSamples, failures };
  }, corpus);

  const show = (list) => list.slice(0, 8).map((f) => JSON.stringify(f)).join('\n      ');
  check(result.failures.underBlock.length === 0, `no under-block: every string Chromium resolves to a non-allowlisted scheme is blocked (${result.dangerousSeen} dangerous resolutions)`, show(result.failures.underBlock));
  check(result.failures.schemeMismatch.length === 0, 'scheme agreement on every allowed URL', show(result.failures.schemeMismatch));
  check(result.failures.hostMismatch.length === 0, 'hostname agreement on every allowed absolute URL', show(result.failures.hostMismatch));
  check(result.failures.survived.length === 0, 'after sanitization no href/src resolves outside the allowlist', show(result.failures.survived));
  console.log(`info checked ${result.checked} values; over-blocked ${result.overBlock} strings that Chromium resolves to an allowed scheme (accepted: those carry control characters or look-alikes)`);
  for (const sample of result.overBlockSamples) console.log(`      over-block sample: ${JSON.stringify(sample)}`);
  await page.close();
} finally {
  await browser.close();
  close();
}

process.exit(finish() === 0 ? 0 : 1);
