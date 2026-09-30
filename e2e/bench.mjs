/**
 * Rendering throughput in a real Chromium: one-shot Markdown and HTML renders of generated
 * documents, and streaming with the synchronous and the frame scheduler. Prints a Markdown
 * table and writes e2e/output/bench.json. Numbers depend on the machine; the README quotes
 * one run and says where it ran.
 *   npm run build -w packages/core && node e2e/bench.mjs
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import { launchBrowser, openPage, repoRoot, startServer } from './lib/harness.mjs';

const buildDir = path.join(repoRoot, 'e2e', '.build');
await mkdir(buildDir, { recursive: true });
await build({ entryPoints: [path.join(repoRoot, 'e2e/bench-app.mjs')], bundle: true, format: 'esm', target: 'es2022', outfile: path.join(buildDir, 'bench.js'), absWorkingDir: repoRoot, logLevel: 'warning' });
await writeFile(path.join(buildDir, 'bench.html'), '<!doctype html><meta charset="utf-8"><title>bench</title><div id="out"></div><script type="module" src="/e2e/.build/bench.js"></script>');

/** Deterministic Markdown that looks like an assistant reply: prose with links and code, lists, fences, tables, images. */
function generateMarkdown(targetBytes, seed = 7) {
  let state = seed >>> 0;
  const rand = () => ((state = (state * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const words = 'the policy renders agent output into a fragment and inserts it with replaceChildren while every url is checked against the mode and the host allowlist before the browser sees it streaming keeps settled blocks and patches only the tail'.split(' ');
  const word = () => words[Math.floor(rand() * words.length)];
  const sentence = (n) => Array.from({ length: n }, word).join(' ');
  const parts = [];
  let block = 0;
  let size = 0;
  while (size < targetBytes) {
    let text;
    const kind = block % 12;
    if (kind === 0) text = `## ${sentence(4)}\n\n`;
    else if (kind === 5) text = `- ${sentence(6)}\n- ${sentence(5)} with \`${word()}\`\n- [${sentence(2)}](https://example.com/${word()}/${block})\n\n`;
    else if (kind === 7) text = `\`\`\`ts\nconst ${word()} = render(${JSON.stringify(sentence(3))});\nif (${word()}.ok) {\n  target.replaceChildren(fragment);\n}\n\`\`\`\n\n`;
    else if (kind === 9) text = `| ${word()} | ${word()} | ${word()} |\n| --- | --- | --- |\n| ${sentence(2)} | \`${word()}\` | [${word()}](https://example.com/${block}) |\n| ${sentence(2)} | ${word()} | ${sentence(2)} |\n\n`;
    else if (kind === 11) text = `![${sentence(2)}](https://images.example.com/${block}.png)\n\n`;
    else text = `${sentence(12)} **${sentence(2)}** ${sentence(8)} [${sentence(2)}](https://example.com/${word()}?id=${block}) ${sentence(6)} \`${word()}()\` ${sentence(10)}.\n\n`;
    parts.push(text);
    size += text.length;
    block += 1;
  }
  return parts.join('');
}

const ms = (v) => `${v.toFixed(2)} ms`;
const kb = (n) => `${(n / 1024).toFixed(0)} kB`;
const { base, close } = await startServer();
const browser = await launchBrowser();
const results = { generatedAt: new Date().toISOString(), userAgent: null, oneShot: [], streaming: [] };
const lines = [];
try {
  const { page } = await openPage(browser, base, '/e2e/.build/bench.html', { readyFlag: '__benchReady', settle: 50 });
  results.userAgent = await page.evaluate(() => navigator.userAgent);
  const docs = [8, 64, 256].map((k) => ({ label: `${k} kB`, bytes: k * 1024, markdown: generateMarkdown(k * 1024) }));

  lines.push('| Document | Markdown render (median / p95) | throughput | HTML-only render (median) | DOM nodes |', '| --- | --- | --- | --- | --- |');
  for (const doc of docs) {
    const runs = doc.bytes >= 256 * 1024 ? 5 : 20;
    await page.evaluate((md) => window.__bench.markdown(md, 2), doc.markdown); // warm up
    const md = await page.evaluate(({ md, runs }) => window.__bench.markdown(md, runs), { md: doc.markdown, runs });
    const html = await page.evaluate(({ md, runs }) => window.__bench.html(md, runs), { md: doc.markdown, runs });
    await page.evaluate(() => window.__bench.clear());
    results.oneShot.push({ document: doc.label, bytes: doc.markdown.length, markdown: md, html });
    lines.push(`| ${doc.label} | ${ms(md.median)} / ${ms(md.p95)} | ${kb((doc.markdown.length / md.median) * 1000)}/s | ${ms(html.median)} | ${md.nodes} |`);
  }

  lines.push('', '| Streaming | chunks | per push (median / p95 / max) | total | final render |', '| --- | --- | --- | --- | --- |');
  for (const doc of docs.slice(0, 2)) {
    for (const patch of [true, false]) {
      await page.evaluate(() => window.__bench.clear());
      const r = await page.evaluate(({ md, patch }) => window.__bench.streamSync(md, 32, patch), { md: doc.markdown, patch });
      results.streaming.push({ document: doc.label, scheduler: 'sync', chunkSize: 32, patch, ...r });
      lines.push(`| ${doc.label}, 32-byte chunks, render on every push, ${patch ? 'tail patch' : 'no patch'} | ${r.n} | ${ms(r.median)} / ${ms(r.p95)} / ${ms(r.max)} | ${ms(r.totalMs)} | ${ms(r.endMs)} |`);
    }
  }
  {
    const doc = docs[1];
    await page.evaluate(() => window.__bench.clear());
    const r = await page.evaluate((md) => window.__bench.streamFrames(md, 32, 4), doc.markdown);
    results.streaming.push({ document: doc.label, scheduler: 'frame', chunkSize: 32, perFrame: 4, ...r });
    lines.push(`| ${doc.label}, 32-byte chunks, 4 per animation frame, frame scheduler | ${r.frames} frames | render per frame ${ms(r.median)} / ${ms(r.p95)} / ${ms(r.max)} | ${ms(r.totalMs)} | |`);
  }
  await page.close();
} finally {
  await browser.close();
  close();
}
await mkdir(path.join(repoRoot, 'e2e', 'output'), { recursive: true });
await writeFile(path.join(repoRoot, 'e2e', 'output', 'bench.json'), JSON.stringify(results, null, 2));
console.log(lines.join('\n'));
console.log(`\n${results.userAgent}`);
