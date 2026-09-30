import { describe, expect, it } from 'vitest';
import { createRenderer, resolvePolicy } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('modes', () => {
  it('strict blocks every remote image and shows a placeholder link instead', () => {
    const target = box();
    const { decisions } = createRenderer({ mode: 'strict' }).renderMarkdownInto(target, '![diagram](https://cdn.example/a.png)');
    expect(target.querySelector('img')).toBeNull();
    const placeholder = target.querySelector('a.rp-blocked-image');
    expect(placeholder?.getAttribute('href')).toBe('https://cdn.example/a.png');
    expect(placeholder?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(placeholder?.textContent).toBe('[image blocked: diagram]');
    expect(decisions.some((d) => d.kind === 'blocked' && d.subject === 'image')).toBe(true);
  });

  it('strict keeps same-origin and relative images', () => {
    const target = box();
    createRenderer({ mode: 'strict' }).renderMarkdownInto(target, '![a](/img/a.png) ![b](https://app.example/img/b.png)');
    expect(target.querySelectorAll('img').length).toBe(2);
    expect(target.querySelector('.rp-blocked-image')).toBeNull();
  });

  it('balanced allows listed hosts and blocks the rest', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(
      target,
      '![ok](https://cdn.example/a.png) ![no](https://evil.example/a.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(target.querySelectorAll('a.rp-blocked-image').length).toBe(1);
  });

  it('balanced has an empty allowlist by default', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, '![no](https://cdn.example/a.png)');
    expect(target.querySelector('img')).toBeNull();
  });

  it('balanced strips the query string and fragment of an allowed image', () => {
    const target = box();
    const { decisions } = createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png?token=abc#frag)',
    );
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(decisions.some((d) => d.kind === 'rewritten' && d.subject === 'image')).toBe(true);
  });

  it('imageQuery: deny rejects images that carry a query string', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'], query: 'deny' } } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png?token=abc) ![y](https://cdn.example/b.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/b.png');
  });

  it('blocked images can be removed silently instead', () => {
    const target = box();
    createRenderer({ policy: { images: { blocked: 'remove' } } }).renderMarkdownInto(target, 'a ![x](https://cdn.example/a.png) b');
    expect(target.querySelector('img, a')).toBeNull();
    expect(target.textContent?.trim()).toBe('a  b');
  });

  it('rejects wildcard hosts unless allowWildcardHosts is set', () => {
    expect(() => createRenderer({ policy: { images: { hosts: ['*.example'] } } })).toThrow(/allowWildcardHosts/);
    const target = box();
    createRenderer({ policy: { images: { hosts: ['*.example'], allowWildcardHosts: true } } }).renderMarkdownInto(
      target,
      '![a](https://a.example/a.png) ![b](https://example/b.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://a.example/a.png');
  });

  it('matches hosts exactly, port included', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example:8443'] } } }).renderMarkdownInto(
      target,
      '![a](https://cdn.example:8443/a.png) ![b](https://cdn.example/b.png) ![c](https://cdn.example.evil.example/c.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example:8443/a.png');
  });

  it('permissive allows every host, keeps queries and only logs sinks', () => {
    const target = box();
    const { decisions } = createRenderer({ mode: 'permissive' }).renderMarkdownInto(target, '![x](https://webhook.site/abc?d=1)');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://webhook.site/abc?d=1');
    expect(decisions.some((d) => d.kind === 'flagged' && d.reason.includes('sink denylist'))).toBe(true);
  });

  it('applies rewriteImageUrl to allowed remote images', () => {
    const target = box();
    createRenderer({
      policy: {
        images: {
          hosts: ['cdn.example'],
          rewriteUrl: (url) => `https://app.example/proxy?u=${encodeURIComponent(url.href)}`,
        },
      },
    }).renderMarkdownInto(target, '![x](https://cdn.example/a.png?sig=1)');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://app.example/proxy?u=https%3A%2F%2Fcdn.example%2Fa.png');
  });

  it('rewriteImageUrl returning null blocks the image', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'], rewriteUrl: () => null } } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png)',
    );
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
  });

  it('allowImages: false removes images entirely', () => {
    const target = box();
    createRenderer({ policy: { content: { allowImages: false } } }).renderMarkdownInto(target, '![x](/a.png)');
    expect(target.querySelector('img, a')).toBeNull();
  });

  it('exposes the resolved policy and validates it', () => {
    expect(createRenderer({ mode: 'strict' }).policy.images.hosts).toBe('none');
    expect(resolvePolicy('permissive').urls.sinkDenylist).toBe('log');
    expect(() => resolvePolicy('balanced', { urls: { allowedSchemes: ['HTTPS'] } })).toThrow(/lower-case/);
    expect(() => resolvePolicy('balanced', { content: { allowedClassPatterns: [/x/g] } })).toThrow(/flags/);
    expect(() => resolvePolicy('nope' as never)).toThrow(/unknown mode/);
  });
});

describe('sink denylist', () => {
  it('blocks images and links to sink hosts', () => {
    const target = box();
    const { decisions } = createRenderer().renderHtmlInto(
      target,
      [
        '<img alt="pixel" src="https://x.webhook.site/a.png">',
        '<a href="https://forms.gle/abc">form</a>',
        '<a href="https://docs.google.com/document/d/1">doc</a>',
        '<a href="https://docs.google.com/forms/d/e/1/viewform">gform</a>',
      ].join(''),
    );
    expect(target.querySelector('img')).toBeNull();
    const placeholder = target.querySelector('a.rp-blocked-image');
    expect(placeholder?.textContent).toBe('[image blocked: pixel]');
    expect(placeholder?.hasAttribute('href')).toBe(false);
    const links = Array.from(target.querySelectorAll('a:not(.rp-blocked-image)'));
    expect(links.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['form', null],
      ['doc', 'https://docs.google.com/document/d/1'],
      ['gform', null],
    ]);
    expect(decisions.filter((d) => d.reason.includes('sink denylist')).length).toBe(4);
  });

  it('lets an explicit imageHosts entry win over the denylist', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['storage.googleapis.com'] } } }).renderMarkdownInto(
      target,
      '![x](https://storage.googleapis.com/bucket/a.png)',
    );
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://storage.googleapis.com/bucket/a.png');
  });

  it('accepts a custom denylist', () => {
    const target = box();
    createRenderer({ sinkDenylist: { version: 'test', entries: [{ pattern: 'corp-leak.example', category: 'webhook' }] } }).renderHtmlInto(
      target,
      '<a href="https://corp-leak.example/x">a</a><a href="https://webhook.site/x">b</a>',
    );
    const [a, b] = Array.from(target.querySelectorAll('a'));
    expect(a?.hasAttribute('href')).toBe(false);
    expect(b?.getAttribute('href')).toBe('https://webhook.site/x');
  });

  it('can be switched off', () => {
    const target = box();
    createRenderer({ policy: { urls: { sinkDenylist: 'off' } } }).renderHtmlInto(target, '<a href="https://webhook.site/x">b</a>');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://webhook.site/x');
  });
});

describe('url heuristics', () => {
  const payload = Buffer.from('the whole conversation, base64-encoded '.repeat(6)).toString('base64');

  it('blocks allowed-host images whose path carries an encoded payload', () => {
    const target = box();
    const { decisions } = createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(
      target,
      `![x](https://cdn.example/${payload}.png)`,
    );
    expect(target.querySelector('img')).toBeNull();
    expect(decisions.some((d) => d.reason.includes('encoded payload'))).toBe(true);
  });

  it('blocks long hex tokens too', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(target, `![x](https://cdn.example/${'deadbeef'.repeat(12)}.png)`);
    expect(target.querySelector('img')).toBeNull();
  });

  it('lets ordinary asset paths and 64-character hashes through', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(
      target,
      `![a](https://cdn.example/assets/hero-image-2026-09-30-large-retina-version-final.png) ![b](https://cdn.example/${'ab'.repeat(32)}.png)`,
    );
    expect(target.querySelectorAll('img').length).toBe(2);
  });

  it('blocks over-long URLs', () => {
    const target = box();
    const { decisions } = createRenderer({ policy: { images: { hosts: ['cdn.example'] } } }).renderMarkdownInto(
      target,
      `![x](https://cdn.example/${'a/'.repeat(1200)}x.png)`,
    );
    expect(target.querySelector('img')).toBeNull();
    expect(decisions.some((d) => d.reason.includes('longer than'))).toBe(true);
  });

  it('can be disabled', () => {
    const target = box();
    createRenderer({ policy: { images: { hosts: ['cdn.example'] }, urls: { heuristics: false } } }).renderMarkdownInto(
      target,
      `![x](https://cdn.example/${payload}.png)`,
    );
    expect(target.querySelector('img')).not.toBeNull();
  });
});

describe('links', () => {
  it('keeps http, https, mailto and tel links', () => {
    const target = box();
    createRenderer().renderMarkdownInto(
      target,
      '[a](http://x.example/) [b](https://x.example/) [c](mailto:me@x.example) [d](tel:+123)',
    );
    expect(Array.from(target.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([
      'http://x.example/',
      'https://x.example/',
      'mailto:me@x.example',
      'tel:+123',
    ]);
  });

  it('drops ftp, file, blob and unknown schemes', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, '[a](ftp://x.example/) [b](file:///etc/passwd) [c](blob:https://x.example/1) [d](myapp://open)');
    expect(target.querySelectorAll('a').length).toBe(4);
    expect(target.querySelector('a[href]')).toBeNull();
  });

  it('honours a custom scheme allowlist', () => {
    const target = box();
    createRenderer({ policy: { urls: { allowedSchemes: ['https', 'myapp'] } } }).renderMarkdownInto(target, '[a](http://x.example/) [b](myapp://open)');
    expect(Array.from(target.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([null, 'myapp://open']);
  });

  it('drops relative links when allowRelativeUrls is false', () => {
    const target = box();
    createRenderer({ policy: { urls: { allowRelativeUrls: false } } }).renderMarkdownInto(target, '[a](/settings) [b](https://x.example/)');
    expect(Array.from(target.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([null, 'https://x.example/']);
  });

  it('treats protocol-relative and backslash URLs as remote', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<img src="//evil.example/a.png"><img src="\\\\evil.example\\a.png"><a href="//evil.example/x">x</a>');
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelectorAll('a.rp-blocked-image').length).toBe(2);
    expect(target.querySelector('a:not(.rp-blocked-image)')?.getAttribute('href')).toBe('//evil.example/x');
  });
});

describe('grouped policy and the urls.decide hook', () => {
  it('merges each group onto the preset, leaving the other fields of that group and the other groups intact', () => {
    const p = resolvePolicy('balanced', { images: { hosts: ['cdn.example'] } });
    expect(p.images.hosts).toEqual(['cdn.example']);
    expect(p.images.query).toBe('strip'); // preset field of the same group kept
    expect(p.images.blocked).toBe('placeholder');
    expect(p.urls.sinkDenylist).toBe('block'); // other group untouched
    expect(p.content.allowForms).toBe(false);
    // The preset objects are not mutated by resolving an override.
    expect(resolvePolicy('balanced').images.hosts).toEqual([]);
  });

  it('urls.decide denies a link and journals it', () => {
    const target = box();
    const { decisions } = createRenderer({
      policy: { urls: { decide: (url, ctx) => (ctx.subject === 'link' && url.host !== 'ok.example' ? { allow: false, reason: 'off-site link' } : null) } },
    }).renderMarkdownInto(target, '[a](https://evil.example/x) and [b](https://ok.example/y)');
    const hrefs = [...target.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual([null, 'https://ok.example/y']);
    const denied = decisions.find((d) => d.code === 'url-denied');
    expect(denied?.subject).toBe('link');
    expect(denied?.reason).toBe('off-site link');
  });

  it('urls.decide rewrites a link through a redirector, re-checked against the scheme allowlist', () => {
    const target = box();
    const { decisions } = createRenderer({
      policy: { urls: { decide: (url, ctx) => (ctx.subject === 'link' ? { rewrite: `https://r.example/?to=${encodeURIComponent(url.href)}`, reason: 'redirected' } : null) } },
    }).renderMarkdownInto(target, '[a](https://x.example/p)');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://r.example/?to=https%3A%2F%2Fx.example%2Fp');
    expect(decisions.some((d) => d.code === 'url-rewritten' && d.reason === 'redirected')).toBe(true);
  });

  it('urls.decide runs on images before the image policy, and a deny shows the placeholder', () => {
    const target = box();
    createRenderer({
      policy: {
        images: { hosts: ['cdn.example'] },
        urls: { decide: (url, ctx) => (ctx.subject === 'image' && url.pathname.endsWith('block.png') ? { allow: false, reason: 'blocked image' } : null) },
      },
    }).renderMarkdownInto(target, '![x](https://cdn.example/block.png) ![y](https://cdn.example/ok.png)');
    expect([...target.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/ok.png']);
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
  });

  it('a urls.decide that throws drops that URL and the render goes on', () => {
    const target = box();
    const { decisions } = createRenderer({
      policy: { urls: { decide: () => { throw new Error('decider boom'); } } },
    }).renderHtmlInto(target, '<p>text <a href="https://x.example/">l</a> more</p>');
    expect(target.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(target.textContent).toContain('more');
    const failure = decisions.find((d) => d.code === 'url-decider-failed');
    expect(failure?.reason).toContain('decider boom');
  });

  it('a decide rewrite to a disallowed scheme is refused, not applied', () => {
    const target = box();
    const { decisions } = createRenderer({
      policy: { urls: { decide: () => ({ rewrite: 'javascript:alert(1)' }) } },
    }).renderHtmlInto(target, '<a href="https://ok.example/">l</a>');
    expect(target.querySelector('a')?.hasAttribute('href')).toBe(false);
    expect(decisions.some((d) => d.code === 'url-rewrite-invalid')).toBe(true);
  });
});
