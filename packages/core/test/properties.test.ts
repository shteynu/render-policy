import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkUrl, completeFences, createRenderer, holdIncompleteMarkdown, MODE_PRESETS } from '../src/index.js';
import { patchChildren } from '../src/internal.js';

const closeOpenFences = (text: string): string => completeFences(text).text;

const box = (): HTMLDivElement => document.createElement('div');
const CONTROL = ['\t', '\n', '\r', '\x00', '\x01', '\x0b', '\x0c', '\x1f', ' ', '\x7f', '\xa0', ' ', '​', '﻿'];

describe('properties', () => {
  it('holdIncompleteMarkdown never invents text: its output is a prefix of the input', () => {
    fc.assert(fc.property(fc.string({ maxLength: 200 }), (text) => text.startsWith(holdIncompleteMarkdown(text))));
  });

  it('closeOpenFences only appends, and closing twice equals closing once', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), (text) => {
        const once = closeOpenFences(text);
        return once.startsWith(text) && closeOpenFences(once) === once;
      }),
    );
  });

  it('javascript: with control characters sprinkled anywhere never passes the URL policy', () => {
    const insertions = fc.array(fc.tuple(fc.nat(20), fc.constantFrom(...CONTROL)), { maxLength: 6 });
    fc.assert(
      fc.property(fc.constantFrom('javascript:alert(1)', 'JAVASCRIPT:x', 'data:text/html,x', 'vbscript:x'), insertions, (base, inserts) => {
        let value = base;
        for (const [at, ch] of inserts) {
          const index = Math.min(at, value.length);
          value = value.slice(0, index) + ch + value.slice(index);
        }
        const verdict = checkUrl(value, MODE_PRESETS.balanced.urls);
        // Either blocked, or the control character broke the scheme so the browser would treat it as relative.
        if (verdict.ok) {
          const cleaned = value.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+/, '');
          return !/^(javascript|data|vbscript):/i.test(cleaned);
        }
        return true;
      }),
    );
  });

  it('a streamed image URL is never requested before its closing parenthesis, for any chunking', () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    const filler = fc.array(word, { maxLength: 12 }).map((words) => words.join(' '));
    const renderer = createRenderer({ mode: 'permissive' });
    fc.assert(
      fc.property(filler, filler, fc.array(fc.nat(80), { minLength: 1, maxLength: 6 }), (before, after, cuts) => {
        const markdown = `${before} ![p](https://evil.example/leak.png) ${after}`;
        const closing = markdown.indexOf(')') + 1;
        const points = [...new Set(cuts.map((c) => Math.min(c, markdown.length)))].sort((a, b) => a - b);
        const target = box();
        const stream = renderer.createStream(target);
        let position = 0;
        for (const point of [...points, markdown.length]) {
          if (point <= position) continue;
          stream.push(markdown.slice(position, point));
          position = point;
          const leaked = target.querySelector('img[src*="evil.example"]') !== null;
          if (position < closing && leaked) return false;
        }
        stream.end();
        return target.querySelectorAll('img[src*="evil.example"]').length === 1;
      }),
      { numRuns: 200 },
    );
  });

  it('patchChildren produces exactly what a full replacement would', () => {
    const node = fc.oneof(
      fc.stringMatching(/^[a-z ]{0,10}$/).map((t) => `<p>${t}</p>`),
      fc.stringMatching(/^[a-z]{1,6}$/).map((t) => `<p><em>${t}</em></p>`),
      fc.stringMatching(/^[a-z]{1,6}$/).map((t) => `<ul><li>${t}</li></ul>`),
      fc.constant('\n'),
    );
    const html = fc.array(node, { maxLength: 6 }).map((parts) => parts.join(''));
    const fragmentOf = (markup: string): DocumentFragment => {
      const template = document.createElement('template');
      template.innerHTML = markup; // test helper only
      return template.content;
    };
    fc.assert(
      fc.property(html, html, (previous, next) => {
        const patched = box();
        patched.append(...fragmentOf(previous).childNodes);
        patchChildren(patched, fragmentOf(next));
        const fresh = box();
        fresh.append(...fragmentOf(next).childNodes);
        return patched.innerHTML === fresh.innerHTML;
      }),
    );
  });
});
