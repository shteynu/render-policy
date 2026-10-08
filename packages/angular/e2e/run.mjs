/**
 * Browser proof for @render-policy/angular: bundles e2e/app.ts over the ng-packagr
 * output with esbuild, serves it, and checks in Chromium that the directive and the
 * component render through the policy, never write innerHTML, stream without
 * requesting incomplete URLs, and run under Trusted Types enforcement; and that the A2UI
 * Text and Image components (@render-policy/angular/a2ui) make no request the policy refuses.
 *
 * Usage: npm run build && node packages/angular/e2e/run.mjs
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { createChecker, launchBrowser, openPage, repoRoot, startServer } from '../../../e2e/lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const fesm = path.join(repoRoot, 'packages/angular/dist/fesm2022/render-policy-angular.mjs');
const fesmA2ui = path.join(repoRoot, 'packages/angular/dist/fesm2022/render-policy-angular-a2ui.mjs');

await build({
  entryPoints: [path.join(here, 'app.ts')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  sourcemap: true,
  outfile: path.join(here, 'dist/app.js'),
  tsconfig: path.join(here, 'tsconfig.json'),
  alias: { '@render-policy/angular/a2ui': fesmA2ui, '@render-policy/angular': fesm },
  absWorkingDir: repoRoot,
  logLevel: 'warning',
});

// The application is JIT-compiled here, so Angular's compiler needs 'unsafe-eval' and creates
// its own Trusted Types policies (angular, angular#unsafe-jit). Both belong to the test harness,
// not to the library under test: an AOT build needs neither. `require-trusted-types-for 'script'`
// is enforced either way, which is what this run checks.
const CSP =
  "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src * data:; " +
  "require-trusted-types-for 'script'; trusted-types dompurify angular angular#unsafe-jit angular#unsafe-bypass";

const { base, requests, close } = await startServer({ cspFor: (url) => (url.searchParams.get('csp') === '1' ? CSP : undefined) });
const browser = await launchBrowser();
const { check, finish } = createChecker('@render-policy/angular in Chromium');
const open = (query = '') => openPage(browser, base, `/packages/angular/e2e/index.html${query}`, { readyFlag: '__angularReady' });

try {
  {
    const { page, external, errors } = await open();
    check(errors.length === 0, 'directive: no page errors', errors.join(' | '));
    check((await page.locator('#directive h1').textContent()) === 'Hello', 'directive: Markdown rendered through [rpRender]');
    check((await page.evaluate(() => window.__pwned)) === undefined, 'directive: onerror payload did not run');
    check((await page.locator('#directive img[onerror]').count()) === 0, 'directive: onerror attribute stripped');
    check((await page.locator('#directive a.rp-blocked-image').count()) === 1, 'directive: remote image replaced by a placeholder');
    check((await page.locator('#directive form, #directive input').count()) === 0, 'directive: form removed');
    check(external.length === 0, 'directive: no off-origin request', external.join(' '));
    const writes = await page.evaluate(() => window.__innerHTMLWritesInApp);
    check(writes.length === 0, 'directive: no innerHTML write inside the application', writes.join(' '));

    await page.evaluate(() => {
      window.__app.setContent('## Updated\n\n[link](javascript:alert(1)) [ok](https://example.com/)');
      window.__app.tick();
    });
    await page.waitForTimeout(100);
    check((await page.locator('#directive h2').textContent()) === 'Updated', 'directive: re-renders on input change');
    const hrefs = await page.locator('#directive a').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
    check(JSON.stringify(hrefs) === JSON.stringify([null, 'https://example.com/']), 'directive: javascript: link dropped, https link kept', hrefs.join(' '));

    const pixel = `${base}/demo/ok.svg?ng-stream=1`;
    const countPixel = () => requests.filter((r) => r.includes('ng-stream=1')).length;
    const step = async (text) => {
      await page.evaluate((value) => {
        window.__app.setStream(value);
        window.__app.tick();
      }, text);
      await page.waitForTimeout(250);
    };
    await step(`# Chart\n\nSee: ![c](${pixel.slice(0, pixel.length - 10)}`);
    const headingKept = () => page.evaluate(() => {
      const h1 = document.querySelector('#component h1');
      if (!window.__h1) window.__h1 = h1;
      return window.__h1 === h1;
    });
    await headingKept();
    check((await page.locator('#component img').count()) === 0 && countPixel() === 0, 'component: incomplete image withheld while streaming', `${countPixel()}`);
    await step(`# Chart\n\nSee: ![c](${pixel}`);
    check(countPixel() === 0, 'component: still no request before the closing parenthesis', `${countPixel()}`);
    await step(`# Chart\n\nSee: ![c](${pixel}) done`);
    await page.waitForTimeout(300);
    check(countPixel() === 1 && (await page.locator('#component img').count()) === 1, 'component: image requested once, after the URL closed', `${countPixel()}`);
    check(await headingKept(), 'component: settled heading node kept across streaming updates');
    await page.evaluate(() => {
      window.__app.setStreaming(false);
      window.__app.tick();
    });
    await page.waitForTimeout(200);
    check((await page.locator('#component').textContent()).includes('done') && countPixel() === 1, 'component: final render after streaming ends, no extra request');
    check(await headingKept(), 'component: heading node kept through the final render');
    const dpixel = `${base}/demo/ok.svg?ng-dstream=1`;
    const countDirectivePixel = () => requests.filter((r) => r.includes('ng-dstream=1')).length;
    const directiveStep = async (text) => {
      await page.evaluate((value) => {
        window.__app.setDirectiveStream(value);
        window.__app.tick();
      }, text);
      await page.waitForTimeout(250);
    };
    await directiveStep(`# Live\n\n![d](${dpixel.slice(0, dpixel.length - 10)}`);
    check((await page.locator('#directive-stream img').count()) === 0 && countDirectivePixel() === 0, 'directive streaming: incomplete image withheld', `${countDirectivePixel()}`);
    await directiveStep(`# Live\n\n![d](${dpixel}) done`);
    await page.waitForTimeout(300);
    check(countDirectivePixel() === 1 && (await page.locator('#directive-stream img').count()) === 1, 'directive streaming: image requested once, after the URL closed', `${countDirectivePixel()}`);
    await page.evaluate(() => {
      window.__app.setDirectiveStreaming(false);
      window.__app.tick();
    });
    await page.waitForTimeout(200);
    check((await page.locator('#directive-stream').textContent()).includes('done') && countDirectivePixel() === 1, 'directive streaming: final render after streaming ends, no extra request');

    const countA2ui = () => requests.filter((r) => r.includes('ng-a2ui=1')).length;
    check((await page.locator('#a2ui-text strong').textContent()) === 'Report', 'a2ui text: Markdown rendered');
    check((await page.locator('#a2ui-text img, #a2ui-text a').count()) === 0, 'a2ui text: no image or link (the catalog contract)');
    check((await page.evaluate(() => window.__pwned)) === undefined, 'a2ui text: onerror payload did not run');
    check(countA2ui() === 1 && (await page.locator('#a2ui-image img').count()) === 1, 'a2ui image: same-origin URL rendered and requested once', `${countA2ui()}`);
    await page.evaluate(() => {
      window.__app.setA2uiUrl('https://evil.example/a2ui-image.png?d=secret');
      window.__app.setA2uiText('Done. <img src="https://evil.example/a2ui-swap.png">');
      window.__app.tick();
    });
    await page.waitForTimeout(250);
    check((await page.locator('#a2ui-image img').count()) === 0 && (await page.locator('#a2ui-image .blocked').count()) === 1, 'a2ui image: swapped remote URL never reaches the DOM, fallback projected');
    check((await page.locator('#a2ui-text').textContent()).startsWith('Done.') && (await page.locator('#a2ui-text img').count()) === 0, 'a2ui text: swapped value re-rendered without an image');
    check(!external.some((u) => u.includes('evil.example')), 'a2ui: no request to the remote host from Text or Image', external.join(' '));

    const writesAfter = await page.evaluate(() => window.__innerHTMLWritesInApp);
    check(writesAfter.length === 0, 'component: no innerHTML write inside the application', writesAfter.join(' '));
    const decisions = await page.evaluate(() => window.__decisions.length);
    check(decisions > 0, 'provider: onDecision journal reaches the application', `${decisions}`);
    await page.close();
  }

  {
    const { page, errors } = await open('?csp=1');
    const violations = await page.evaluate(() => window.__cspViolations);
    check(violations.length === 0, 'trusted types: zero securitypolicyviolation events', violations.join(' | '));
    check(errors.length === 0, 'trusted types: no page errors', errors.join(' | '));
    check((await page.locator('#directive h1').textContent()) === 'Hello', 'trusted types: directive renders under enforcement');
    check((await page.locator('#a2ui-text strong').textContent()) === 'Report', 'trusted types: a2ui text renders under enforcement');
    await page.close();
  }
} finally {
  await browser.close();
  close();
}

process.exit(finish() === 0 ? 0 : 1);
