/**
 * Checks the static demo site (site/, built by demo/build.mjs) the way GitHub Pages serves it:
 * no headers, relative paths. The trusted-types.html variant must render the policy panel
 * with zero CSP violations and reject the naive innerHTML path.
 */
import path from 'node:path';
import { createChecker, launchBrowser, openPage, repoRoot, startServer } from './lib/harness.mjs';

const { base, close } = await startServer({ root: path.join(repoRoot, 'site') });
const browser = await launchBrowser();
const { check, finish } = createChecker('static demo site (Pages build)');

try {
  {
    const { page, errors, external } = await openPage(browser, base, '/index.html?mode=policy', { readyFlag: '__demoReady' });
    check(errors.length === 0, 'site: no page errors', errors.join(' | '));
    check((await page.locator('#policy h1').textContent()) === 'Assistant reply', 'site: policy panel rendered from the bundle');
    check(external.length === 0, 'site: no off-origin request', external.join(' '));
    check((await page.locator('#policy img').count()) === 2, 'site: same-origin images resolve relative to the page');
    await page.close();
  }
  {
    const { page, errors } = await openPage(browser, base, '/trusted-types.html?mode=both', { readyFlag: '__demoReady' });
    const violations = await page.evaluate(() => window.__cspViolations);
    check((await page.locator('#policy h1').textContent()) === 'Assistant reply', 'site/trusted-types: policy panel rendered under enforcement');
    check((await page.locator('#naive-log').textContent()).includes('innerHTML rejected'), 'site/trusted-types: naive innerHTML rejected');
    check(violations.every((v) => v.includes('require-trusted-types-for')) && violations.length === 1, 'site/trusted-types: the only violation is the naive panel', violations.join(' | '));
    check(errors.length === 0, 'site/trusted-types: no uncaught errors', errors.join(' | '));
    await page.close();
  }
} finally {
  await browser.close();
  close();
}

process.exit(finish() === 0 ? 0 : 1);
