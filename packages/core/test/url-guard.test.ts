import { describe, expect, it } from 'vitest';
import { createRenderer, createUrlGuard } from '../src/index.js';
import type { RenderDecision, RenderMode, RenderPolicyOverrides, UrlGuardResult } from '../src/index.js';

const IMAGE = { subject: 'image', tag: 'img', attribute: 'src' } as const;
const LINK = { subject: 'link', tag: 'a', attribute: 'href' } as const;

const blocked = (result: UrlGuardResult): RenderDecision => {
  if (result.allowed) throw new Error(`expected a refusal, got ${result.value}`);
  return result.decision;
};

describe('createUrlGuard', () => {
  it('applies the image policy to image URLs: allowlist, query stripped', () => {
    const guard = createUrlGuard({ policy: { images: { hosts: ['cdn.example'] } } });
    expect(guard('https://cdn.example/a.png?token=1', IMAGE)).toMatchObject({
      allowed: true,
      value: 'https://cdn.example/a.png',
      decisions: [{ kind: 'rewritten', code: 'image-query-stripped', tag: 'img', attribute: 'src', value: 'https://cdn.example/a.png?token=1' }],
    });
    expect(blocked(guard('https://evil.example/a.png', IMAGE))).toMatchObject({ kind: 'blocked', subject: 'image', code: 'image-host-not-allowed' });
  });

  it('does not apply the image policy to links', () => {
    const guard = createUrlGuard();
    expect(guard('https://evil.example/a?q=1', LINK)).toEqual({ allowed: true, value: 'https://evil.example/a?q=1', decisions: [] });
  });

  it('refuses schemes outside the allowlist, without a placeholder href', () => {
    const result = createUrlGuard()('java\tscript:alert(1)', LINK);
    expect(result).toMatchObject({ allowed: false, decision: { code: 'scheme-not-allowed', subject: 'link' } });
    expect(result.allowed === false && result.href).toBeUndefined();
  });

  it('gives the refused URL as href for a placeholder', () => {
    const result = createUrlGuard()('https://evil.example/a.png', IMAGE);
    expect(result.allowed === false && result.href).toBe('https://evil.example/a.png');
  });

  it('blocks sink hosts, or flags them under log', () => {
    expect(blocked(createUrlGuard()('https://webhook.site/abc', LINK)).code).toBe('sink-host');
    const logged = createUrlGuard({ mode: 'permissive' })('https://webhook.site/abc', LINK);
    expect(logged).toMatchObject({ allowed: true, decisions: [{ kind: 'flagged', code: 'sink-host' }] });
  });

  it('turns a throwing hook into a refusal, never an exception', () => {
    const guard = createUrlGuard({
      policy: {
        urls: { decide: () => { throw new Error('boom'); } },
        images: { hosts: 'any', rewriteUrl: () => { throw new Error('bang'); } },
      },
    });
    expect(blocked(guard('https://a.example/', LINK))).toMatchObject({ code: 'url-decider-failed', reason: 'urls.decide threw: boom' });
    const imageOnly = createUrlGuard({ policy: { images: { hosts: 'any', rewriteUrl: () => { throw new Error('bang'); } } } });
    expect(blocked(imageOnly('https://a.example/a.png', IMAGE)).code).toBe('image-rewrite-failed');
  });

  it('reports every decision to onDecision, the refusing one last', () => {
    const seen: string[] = [];
    const guard = createUrlGuard({ mode: 'permissive', policy: { urls: { decide: () => ({ allow: false }) } }, onDecision: (d) => seen.push(`${d.kind}:${d.code}`) });
    guard('https://webhook.site/abc', LINK);
    expect(seen).toEqual(['flagged:sink-host', 'blocked:url-denied']);
  });

  it('resolves relative URLs against the page', () => {
    expect(createUrlGuard({ mode: 'strict' })('/img/a.png', IMAGE)).toMatchObject({ allowed: true, value: '/img/a.png' });
    expect(blocked(createUrlGuard({ policy: { urls: { allowRelativeUrls: false } } })('/a', LINK)).code).toBe('relative-url-not-allowed');
  });
});

/**
 * The guard is the sanitizer's own URL pipeline, so a URL attribute and a guarded value must come
 * out the same: same value, same journal. Placeholders are off so the journal has only URL entries.
 */
describe('createUrlGuard agrees with the sanitizer', () => {
  const urls = [
    'https://cdn.example/a.png',
    'https://cdn.example/a.png?token=abc#frag',
    'https://evil.example/a.png',
    'https://app.example/same-origin.png',
    '/relative.png',
    '//cdn.example/protocol-relative.png',
    'javascript:alert(1)',
    'data:image/png;base64,iVBORw0KGgo=',
    'https://webhook.site/abc',
    `https://cdn.example/${'Zm9vYmFyYmF6cXV4'.repeat(6)}.png`,
    'https://redirect.example/go',
    'mailto:someone@example.com',
  ];
  const variants: Array<[string, RenderMode, RenderPolicyOverrides]> = [
    ['balanced, no hosts', 'balanced', {}],
    ['balanced, allowlist', 'balanced', { images: { hosts: ['cdn.example'] } }],
    ['strict', 'strict', {}],
    ['permissive', 'permissive', {}],
    ['proxy and decide', 'balanced', {
      images: { hosts: ['cdn.example', 'webhook.site'], rewriteUrl: (url) => `https://proxy.example/?u=${encodeURIComponent(url.href)}` },
      urls: { decide: (url) => (url.host === 'redirect.example' ? { rewrite: 'https://app.example/out', reason: 'off-site' } : null) },
    }],
  ];

  const attributeOf = (html: string, mode: RenderMode, policy: RenderPolicyOverrides, selector: string, name: string) => {
    const renderer = createRenderer({ mode, policy: { ...policy, images: { ...policy.images, blocked: 'remove' } } });
    const { fragment, decisions } = renderer.sanitizeHtml(html);
    return { value: fragment.querySelector(selector)?.getAttribute(name) ?? null, decisions: decisions.filter((d) => d.attribute === name) };
  };

  const expectation = (result: UrlGuardResult) => ({
    value: result.allowed ? result.value : null,
    decisions: result.allowed ? result.decisions : [...result.decisions, result.decision],
  });

  for (const [label, mode, policy] of variants) {
    it(label, () => {
      const guard = createUrlGuard({ mode, policy });
      for (const url of urls) {
        const quoted = url.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
        expect(attributeOf(`<img src="${quoted}" alt="">`, mode, policy, 'img', 'src'), `img ${url}`).toEqual(expectation(guard(url, IMAGE)));
        expect(attributeOf(`<a href="${quoted}">x</a>`, mode, policy, 'a', 'href'), `a ${url}`).toEqual(expectation(guard(url, LINK)));
      }
    });
  }
});
