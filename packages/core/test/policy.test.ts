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
    createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
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
    const { decisions } = createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png?token=abc#frag)',
    );
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(decisions.some((d) => d.kind === 'rewritten' && d.subject === 'image')).toBe(true);
  });

  it('imageQuery: deny rejects images that carry a query string', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example'], imageQuery: 'deny' } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png?token=abc) ![y](https://cdn.example/b.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/b.png');
  });

  it('blocked images can be removed silently instead', () => {
    const target = box();
    createRenderer({ policy: { blockedImage: 'remove' } }).renderMarkdownInto(target, 'a ![x](https://cdn.example/a.png) b');
    expect(target.querySelector('img, a')).toBeNull();
    expect(target.textContent?.trim()).toBe('a  b');
  });

  it('rejects wildcard hosts unless allowWildcardHosts is set', () => {
    expect(() => createRenderer({ policy: { imageHosts: ['*.example'] } })).toThrow(/allowWildcardHosts/);
    const target = box();
    createRenderer({ policy: { imageHosts: ['*.example'], allowWildcardHosts: true } }).renderMarkdownInto(
      target,
      '![a](https://a.example/a.png) ![b](https://example/b.png)',
    );
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://a.example/a.png');
  });

  it('matches hosts exactly, port included', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example:8443'] } }).renderMarkdownInto(
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
        imageHosts: ['cdn.example'],
        rewriteImageUrl: (url) => `https://app.example/proxy?u=${encodeURIComponent(url.href)}`,
      },
    }).renderMarkdownInto(target, '![x](https://cdn.example/a.png?sig=1)');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://app.example/proxy?u=https%3A%2F%2Fcdn.example%2Fa.png');
  });

  it('rewriteImageUrl returning null blocks the image', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example'], rewriteImageUrl: () => null } }).renderMarkdownInto(
      target,
      '![x](https://cdn.example/a.png)',
    );
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
  });

  it('allowImages: false removes images entirely', () => {
    const target = box();
    createRenderer({ policy: { allowImages: false } }).renderMarkdownInto(target, '![x](/a.png)');
    expect(target.querySelector('img, a')).toBeNull();
  });

  it('exposes the resolved policy and validates it', () => {
    expect(createRenderer({ mode: 'strict' }).policy.imageHosts).toBe('none');
    expect(resolvePolicy('permissive').sinkDenylist).toBe('log');
    expect(() => resolvePolicy('balanced', { allowedSchemes: ['HTTPS'] })).toThrow(/lower-case/);
    expect(() => resolvePolicy('balanced', { allowedClassPatterns: [/x/g] })).toThrow(/flags/);
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
    createRenderer({ policy: { imageHosts: ['storage.googleapis.com'] } }).renderMarkdownInto(
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
    createRenderer({ policy: { sinkDenylist: 'off' } }).renderHtmlInto(target, '<a href="https://webhook.site/x">b</a>');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://webhook.site/x');
  });
});

describe('url heuristics', () => {
  const payload = Buffer.from('the whole conversation, base64-encoded '.repeat(6)).toString('base64');

  it('blocks allowed-host images whose path carries an encoded payload', () => {
    const target = box();
    const { decisions } = createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
      target,
      `![x](https://cdn.example/${payload}.png)`,
    );
    expect(target.querySelector('img')).toBeNull();
    expect(decisions.some((d) => d.reason.includes('encoded payload'))).toBe(true);
  });

  it('blocks long hex tokens too', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(target, `![x](https://cdn.example/${'deadbeef'.repeat(12)}.png)`);
    expect(target.querySelector('img')).toBeNull();
  });

  it('lets ordinary asset paths and 64-character hashes through', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
      target,
      `![a](https://cdn.example/assets/hero-image-2026-09-30-large-retina-version-final.png) ![b](https://cdn.example/${'ab'.repeat(32)}.png)`,
    );
    expect(target.querySelectorAll('img').length).toBe(2);
  });

  it('blocks over-long URLs', () => {
    const target = box();
    const { decisions } = createRenderer({ policy: { imageHosts: ['cdn.example'] } }).renderMarkdownInto(
      target,
      `![x](https://cdn.example/${'a/'.repeat(1200)}x.png)`,
    );
    expect(target.querySelector('img')).toBeNull();
    expect(decisions.some((d) => d.reason.includes('longer than'))).toBe(true);
  });

  it('can be disabled', () => {
    const target = box();
    createRenderer({ policy: { imageHosts: ['cdn.example'], urlHeuristics: false } }).renderMarkdownInto(
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
    createRenderer({ policy: { allowedSchemes: ['https', 'myapp'] } }).renderMarkdownInto(target, '[a](http://x.example/) [b](myapp://open)');
    expect(Array.from(target.querySelectorAll('a')).map((a) => a.getAttribute('href'))).toEqual([null, 'myapp://open']);
  });

  it('drops relative links when allowRelativeUrls is false', () => {
    const target = box();
    createRenderer({ policy: { allowRelativeUrls: false } }).renderMarkdownInto(target, '[a](/settings) [b](https://x.example/)');
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
