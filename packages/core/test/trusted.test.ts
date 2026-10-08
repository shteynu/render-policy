import { JSDOM } from 'jsdom';
import { describe, expect, it, vi } from 'vitest';
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

  it('shares one "dompurify" policy between the renderers on a window, as a CSP that names it requires', () => {
    const dom = new JSDOM('<div id="a"></div><div id="b"></div>', { url: 'https://app.example/' });
    const created: string[] = [];
    Object.assign(dom.window, {
      trustedTypes: {
        // Chromium under `trusted-types dompurify`: a second policy of the same name is refused.
        createPolicy(name: string, rules: { createHTML(input: string): string; createScriptURL(input: string): string }) {
          if (created.includes(name)) throw new TypeError(`Policy with name "${name}" already exists.`);
          created.push(name);
          return { createHTML: (input: string) => rules.createHTML(input), createScriptURL: (input: string) => rules.createScriptURL(input) };
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const balanced = createRenderer({ window: dom.window });
      const strict = createRenderer({ window: dom.window, mode: 'strict' });
      const [a, b] = ['a', 'b'].map((id) => dom.window.document.getElementById(id));
      if (!a || !b) throw new Error('missing targets');
      balanced.renderMarkdownInto(a, '**one**');
      strict.renderMarkdownInto(b, '**two**');
      expect(created).toEqual(['dompurify']);
      expect([a.querySelector('strong')?.textContent, b.querySelector('strong')?.textContent]).toEqual(['one', 'two']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('warns once and renders without a policy when the name is refused', () => {
    const dom = new JSDOM('<div id="out"></div>', { url: 'https://app.example/' });
    Object.assign(dom.window, {
      trustedTypes: {
        createPolicy(name: string) {
          throw new TypeError(`Refused to create a TrustedTypePolicy named '${name}'`);
        },
      },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      createRenderer({ window: dom.window });
      const renderer = createRenderer({ window: dom.window });
      expect(renderer.trustedHTML('<b>x</b>')).toBe('<b>x</b>');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
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
