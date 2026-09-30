/**
 * Browser side of e2e/bench.mjs. Bundled with esbuild; exposes window.__bench.
 */
import { createRenderer, frameScheduler } from '@render-policy/core';
import { marked } from 'marked';

const renderer = createRenderer({ mode: 'balanced' });
const target = document.getElementById('out');

const stats = (samples) => {
  const sorted = [...samples].sort((a, b) => a - b);
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
  return { n: sorted.length, mean: sorted.reduce((a, b) => a + b, 0) / sorted.length, median: at(0.5), p95: at(0.95), max: sorted[sorted.length - 1] };
};

window.__bench = {
  /** One-shot Markdown render (parse + sanitize + policy + insert), `runs` times. */
  markdown(markdown, runs) {
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      renderer.renderMarkdownInto(target, markdown);
      samples.push(performance.now() - t0);
    }
    return { ...stats(samples), nodes: target.querySelectorAll('*').length };
  },
  /** One-shot HTML render of the same document (sanitize + policy + insert only). */
  html(markdown, runs) {
    const html = marked.parse(markdown);
    const samples = [];
    for (let i = 0; i < runs; i += 1) {
      const t0 = performance.now();
      renderer.renderHtmlInto(target, html);
      samples.push(performance.now() - t0);
    }
    return { ...stats(samples), htmlBytes: html.length };
  },
  /** Streaming with a synchronous scheduler: every push renders. Worst case for the patcher. */
  streamSync(markdown, chunkSize, patch) {
    const stream = renderer.createStream(target, { patch });
    const samples = [];
    const t0 = performance.now();
    for (let i = 0; i < markdown.length; i += chunkSize) {
      const t = performance.now();
      stream.push(markdown.slice(i, i + chunkSize));
      samples.push(performance.now() - t);
    }
    const tEnd = performance.now();
    stream.end();
    const endMs = performance.now() - tEnd;
    return { ...stats(samples), totalMs: performance.now() - t0, endMs };
  },
  /**
   * Streaming with the frame scheduler: `perFrame` chunks arrive per animation frame and one
   * render runs per frame. Measures the time spent rendering inside each frame, not the frame
   * interval (headless Chromium paces frames at its own rate).
   */
  async streamFrames(markdown, chunkSize, perFrame) {
    const renders = [];
    const timed = frameScheduler(window);
    const schedule = (render) =>
      timed(() => {
        const t = performance.now();
        render();
        renders.push(performance.now() - t);
      });
    const stream = renderer.createStream(target, { schedule });
    let i = 0;
    let frames = 0;
    const t0 = performance.now();
    while (i < markdown.length) {
      for (let k = 0; k < perFrame && i < markdown.length; k += 1, i += chunkSize) stream.push(markdown.slice(i, i + chunkSize));
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      frames += 1;
    }
    stream.end();
    return { ...stats(renders), totalMs: performance.now() - t0, frames };
  },
  clear() {
    target.replaceChildren();
  },
};
window.__benchReady = true;
