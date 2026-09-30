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
    expect({ ...seen[0], document: undefined }).toEqual({ streaming: false, final: true, openFenceAtEnd: false, partial: false, document: undefined });
    renderer.sanitizeHtml('<b>x</b>');
    renderer.markdownToFragment('x');
    expect(seen.length).toBe(3);
  });

  it('tell a stream transform whether the source ends inside an open fence (whole-buffer stream)', () => {
    const seen: Array<Pick<TransformContext, 'streaming' | 'final' | 'openFenceAtEnd' | 'partial'>> = [];
    const renderer = createRenderer({
      transforms: [(_, { streaming, final, openFenceAtEnd, partial }) => seen.push({ streaming, final, openFenceAtEnd, partial })],
    });
    const stream = renderer.createStream(box(), { incremental: false });
    stream.push('text\n\n```mermaid\ngraph TD');
    stream.push('\nA-->B\n```\nafter');
    stream.end();
    expect(seen).toEqual([
      { streaming: true, final: false, openFenceAtEnd: true, partial: false },
      { streaming: true, final: false, openFenceAtEnd: false, partial: false },
      { streaming: true, final: true, openFenceAtEnd: false, partial: false },
    ]);
  });

  it('see the settled segment and the tail as separate partial fragments (incremental stream)', () => {
    const seen: Array<Pick<TransformContext, 'final' | 'openFenceAtEnd' | 'partial'> & { text: string }> = [];
    const renderer = createRenderer({
      transforms: [(fragment, { final, openFenceAtEnd, partial }) => seen.push({ final, openFenceAtEnd, partial, text: (fragment.textContent ?? '').replace(/\s+/g, ' ').trim() })],
    });
    const stream = renderer.createStream(box());
    stream.push('text\n\n```mermaid\ngraph TD');
    stream.push('\nA-->B\n```\nafter');
    stream.end();
    expect(seen).toEqual([
      { final: false, openFenceAtEnd: false, partial: true, text: 'text' }, // settled on the first push
      { final: false, openFenceAtEnd: true, partial: true, text: 'graph TD' },
      { final: false, openFenceAtEnd: false, partial: true, text: 'graph TD A-->B after' },
      { final: true, openFenceAtEnd: false, partial: true, text: 'graph TD A-->B after' },
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

describe('a transform that throws', () => {
  const box = (): HTMLDivElement => document.createElement('div');

  it('is skipped and journaled; the others run and the fragment is still inserted', () => {
    const seen: string[] = [];
    const renderer = createRenderer({
      onDecision: (d) => seen.push(d.code),
      transforms: [
        () => {
          throw new Error('highlighter exploded');
        },
        (fragment) => fragment.querySelector('em')?.replaceWith(fragment.ownerDocument.createElement('mark')),
      ],
    });
    const target = box();
    const { decisions } = renderer.renderMarkdownInto(target, '*x* and **y**');
    expect(target.querySelector('mark')).not.toBeNull();
    expect(target.querySelector('strong')?.textContent).toBe('y');
    const failure = decisions.find((d) => d.code === 'transform-failed');
    expect(failure).toMatchObject({ kind: 'flagged', subject: 'transform' });
    expect(failure?.reason).toContain('highlighter exploded');
    expect(seen).toContain('transform-failed');
  });

  it('does not break a stream: later pushes keep rendering', () => {
    let calls = 0;
    const renderer = createRenderer({
      transforms: [
        () => {
          calls += 1;
          if (calls === 1) throw new Error('once');
        },
      ],
    });
    const target = box();
    const stream = renderer.createStream(target);
    stream.push('# one');
    stream.push('\n\ntwo');
    const final = stream.end();
    expect(target.querySelector('h1')?.textContent).toBe('one');
    expect(target.textContent).toContain('two');
    expect(final.decisions.some((d) => d.code === 'transform-failed')).toBe(false);
    expect(calls).toBe(4); // push 1: tail; push 2: the settled heading and the tail; end: the tail
  });
});
