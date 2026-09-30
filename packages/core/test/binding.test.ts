import { describe, expect, it } from 'vitest';
import { createContentBinding, createRenderer, type RenderDecision } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');
const sync = (render: () => void): void => render();

describe('createContentBinding', () => {
  it('renders one-shot content and reports its decisions', () => {
    const renderer = createRenderer();
    const target = box();
    const journals: (readonly RenderDecision[])[] = [];
    const binding = createContentBinding(renderer, target, { onDecisions: (d) => journals.push(d) });
    binding.update('# Hi <img src="/a.png" onerror="x()">');
    expect(target.querySelector('h1')?.textContent?.trim()).toBe('Hi');
    expect(journals.length).toBe(1);
    expect(journals[0]?.some((d) => d.code === 'event-handler')).toBe(true);
    expect(binding.streaming).toBe(false);
  });

  it('streams while streaming is true, ends with a final render when it turns false, reports once', () => {
    const renderer = createRenderer({ policy: { imageHosts: ['cdn.example'] } });
    const target = box();
    const journals: (readonly RenderDecision[])[] = [];
    const binding = createContentBinding(renderer, target, { schedule: sync, onDecisions: (d) => journals.push(d) });
    binding.update('# Chart\n\n![x](https://cdn.example/a', true);
    const heading = target.querySelector('h1');
    expect(heading).not.toBeNull();
    expect(target.querySelector('img')).toBeNull();
    expect(binding.streaming).toBe(true);
    binding.update('# Chart\n\n![x](https://cdn.example/a.png) [bad](javascript:x())', true);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(target.querySelector('h1')).toBe(heading);
    expect(journals.length).toBe(0);
    binding.update('# Chart\n\n![x](https://cdn.example/a.png) [bad](javascript:x()) done', false);
    expect(binding.streaming).toBe(false);
    expect(target.textContent).toContain('done');
    expect(target.querySelector('h1')).toBe(heading);
    expect(journals.length).toBe(1);
    expect(journals[0]?.some((d) => d.code === 'scheme-not-allowed')).toBe(true);
  });

  it('renders HTML when asked, and a fresh stream starts after a one-shot render', () => {
    const renderer = createRenderer();
    const target = box();
    const binding = createContentBinding(renderer, target, { mode: 'html', schedule: sync });
    binding.update('<b>x</b><script>alert(1)</script>');
    expect(target.querySelector('b')?.textContent).toBe('x');
    expect(target.querySelector('script')).toBeNull();
    binding.update('<p>one</p><img src="https://x', true);
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('p')?.textContent).toBe('one');
    binding.dispose();
    expect(binding.streaming).toBe(false);
    binding.update('<i>after</i>');
    expect(target.querySelector('i')?.textContent).toBe('after');
  });
});
