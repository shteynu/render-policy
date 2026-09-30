/**
 * Runs the evil-Markdown corpus against one or more renderer adapters in a real Chromium.
 *
 *   node corpus/run.mjs                         # the three bundled adapters
 *   node corpus/run.mjs --adapter ./my.mjs      # your renderer (see corpus/README.md)
 *   node corpus/run.mjs --results corpus/RESULTS.md --json out.json
 *   node corpus/run.mjs --require-pass render-policy   # exit 1 if that adapter fails a case
 *
 * An adapter is an ES module whose default export is { name, render(container, markdown),
 * createStream?(container) }. It is bundled with esbuild, so it may import npm packages.
 */
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { launchBrowser, openPage, repoRoot, startServer } from '../e2e/lib/harness.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const option = (name) => {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
};
const adapterPaths = [];
for (let i = 0; i < args.length; i += 1) if (args[i] === '--adapter') adapterPaths.push(path.resolve(args[i + 1]));
if (adapterPaths.length === 0) {
  adapterPaths.push(...['naive', 'dompurify-default', 'render-policy'].map((n) => path.join(here, 'adapters', `${n}.mjs`)));
}
const only = option('--only');
const resultsFile = option('--results');
const jsonFile = option('--json');
const requirePass = option('--require-pass');

const corpus = JSON.parse(await readFile(path.join(here, 'evil-markdown.json'), 'utf8'));
const cases = corpus.cases.filter((c) => !only || c.id === only);

const buildDir = path.join(here, '.build');
await mkdir(buildDir, { recursive: true });
await copyFile(path.join(repoRoot, 'demo/ok.svg'), path.join(buildDir, 'ok.svg'));

async function bundle(adapterPath) {
  const key = path.basename(adapterPath, path.extname(adapterPath));
  const entry = path.join(buildDir, `${key}.entry.mjs`);
  await writeFile(
    entry,
    [
      `import adapter from ${JSON.stringify(adapterPath)};`,
      `import { evaluate } from ${JSON.stringify(path.join(here, 'lib/evaluate.js'))};`,
      'window.__adapter = adapter;',
      'window.__evaluate = evaluate;',
      'window.__pwned = {};',
      'window.p = (id) => { window.__pwned[id] = true; };',
      'window.__ready = true;',
    ].join('\n'),
  );
  await build({ entryPoints: [entry], bundle: true, format: 'esm', target: 'es2022', outfile: path.join(buildDir, `${key}.js`), absWorkingDir: repoRoot, logLevel: 'warning' });
  await writeFile(
    path.join(buildDir, `${key}.html`),
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>corpus: ${key}</title></head><body><div id="out"></div><script type="module" src="./${key}.js"></script></body></html>\n`,
  );
  return key;
}

const { base, requests, close } = await startServer();
const browser = await launchBrowser();
const results = [];

const hostMatches = (url, host) => {
  const hostname = new URL(url).hostname;
  return hostname === host || hostname.endsWith(`.${host}`);
};

async function runCase(key, testCase) {
  const { page, external, errors } = await openPage(browser, base, `/corpus/.build/${key}.html`, { readyFlag: '__ready', settle: 50 });
  const failures = [];
  const start = requests.length;
  const fill = (text) => text.replaceAll('{{origin}}', base);
  const countMarked = (marker) => requests.slice(start).filter((r) => r.includes(marker)).length + external.filter((u) => u.includes(marker)).length;
  const hasElement = (selector) => page.evaluate((s) => document.getElementById('out').querySelector(s) !== null, selector);
  let status = 'pass';

  try {
    if (testCase.stream) {
      const supported = await page.evaluate(() => typeof window.__adapter.createStream === 'function');
      if (!supported) {
        status = 'unsupported';
      } else {
        await page.evaluate(() => {
          window.__stream = window.__adapter.createStream(document.getElementById('out'));
        });
        const chunks = testCase.stream.chunks.map(fill);
        for (let i = 0; i < chunks.length; i += 1) {
          await page.evaluate((chunk) => window.__stream.push(chunk), chunks[i]);
          await page.waitForTimeout(250);
          const last = i === chunks.length - 1;
          if (!last && testCase.stream.noRequestsBeforeLast && countMarked(testCase.stream.requestUrlContains) > 0) {
            failures.push(`request issued after chunk ${i + 1} of ${chunks.length}`);
          }
          if (!last) for (const selector of testCase.stream.noElementsBeforeLast ?? []) if (await hasElement(selector)) failures.push(`${selector} present after chunk ${i + 1}`);
          for (const selector of testCase.stream.mustHaveAfterEachChunk ?? []) if (!(await hasElement(selector))) failures.push(`${selector} missing after chunk ${i + 1}`);
        }
        await page.evaluate(() => window.__stream.end?.());
        await page.waitForTimeout(250);
        if (testCase.stream.requestsAtEnd !== undefined) {
          const count = countMarked(testCase.stream.requestUrlContains);
          if (count !== testCase.stream.requestsAtEnd) failures.push(`${count} request(s) at the end, expected ${testCase.stream.requestsAtEnd}`);
        }
      }
    } else {
      await page.evaluate(async (markdown) => {
        await window.__adapter.render(document.getElementById('out'), markdown);
      }, fill(testCase.input));
      await page.waitForTimeout(250);
    }

    if (status !== 'unsupported') {
      const domFailures = await page.evaluate(
        ([expect, id]) => window.__evaluate(document.getElementById('out'), expect, window.__pwned[id] === true),
        [testCase.expect ?? {}, testCase.id],
      );
      failures.push(...domFailures);
      for (const host of testCase.expect?.noRequestTo ?? []) {
        if (external.some((u) => hostMatches(u, host))) failures.push(`request to ${host}`);
      }
      if (errors.length > 0) failures.push(`page error: ${errors[0]}`);
    }
  } catch (error) {
    failures.push(`page navigated away or crashed: ${String(error.message).split('\n')[0]}`);
  } finally {
    await page.close().catch(() => {});
  }
  if (status !== 'unsupported') status = failures.length === 0 ? 'pass' : 'fail';
  return { id: testCase.id, category: testCase.category, status, failures };
}

try {
  for (const adapterPath of adapterPaths) {
    const key = await bundle(adapterPath);
    const name = await (async () => {
      const page = await browser.newPage();
      await page.goto(`${base}/corpus/.build/${key}.html`);
      await page.waitForFunction(() => window.__ready === true);
      const n = await page.evaluate(() => window.__adapter.name);
      await page.close();
      return n;
    })();
    const caseResults = [];
    for (const testCase of cases) caseResults.push(await runCase(key, testCase));
    results.push({ key, name, cases: caseResults });
    const passed = caseResults.filter((r) => r.status === 'pass').length;
    const unsupported = caseResults.filter((r) => r.status === 'unsupported').length;
    console.log(`\n== ${name}: ${passed}/${caseResults.length - unsupported} passed${unsupported ? `, ${unsupported} unsupported` : ''}`);
    for (const r of caseResults) if (r.status === 'fail') console.log(`  FAIL ${r.id}: ${r.failures.join('; ')}`);
  }
} finally {
  await browser.close();
  close();
}

const mark = { pass: '✓', fail: '✗', unsupported: 'n/a' };
const categories = [...new Set(cases.map((c) => c.category))];
const lines = [];
lines.push(`# Evil-Markdown corpus results`, '', `Corpus version ${corpus.version}, ${cases.length} cases, run in Chromium by \`corpus/run.mjs\`.`, '', `A pass means every invariant of the case held: nothing executed, no forbidden element or attribute, no request to the listed hosts, and the guard content survived. "n/a" means the adapter has no streaming API.`, '');
lines.push(`| Category | ${results.map((r) => r.name).join(' | ')} |`);
lines.push(`| --- | ${results.map(() => '---').join(' | ')} |`);
for (const category of categories) {
  const total = cases.filter((c) => c.category === category).length;
  lines.push(`| ${category} | ${results.map((r) => `${r.cases.filter((c) => c.category === category && c.status === 'pass').length} / ${total}`).join(' | ')} |`);
}
lines.push('', `| Case | ${results.map((r) => r.name).join(' | ')} |`, `| --- | ${results.map(() => '---').join(' | ')} |`);
for (const testCase of cases) {
  lines.push(`| \`${testCase.id}\` ${testCase.title} | ${results.map((r) => mark[r.cases.find((c) => c.id === testCase.id).status]).join(' | ')} |`);
}
const markdown = lines.join('\n') + '\n';
console.log('\n' + lines.slice(0, 6 + categories.length + 2).join('\n'));
if (resultsFile) await writeFile(path.resolve(resultsFile), markdown);
if (jsonFile) await writeFile(path.resolve(jsonFile), JSON.stringify({ version: corpus.version, results }, null, 2));

if (requirePass) {
  const target = results.find((r) => r.key === requirePass);
  if (!target) {
    console.error(`--require-pass: no adapter named ${requirePass}`);
    process.exit(2);
  }
  const failed = target.cases.filter((c) => c.status === 'fail');
  if (failed.length > 0) {
    console.error(`\n${target.name} failed ${failed.length} case(s)`);
    process.exit(1);
  }
  console.log(`\n${target.name} passed every case`);
}
