/**
 * Runs the evil-Markdown corpus and the A2UI cases against one or more renderer adapters in a real Chromium.
 *
 *   node corpus/run.mjs                         # the three bundled adapters
 *   node corpus/run.mjs --adapter ./my.mjs      # your renderer (see corpus/README.md)
 *   node corpus/run.mjs --results corpus/RESULTS.md --json out.json
 *   node corpus/run.mjs --require-pass render-policy   # exit 1 if that adapter fails a case
 *   node corpus/run.mjs --set a2ui              # only one case set: markdown or a2ui
 *
 * An adapter is an ES module whose default export is { name, render(container, markdown),
 * createStream?(container), a2ui?: { name?, createSurface(container) } }. It is bundled with
 * esbuild, so it may import npm packages.
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
const set = option('--set');

const SETS = [
  { key: 'markdown', file: 'evil-markdown.json', title: 'Evil-Markdown cases' },
  { key: 'a2ui', file: 'evil-a2ui.json', title: 'A2UI cases' },
];
const sets = [];
for (const s of SETS.filter((s) => !set || s.key === set)) {
  const corpus = JSON.parse(await readFile(path.join(here, s.file), 'utf8'));
  const selected = corpus.cases.filter((c) => !only || c.id === only).map((c) => ({ ...c, set: s.key }));
  if (selected.length > 0) sets.push({ ...s, version: corpus.version, cases: selected });
}
const cases = sets.flatMap((s) => s.cases);

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
      // openUrl targets are recorded, not opened: the invariants look at the URL.
      'window.__opened = [];',
      'window.open = (url) => { window.__opened.push(String(url)); return null; };',
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
    if (testCase.set === 'a2ui') {
      const supported = await page.evaluate(() => typeof window.__adapter.a2ui?.createSurface === 'function');
      if (!supported) {
        status = 'unsupported';
      } else {
        await page.evaluate(() => {
          window.__surface = window.__adapter.a2ui.createSurface(document.getElementById('out'));
        });
        const messages = JSON.parse(fill(JSON.stringify(testCase.messages)));
        for (const message of messages) {
          await page.evaluate(async (m) => {
            await window.__surface.apply(m);
          }, message);
          await page.waitForTimeout(100);
        }
        for (const id of testCase.activate ?? []) {
          await page.evaluate(async (componentId) => {
            await window.__surface.activate?.(componentId);
          }, id);
        }
        await page.waitForTimeout(250);
      }
    } else if (testCase.stream) {
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
        ([expect, id]) => window.__evaluate(document.getElementById('out'), expect, window.__pwned[id] === true, window.__opened),
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
  return { id: testCase.id, set: testCase.set, category: testCase.category, status, failures };
}

try {
  for (const adapterPath of adapterPaths) {
    const key = await bundle(adapterPath);
    const names = await (async () => {
      const page = await browser.newPage();
      await page.goto(`${base}/corpus/.build/${key}.html`);
      await page.waitForFunction(() => window.__ready === true);
      const n = await page.evaluate(() => ({ markdown: window.__adapter.name, a2ui: window.__adapter.a2ui?.name ?? window.__adapter.name }));
      await page.close();
      return n;
    })();
    const caseResults = [];
    for (const testCase of cases) caseResults.push(await runCase(key, testCase));
    results.push({ key, name: names.markdown, names, cases: caseResults });
    for (const s of sets) {
      const setResults = caseResults.filter((r) => r.set === s.key);
      const passed = setResults.filter((r) => r.status === 'pass').length;
      const unsupported = setResults.filter((r) => r.status === 'unsupported').length;
      console.log(`\n== ${s.key}, ${names[s.key]}: ${passed}/${setResults.length - unsupported} passed${unsupported ? `, ${unsupported} unsupported` : ''}`);
      for (const r of setResults) if (r.status === 'fail') console.log(`  FAIL ${r.id}: ${r.failures.join('; ')}`);
    }
  }
} finally {
  await browser.close();
  close();
}

const mark = { pass: '✓', fail: '✗', unsupported: 'n/a' };
const lines = [];
lines.push(
  `# Evil-Markdown corpus results`,
  '',
  `${sets.map((s) => `${s.title}: version ${s.version}, ${s.cases.length} cases`).join('; ')}. Run in Chromium by \`corpus/run.mjs\`.`,
  '',
  `A pass means every invariant of the case held: nothing executed, no forbidden element or attribute, no request to the listed hosts, no forbidden \`openUrl\` target, and the guard content survived. "n/a" means the adapter has no streaming API or no A2UI surface.`,
);
const summary = [];
for (const s of sets) {
  const header = (rows) => [`| ${rows} | ${results.map((r) => r.names[s.key]).join(' | ')} |`, `| --- | ${results.map(() => '---').join(' | ')} |`];
  const block = [`## ${s.title}`, ''];
  if (s.key === 'a2ui') {
    block.push(
      'Each adapter renders a minimal A2UI v0.9 surface (`lib/a2ui-surface.js`: bindings and `formatString` resolved at render time). The naive one uses resolved values as they come and renders `Text` as Markdown through `innerHTML`; the DOMPurify one sanitizes `Text` with the default configuration and uses URLs as they come; render-policy runs every value through `@render-policy/a2ui` with no configuration.',
      '',
    );
  }
  block.push(...header('Category'));
  for (const category of [...new Set(s.cases.map((c) => c.category))]) {
    const total = s.cases.filter((c) => c.category === category).length;
    block.push(`| ${category} | ${results.map((r) => `${r.cases.filter((c) => c.set === s.key && c.category === category && c.status === 'pass').length} / ${total}`).join(' | ')} |`);
  }
  summary.push(...(summary.length > 0 ? [''] : []), ...block);
  block.push('', ...header('Case'));
  for (const testCase of s.cases) {
    block.push(`| \`${testCase.id}\` ${testCase.title} | ${results.map((r) => mark[r.cases.find((c) => c.set === s.key && c.id === testCase.id).status]).join(' | ')} |`);
  }
  lines.push('', ...block);
}
const markdown = lines.join('\n') + '\n';
console.log('\n' + summary.join('\n'));
if (resultsFile) await writeFile(path.resolve(resultsFile), markdown);
if (jsonFile) await writeFile(path.resolve(jsonFile), JSON.stringify({ versions: Object.fromEntries(sets.map((s) => [s.key, s.version])), results }, null, 2));

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
