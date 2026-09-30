import { describe, expect, it } from 'vitest';
import { createRenderer, type TransformContext } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('fragment transforms', () => {
  it('run on every sanitized fragment with a one-shot context', () => {
    const seen: TransformContext[] = [];
    const renderer = createRenderer({
      transforms: [
        (fragment, context) => {
          seen.push(context);
          for (const code of fragment.querySelectorAll('pre > code')) {
            const badge = fragment.ownerDocument.createElement('span');
            badge.className = 'rp-badge';
            badge.textContent = code.className;
            code.parentElement?.before(badge);
          }
        },
      ],
    });
    const target = box();
    renderer.renderMarkdownInto(target, '```ts\nconst a = 1;\n```');
    expect(target.querySelector('.rp-badge')?.textContent).toBe('language-ts');
    expect(seen.length).toBe(1);
    expect(seen[0]?.document).toBe(document);
    expect({ ...seen[0], document: undefined }).toEqual({ streaming: false, final: true, openFenceAtEnd: false, document: undefined });
    renderer.sanitizeHtml('<b>x</b>');
    renderer.markdownToFragment('x');
    expect(seen.length).toBe(3);
  });

  it('tell a stream transform whether the source ends inside an open fence', () => {
    const seen: Array<Pick<TransformContext, 'streaming' | 'final' | 'openFenceAtEnd'>> = [];
    const renderer = createRenderer({
      transforms: [(_, { streaming, final, openFenceAtEnd }) => seen.push({ streaming, final, openFenceAtEnd })],
    });
    const stream = renderer.createStream(box());
    stream.push('text\n\n```mermaid\ngraph TD');
    stream.push('\nA-->B\n```\nafter');
    stream.end();
    expect(seen).toEqual([
      { streaming: true, final: false, openFenceAtEnd: true },
      { streaming: true, final: false, openFenceAtEnd: false },
      { streaming: true, final: true, openFenceAtEnd: false },
    ]);
  });

  it('run in order and see each other\'s output', () => {
    const renderer = createRenderer({
      transforms: [
        (fragment) => fragment.querySelector('em')?.replaceWith(fragment.ownerDocument.createElement('mark')),
        (fragment) => {
          const mark = fragment.querySelector('mark');
          if (mark) mark.textContent = 'second';
        },
      ],
    });
    const target = box();
    renderer.renderMarkdownInto(target, '*x*');
    expect(target.querySelector('mark')?.textContent).toBe('second');
    expect(target.querySelector('em')).toBeNull();
  });
});
