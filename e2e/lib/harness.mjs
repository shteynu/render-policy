/**
 * Shared harness for the browser proofs: a static server over the repository,
 * a Chromium launcher that falls back to the preinstalled browser, request
 * interception that records and aborts every off-origin request, and a tiny
 * check/report helper.
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json',
};

/**
 * Serve `root` on 127.0.0.1. `cspFor(url)` may return a Content-Security-Policy
 * header value for a document request. Every request path is recorded.
 */
export async function startServer({ root = repoRoot, cspFor = () => undefined } = {}) {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let url;
    let pathname;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
      pathname = decodeURIComponent(url.pathname);
    } catch {
      requests.push(req.url ?? '');
      res.writeHead(400).end('bad request');
      return;
    }
    requests.push(url.pathname + url.search);
    const file = path.join(root, pathname);
    if (!file.startsWith(root)) {
      res.writeHead(403).end();
      return;
    }
    try {
      const body = await readFile(file);
      const headers = { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream' };
      const csp = cspFor(url);
      if (csp) headers['content-security-policy'] = csp;
      res.writeHead(200, headers).end(body);
    } catch {
      res.writeHead(404).end('not found');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return { base: `http://127.0.0.1:${port}`, requests, close: () => server.close() };
}

export async function launchBrowser() {
  const preferred = chromium.executablePath();
  const executablePath = process.env.RP_CHROMIUM ?? (existsSync(preferred) ? undefined : '/opt/pw-browsers/chromium');
  return chromium.launch({ executablePath });
}

/** Open a page; off-origin requests are recorded in `external` and aborted. */
export async function openPage(browser, base, pathAndQuery, { readyFlag, settle = 300 } = {}) {
  const page = await browser.newPage();
  const external = [];
  await page.route('**/*', (route) => {
    const raw = route.request().url();
    let origin = null;
    try {
      origin = new URL(raw).origin;
    } catch {
      origin = null; // Chromium issued a request Node's URL parser rejects: treat as off-origin
    }
    if (origin === base) return route.continue();
    external.push(raw);
    return route.abort();
  });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`${base}${pathAndQuery}`);
  if (readyFlag) await page.waitForFunction((flag) => window[flag] === true, readyFlag);
  await page.waitForTimeout(settle);
  return { page, external, errors };
}

export function createChecker(title) {
  let failures = 0;
  console.log(`\n== ${title}`);
  return {
    check(ok, label, detail = '') {
      console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? `  (${detail})` : ''}`);
      if (!ok) failures += 1;
    },
    get failures() {
      return failures;
    },
    finish() {
      console.log(failures === 0 ? `all checks passed: ${title}` : `${failures} check(s) failed: ${title}`);
      return failures;
    },
  };
}
