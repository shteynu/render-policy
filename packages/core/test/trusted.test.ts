import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';

describe('Trusted Types', () => {
  it('trustedHTML returns a sanitized string when the API is absent', () => {
    const out = createRenderer().trustedHTML('<img src="/a.png" onerror="x()"><b>ok</b>');
    expect(typeof out).toBe('string');
    expect(out).toBe('<img src="/a.png"><b>ok</b>');
  });

  it('routes through a "dompurify" Trusted Types policy when the API exists', () => {
    const dom = new JSDOM('', { url: 'https://app.example/' });
    const created: string[] = [];
    interface FakeTrusted {
      readonly kind: 'TrustedHTML';
      readonly value: string;
      toString(): string;
    }
    Object.assign(dom.window, {
      trustedTypes: {
        createPolicy(name: string, rules: { createHTML(input: string): string; createScriptURL(input: string): string }) {
          created.push(name);
          return {
            // A real TrustedHTML stringifies to its value; DOMPurify also wraps the *input* before parsing it.
            createHTML: (input: string): FakeTrusted => ({ kind: 'TrustedHTML', value: rules.createHTML(input), toString: () => input }),
            createScriptURL: (input: string): string => rules.createScriptURL(input),
          };
        },
      },
    });
    const renderer = createRenderer({ window: dom.window });
    const out = renderer.trustedHTML('<b>x</b><script>1</script>') as unknown as FakeTrusted;
    expect(created).toEqual(['dompurify']);
    expect(out.kind).toBe('TrustedHTML');
    expect(out.value).toBe('<b>x</b>');
  });

  it('renders with an explicit window and reads the page origin from it', () => {
    const dom = new JSDOM('<div id="out"></div>', { url: 'https://tenant.example/app' });
    const renderer = createRenderer({ window: dom.window, mode: 'strict' });
    const target = dom.window.document.getElementById('out');
    if (!target) throw new Error('missing target');
    renderer.renderMarkdownInto(target, '![a](https://tenant.example/a.png) ![b](https://other.example/b.png)');
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://tenant.example/a.png');
  });
});
