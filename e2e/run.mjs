/**
 * Browser proof for @render-policy/core in a real Chromium:
 *   1. the naive panel executes the payload and requests attacker hosts;
 *   2. the policy panel executes nothing and requests nothing off-origin;
 *   3. the policy panel works under `require-trusted-types-for 'script'` with zero violations,
 *      and trustedHTML() goes through the allowed `dompurify` policy;
 *   4. a streamed image URL is requested exactly once, after it is complete.
 *
 * Usage: npm run build -w packages/core && node e2e/run.mjs
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};
const CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src * data:; require-trusted-types-for 'script'; trusted-types dompurify";

const requests = [];
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  requests.push(url.pathname + url.search);
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const body = await readFile(file);
    const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' };
    if (url.searchParams.get('csp') === '1') headers['content-security-policy'] = CSP;
    res.writeHead(200, headers).end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const defaultExecutable = chromium.executablePath();
const executablePath = process.env.RP_CHROMIUM ?? (existsSync(defaultExecutable) ? undefined : '/opt/pw-browsers/chromium');
const browser = await chromium.launch({ executablePath });

let failures = 0;
const check = (ok, label, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures += 1;
};

async function open(query) {
  const page = await browser.newPage();
  const external = [];
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    external.push(url.href);
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}/demo/index.html?${query}`);
  await page.waitForFunction(() => window.__demoReady === true);
  await page.waitForTimeout(300);
  return { page, external, errors };
}

try {
  {
    const { page, external } = await open('mode=naive');
    const pwned = await page.evaluate(() => window.__pwned);
    check(pwned.onerror === true, 'naive: <img onerror> payload executed', JSON.stringify(pwned));
    check(external.some((u) => u.includes('evil.example')), 'naive: request to attacker host attempted', external.join(' '));
    check(await page.locator('#naive form input[type=password]').count() === 1, 'naive: phishing form rendered');
    await page.close();
  }

  {
    const { page, external, errors } = await open('mode=policy');
    const pwned = await page.evaluate(() => window.__pwned);
    check(Object.keys(pwned).length === 0, 'policy: no payload executed', JSON.stringify(pwned));
    check(external.length === 0, 'policy: no off-origin request', external.join(' '));
    check(errors.length === 0, 'policy: no page errors', errors.join(' | '));
    check(await page.locator('#policy h1').textContent() === 'Assistant reply', 'policy: content rendered');
    check(await page.locator('#policy form, #policy input, #policy style, #policy svg, #policy [style], #policy [onerror]').count() === 0, 'policy: forms, styles, svg, handlers removed');
    check(await page.locator('#policy a.rp-blocked-image').count() === 2, 'policy: two remote images replaced by placeholders');
    const images = await page.locator('#policy img').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('src')));
    check(images.length === 2 && images.every((src) => src.startsWith('/')), 'policy: only same-origin images kept (onerror stripped from the first)', images.join(' '));
    const links = await page.locator('#policy a:not(.rp-blocked-image)').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('href')));
    check(links.every((h) => h === null || h.startsWith('https://example.com/')), 'policy: javascript: link neutralized', links.join(' '));
    const decisions = await page.evaluate(() => window.__decisions.length);
    check(decisions >= 8, 'policy: decisions journaled', `${decisions}`);
    await page.close();
  }

  {
    const { page, errors } = await open('mode=policy&csp=1');
    const violations = await page.evaluate(() => window.__cspViolations);
    check(violations.length === 0, 'trusted types: zero securitypolicyviolation events', violations.join(' | '));
    check(errors.length === 0, 'trusted types: no page errors', errors.join(' | '));
    check(await page.locator('#policy h1').textContent() === 'Assistant reply', 'trusted types: content rendered under enforcement');
    const escapeHatch = await page.evaluate(() => {
      const out = window.__renderer.trustedHTML('<b>bold</b><img src=x onerror=alert(1)>');
      const div = document.createElement('div');
      div.innerHTML = out;
      return { type: typeof out, isTrusted: typeof TrustedHTML !== 'undefined' && out instanceof TrustedHTML, html: div.innerHTML };
    });
    check(escapeHatch.isTrusted && escapeHatch.html === '<b>bold</b><img src="x">', 'trusted types: trustedHTML() returns a TrustedHTML through the dompurify policy', JSON.stringify(escapeHatch));
    await page.close();
  }

  {
    const { page } = await open('mode=both&csp=1');
    const naiveLog = await page.locator('#naive-log').textContent();
    check(naiveLog.includes('innerHTML rejected'), 'trusted types: the naive innerHTML path is rejected', naiveLog);
    await page.close();
  }

  {
    const { page } = await open('mode=policy');
    const before = requests.length;
    const pixel = `${base}/demo/ok.svg?stream=1`;
    const countPixel = () => requests.filter((r) => r.includes('stream=1')).length;
    await page.evaluate((url) => {
      window.__stream = window.__renderer.createStream(document.getElementById('stream'));
      window.__stream.push(`Look at this: ![chart](${url.slice(0, url.length - 8)}`);
    }, pixel);
    await page.waitForTimeout(300);
    check(countPixel() === 0, 'streaming: no request while the image URL is open', `${countPixel()}`);
    await page.evaluate((tail) => window.__stream.push(tail), pixel.slice(-8));
    await page.waitForTimeout(300);
    check(countPixel() === 0, 'streaming: still no request before the closing parenthesis', `${countPixel()}`);
    await page.evaluate(() => window.__stream.push(') done'));
    await page.waitForTimeout(500);
    check(countPixel() === 1, 'streaming: exactly one request once the image is complete', `${countPixel()}`);
    check(await page.locator('#stream img').count() === 1, 'streaming: image rendered');
    void before;
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}

console.log(failures === 0 ? '\nall browser checks passed' : `\n${failures} browser check(s) failed`);
process.exit(failures === 0 ? 0 : 1);
