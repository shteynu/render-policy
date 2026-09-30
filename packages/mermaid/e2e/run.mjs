/**
 * Browser proof for @render-policy/mermaid with the real mermaid in Chromium:
 * diagrams render inside a shadow root, hostile diagram sources cannot execute,
 * link, restyle the page or escape the wrapper, invalid diagrams fall back to
 * code, and streaming renders a diagram only once its fence is closed.
 *
 * Usage: node packages/mermaid/e2e/run.mjs
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
  splitting: true,
  format: 'esm',
  target: 'es2022',
  outdir: path.join(here, 'dist'),
  entryNames: 'app',
  alias: {
    '@render-policy/core': path.join(repoRoot, 'packages/core/src/index.ts'),
    '@render-policy/mermaid': path.join(repoRoot, 'packages/mermaid/src/index.ts'),
  },
  absWorkingDir: repoRoot,
  logLevel: 'warning',
});

const { base, close } = await startServer();
const browser = await launchBrowser();
const { check, finish } = createChecker('@render-policy/mermaid in Chromium');

const fence = (source) => `\`\`\`mermaid\n${source}\n\`\`\``;

async function renderDiagram(page, markdown) {
  await page.evaluate((md) => {
    window.__renderer.renderMarkdownInto(document.getElementById('out'), md);
  }, markdown);
  await page.waitForTimeout(50);
  await page
    .waitForFunction(() => {
      const shadow = document.querySelector('.rp-diagram-host')?.shadowRoot;
      return shadow ? shadow.querySelector('svg') !== null || (shadow.querySelector('pre') !== null && window.__decisions.some((d) => d.reason.includes('could not render'))) : false;
    }, undefined, { timeout: 15000 })
    .catch(() => {});
  return page.evaluate(() => {
    const host = document.querySelector('.rp-diagram-host');
    const shadow = host?.shadowRoot ?? null;
    return {
      hasHost: host !== null,
      svg: shadow?.querySelector('svg') !== null,
      fallback: shadow?.querySelector('pre') !== null,
      text: shadow?.textContent ?? '',
      forbidden: shadow ? shadow.querySelectorAll('a, script, foreignObject, image, use, [onload], [onclick]').length : -1,
      cornerInsideDiagram: (() => {
        const hit = document.elementFromPoint(window.innerWidth - 2, window.innerHeight - 2);
        return hit !== null && hit.closest('.rp-diagram') !== null;
      })(),
      hostPosition: host ? getComputedStyle(host).position : '',
      bodyDisplay: getComputedStyle(document.body).display,
      bodySvgChildren: Array.from(document.body.children).filter((e) => e.tagName.toLowerCase() === 'svg').length,
      headStyles: document.head.querySelectorAll('style').length,
      styleSheets: document.styleSheets.length,
      imgs: document.querySelectorAll('img').length,
      decisions: window.__decisions.map((d) => `${d.reason}${d.attribute ? ` [${d.attribute}]` : ''}${d.tag ? ` <${d.tag}>` : ''}`),
      pwned: window.__pwned,
    };
  });
}

try {
  const { page, errors, external } = await openPage(browser, base, '/packages/mermaid/e2e/index.html', { readyFlag: '__ready', settle: 100 });
  const baseline = await page.evaluate(() => ({ styleSheets: document.styleSheets.length, headStyles: document.head.querySelectorAll('style').length }));

  {
    const r = await renderDiagram(page, `Plan:\n\n${fence('graph TD\n  A[Start] --> B{Ok?}\n  B -->|yes| C[Done]')}\n\nafter`);
    check(r.svg, 'flowchart: rendered as SVG inside a shadow root');
    check(!r.decisions.some((d) => d.includes('stylesheet')), 'flowchart: mermaid\'s own stylesheet is kept (diagram stays styled)', [...new Set(r.decisions)].join('; '));
    check(r.text.includes('Start') && r.text.includes('Done'), 'flowchart: labels present as SVG text');
    check(r.forbidden === 0, 'flowchart: no links, scripts, foreignObject, images, uses or handlers in the diagram', `${r.forbidden}`);
    check(r.styleSheets === baseline.styleSheets && r.headStyles === baseline.headStyles, 'flowchart: the diagram stylesheet stays inside the shadow root', `${r.styleSheets} vs ${baseline.styleSheets}`);
    check(await page.locator('#out').evaluate((el) => el.textContent.includes('after') && el.textContent.includes('Plan:')), 'flowchart: surrounding Markdown intact');
  }
  {
    const r = await renderDiagram(page, fence("graph TD\n  A --> B\n  click A href \"javascript:p('click')\"\n  click B call p('call')"));
    check(r.svg, 'click: diagram still renders');
    check(r.forbidden === 0 && r.pwned.click === undefined && r.pwned.call === undefined, 'click: no link, no callback, nothing executed', JSON.stringify(r.pwned));
  }
  {
    const r = await renderDiagram(page, fence("graph TD\n  A[\"<img src=x onerror=p('label')>\"] --> B"));
    check(r.imgs === 0 && r.pwned.label === undefined, 'label injection: no <img>, nothing executed', JSON.stringify(r.pwned));
  }
  {
    const r = await renderDiagram(page, `%%{init: {"themeCSS": "body { display: none } #out { position: fixed }"}}%%\n${fence('graph TD\n  A --> B')}`);
    check(r.bodyDisplay !== 'none', 'themeCSS directive: the host page is not restyled', r.bodyDisplay);
    check(r.headStyles === baseline.headStyles, 'themeCSS directive: nothing injected into <head>');
  }
  {
    const r = await renderDiagram(page, `# Heading\n\n${fence('graph TD\n  A --> B\n  classDef danger fill:#f00,position:fixed,inset:0\n  class A danger')}`);
    check(!r.cornerInsideDiagram && r.hostPosition === 'static', 'classDef with position:fixed: the diagram does not overlay the page', `${r.hostPosition} corner=${r.cornerInsideDiagram}`);
  }
  {
    const r = await renderDiagram(page, fence('sequenceDiagram\n  Alice->>Bob: Hi\n  Bob-->>Alice: Hello'));
    check(r.svg && r.text.includes('Alice'), 'sequence diagram: rendered');
  }
  {
    const r = await renderDiagram(page, fence('graph TD\n  A --->>>> ]]'));
    check(r.hasHost && r.fallback && !r.svg, 'invalid diagram: stays a code block inside the wrapper');
    check(r.bodySvgChildren === 0, 'invalid diagram: no error diagram injected into <body>');
    check(r.decisions.some((d) => d.includes('could not render')), 'invalid diagram: failure journaled');
  }
  {
    await page.evaluate(() => {
      document.getElementById('out').replaceChildren();
      window.__stream = window.__renderer.createStream(document.getElementById('out'));
      window.__stream.push('Intro\n\n```mermaid\ngraph TD\n  A --> B');
    });
    await page.waitForTimeout(200);
    check((await page.locator('#out .rp-diagram').count()) === 0 && (await page.locator('#out pre > code.language-mermaid').count()) === 1, 'streaming: open fence stays a code block');
    await page.evaluate(() => window.__stream.push('\n```\n\nOutro'));
    await page.waitForFunction(() => document.querySelector('#out .rp-diagram-host')?.shadowRoot?.querySelector('svg') !== null, undefined, { timeout: 15000 });
    const kept = await page.evaluate(() => {
      window.__host = document.querySelector('#out .rp-diagram-host');
      window.__stream.push(' continues');
      window.__stream.end();
      return window.__host === document.querySelector('#out .rp-diagram-host') && window.__host.shadowRoot.querySelector('svg') !== null;
    });
    check(kept, 'streaming: finished diagram kept in place across later pushes and the final render');
  }
  check(errors.length === 0, 'no page errors', errors.join(' | '));
  check(external.length === 0, 'no off-origin request', external.join(' '));
  await page.close();
} finally {
  await browser.close();
  close();
}

process.exit(finish() === 0 ? 0 : 1);
