import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createRenderer, type Renderer } from '../src/index.js';
import { scanSettled } from '../src/internal.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('scanSettled', () => {
  it('cuts after a blank line, before a plain block', () => {
    const source = 'para one\n\npara two\n\npara three';
    expect(scanSettled(source).boundary).toBe(source.indexOf('para three'));
    expect(scanSettled(source, 100).boundary).toBe(100);
  });

  it('never cuts inside a fence, an html block that spans blank lines, or before indented or list lines', () => {
    expect(scanSettled('a\n\n```\ncode\n\nmore\n```\n').boundary).toBe(3);
    expect(scanSettled('a\n\n```\ncode\n\nmore\n```\n\nb').boundary).toBe('a\n\n```\ncode\n\nmore\n```\n\n'.length);
    expect(scanSettled('a\n\n<!-- open\n\nstill comment\n\n-->\n\nb').boundary).toBe('a\n\n<!-- open\n\nstill comment\n\n-->\n\n'.length);
    expect(scanSettled('a\n\n<script>\n\nx\n</script>\ntail').boundary).toBe(3);
    expect(scanSettled('- item\n\n  continued\n\n- next\n\npara').boundary).toBe('- item\n\n  continued\n\n- next\n\n'.length);
    expect(scanSettled('    code\n\n    code too\n\npara').boundary).toBe('    code\n\n    code too\n\n'.length);
    expect(scanSettled('a\n\n\tcode').boundary).toBe(0);
    expect(scanSettled('- a\n\n  continued with two spaces').boundary).toBe(0);
    expect(scanSettled('<details>\n<summary>s</summary>\n\ntext\n\n</details>\n\nafter').boundary).toBe('<details>\n<summary>s</summary>\n\ntext\n\n</details>\n\n'.length);
    expect(scanSettled('see <https://ok.example/x> and <b>bold</b>\n\nnext').boundary).toBe('see <https://ok.example/x> and <b>bold</b>\n\n'.length);
    expect(scanSettled('a <b>unclosed\n\nnext\n\nlater').boundary).toBe(0);
    // Inside a <div> block a ``` line is raw HTML, not a fence: the real fence opens after the blank line.
    expect(scanSettled('<div>\n```\n</div>\n\n```\ncode\n\nnext').boundary).toBe('<div>\n```\n</div>\n\n'.length);
    // An unclosed div keeps everything after it nested: no cut until it closes.
    expect(scanSettled('<div>\n```\n\n```\ncode\n\nnext').boundary).toBe(0);
    // A comment opened inside an html block and left open swallows the rest of the document: no cut after it.
    expect(scanSettled('a\n\n<div>\nx\n</div>\n<!-- open\n\nstill\n-->\n\nafter').boundary).toBe(3);
    // Closed inside the block, it is harmless.
    expect(scanSettled('<div>\n<!-- open --> x\n</div>\n\nafter').boundary).toBe('<div>\n<!-- open --> x\n</div>\n\n'.length);
    // In paragraph text an unclosed comment is escaped, not a comment.
    expect(scanSettled('text <!-- c\n\nnext').boundary).toBe('text <!-- c\n\n'.length);
  });

  it('collects reference definitions, stripping container markers, but not inside fences', () => {
    const { definitions } = scanSettled('[a]: https://a.example\n\n> [b]: https://b.example "t"\n\n- [c]: https://c.example\n\n```\n[d]: https://d.example\n```\n\n[e]:https://e.example\n"title"\n\npara\n[f]: https://not-a-definition.example\n\n# h\n[g]: https://g.example');
    expect(definitions).toEqual(['[a]: https://a.example', '[b]: https://b.example "t"', '[c]: https://c.example', '[e]:https://e.example\n"title"', '[g]: https://g.example']);
  });
});

// A grammar of Markdown that looks like agent output, with the constructs that make block
// boundaries tricky: loose lists, fences containing blank lines and markers, html blocks that
// span blank lines, indented code, setext headings, tables, definitions anywhere.
const word = fc.constantFrom('alpha', 'beta', 'gamma', 'delta', 'link', 'code', 'x', 'y', 'the', 'a');
const inline = fc.oneof(
  { weight: 6, arbitrary: word },
  fc.constant('**bold**'),
  fc.constant('*em*'),
  fc.constant('`code`'),
  fc.constant('[t](https://ok.example/p?q=1)'),
  fc.constant('[ref text][r1]'),
  fc.constant('[r2]'),
  fc.constant('![img](https://img.example/a.png)'),
  fc.constant('<b>raw</b>'),
  fc.constant('<https://ok.example/auto>'),
  fc.constant('https://ok.example/bare'),
  fc.constant('line  '),
  fc.constant('\\'),
);
const sentence = fc.array(inline, { minLength: 1, maxLength: 6 }).map((w) => w.join(' '));
const paragraph = fc.array(sentence, { minLength: 1, maxLength: 3 }).map((s) => s.join('\n'));
const heading = fc.tuple(fc.integer({ min: 1, max: 3 }), sentence).map(([n, s]) => `${'#'.repeat(n)} ${s}`);
const setext = fc.tuple(sentence, fc.constantFrom('===', '---')).map(([s, u]) => `${s}\n${u}`);
const listItem = fc.tuple(fc.constantFrom('- ', '* ', '1. ', '2) '), sentence, fc.option(sentence, { nil: null }), fc.option(sentence, { nil: null })).map(
  ([marker, first, nested, para]) => {
    let item = `${marker}${first}`;
    if (nested) item += `\n  - ${nested}`;
    if (para) item += `\n\n  ${para}`;
    return item;
  },
);
const list = fc.tuple(fc.array(listItem, { minLength: 1, maxLength: 3 }), fc.constantFrom('\n', '\n\n')).map(([items, sep]) => items.join(sep));
const fenced = fc.tuple(fc.constantFrom('```', '~~~', '````'), fc.constantFrom('', 'js', 'mermaid'), fc.array(fc.constantFrom('code', '', '- not a list', '# not a heading', '```', '[z]: https://not.example', '    indented'), { minLength: 0, maxLength: 5 })).map(
  ([fence, info, lines]) => `${fence}${info}\n${lines.join('\n')}\n${fence}`,
);
const indented = fc.array(fc.constantFrom('    code', '    more', ''), { minLength: 1, maxLength: 3 }).map((l) => (l[0] === '' ? '    x' : l[0]) + (l.length > 1 ? `\n${l.slice(1).join('\n')}` : ''));
const quote = fc.array(fc.oneof(sentence, fc.constant('')), { minLength: 1, maxLength: 3 }).map((lines) => lines.map((l) => (l === '' ? '>' : `> ${l}`)).join('\n'));
const table = fc.constant('| a | b |\n| --- | --- |\n| 1 | [t](https://ok.example/) |\n| 2 | `c` |');
const htmlBlock = fc.constantFrom('<div class="x">\n  inside\n</div>', '<!-- comment\n\nstill\n-->', '<details>\n<summary>s</summary>\n\ntext\n\n</details>');
const definition = fc.tuple(fc.constantFrom('r1', 'r2', 'r3'), fc.constantFrom('https://ref.example/a', 'https://ref.example/b'), fc.option(fc.constant(' "title"'), { nil: '' })).map(([id, url, t]) => `[${id}]: ${url}${t}`);
const hr = fc.constant('---');
const block = fc.oneof(
  { weight: 6, arbitrary: paragraph },
  { weight: 2, arbitrary: heading },
  { weight: 1, arbitrary: setext },
  { weight: 3, arbitrary: list },
  { weight: 3, arbitrary: fenced },
  { weight: 1, arbitrary: indented },
  { weight: 1, arbitrary: quote },
  { weight: 1, arbitrary: table },
  { weight: 2, arbitrary: htmlBlock },
  { weight: 2, arbitrary: definition },
  { weight: 1, arbitrary: hr },
);
const documentArb = fc
  .tuple(fc.array(block, { minLength: 1, maxLength: 9 }), fc.array(fc.constantFrom('\n\n', '\n\n\n', '\n'), { minLength: 9, maxLength: 9 }))
  .map(([blocks, seps]) => blocks.map((b, i) => (i === 0 ? b : `${seps[i] ?? '\n\n'}${b}`)).join(''));
const cutsArb = (length: number) => fc.array(fc.integer({ min: 1, max: Math.max(1, length) }), { minLength: 1, maxLength: 12 }).map((cuts) => [...new Set(cuts)].sort((a, b) => a - b));

const streamBoth = (renderer: Renderer, source: string, cuts: number[]): { readonly steps: string[][]; readonly final: string[] } => {
  const targets = [box(), box()];
  const streams = [renderer.createStream(targets[0]!, { incremental: false }), renderer.createStream(targets[1]!)];
  const steps: string[][] = [];
  let at = 0;
  for (const cut of [...cuts, source.length]) {
    if (cut <= at) continue;
    const chunk = source.slice(at, cut);
    at = cut;
    for (const stream of streams) stream.push(chunk);
    steps.push(targets.map((t) => t.innerHTML));
  }
  for (const stream of streams) stream.end();
  return { steps, final: targets.map((t) => t.innerHTML) };
};

describe('incremental streaming', () => {
  const renderer = createRenderer({ policy: { imageHosts: ['img.example'] } });

  it('renders exactly what the whole-buffer stream renders, after every push and at the end', { timeout: 120_000 }, () => {
    fc.assert(
      fc.property(
        documentArb.chain((source) => fc.tuple(fc.constant(source), cutsArb(source.length))),
        ([source, cuts]) => {
          const { steps, final } = streamBoth(renderer, source, cuts);
          for (const [reference, incremental] of steps) expect(incremental).toBe(reference);
          expect(final[1]).toBe(final[0]);
        },
      ),
      { numRuns: Number(process.env.RP_PROPERTY_RUNS ?? 300) },
    );
  });

  it('keeps settled nodes and never parses them again', () => {
    const fragments: string[] = [];
    const counting = createRenderer({ transforms: [(fragment) => fragments.push(fragment.textContent ?? '')] });
    const target = box();
    const stream = counting.createStream(target);
    stream.push('# Title\n\nFirst paragraph.\n\n');
    const title = target.querySelector('h1');
    const first = target.querySelector('p');
    stream.push('Second paragraph, still ');
    stream.push('growing.\n\n- a\n- b\n\nAfter the list');
    const final = stream.end();
    expect(target.querySelector('h1')).toBe(title);
    expect(target.querySelector('p')).toBe(first);
    expect(target.textContent).toContain('After the list');
    // The title settles on the first push (a block follows it), the first paragraph on the second
    // (its following block arrives then); after that, no fragment contains them again.
    expect(fragments[0]).toContain('Title');
    expect(fragments.slice(1).some((text) => text.includes('Title'))).toBe(false);
    expect(fragments[2]).toContain('First paragraph');
    expect(fragments.slice(3).some((text) => text.includes('First paragraph'))).toBe(false);
    expect(final.decisions).toEqual([]);
  });

  it('re-renders everything once a reference definition appears, then settles again', () => {
    const target = box();
    const stream = renderer.createStream(target);
    stream.push('See [the docs][d].\n\nMore text.\n\n');
    expect(target.querySelector('a')).toBeNull();
    stream.push('[d]: https://ok.example/docs\n\nEnd.');
    stream.end();
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://ok.example/docs');
    const reference = box();
    renderer.renderMarkdownInto(reference, 'See [the docs][d].\n\nMore text.\n\n[d]: https://ok.example/docs\n\nEnd.');
    expect(target.innerHTML).toBe(reference.innerHTML);
  });

  it('set() with unrelated text starts over; reset() clears the settled state', () => {
    const target = box();
    const stream = renderer.createStream(target);
    stream.set('# One\n\ntwo\n\n');
    stream.set('# Other\n\nthree');
    expect(target.querySelector('h1')?.textContent).toBe('Other');
    expect(target.querySelectorAll('h1').length).toBe(1);
    stream.reset();
    expect(target.childNodes.length).toBe(0);
    stream.push('again');
    expect(target.textContent?.trim()).toBe('again');
  });
});
