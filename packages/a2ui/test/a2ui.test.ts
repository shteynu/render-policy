import { describe, expect, it, vi } from 'vitest';
import { createA2uiGuard, createA2uiMarkdownRenderer } from '../src/index.js';
import type { A2uiDecision, A2uiUrlResult } from '../src/index.js';

const refusal = (result: A2uiUrlResult): A2uiDecision => {
  if (result.allowed) throw new Error(`expected a refusal, got ${result.value}`);
  return result.decision;
};

describe('url: image, media and icon values', () => {
  const guard = createA2uiGuard({ policy: { images: { hosts: ['cdn.example'] } } });

  it('applies the image allowlist and strips the query string', () => {
    expect(guard.url('image', 'https://cdn.example/a.png?session=abc', { surfaceId: 's1', componentId: 'hero' })).toMatchObject({
      allowed: true,
      value: 'https://cdn.example/a.png',
      decisions: [{ code: 'image-query-stripped', a2ui: { kind: 'image', surfaceId: 's1', componentId: 'hero' } }],
    });
    expect(refusal(guard.url('image', 'https://evil.example/a.png'))).toMatchObject({ code: 'image-host-not-allowed', a2ui: { kind: 'image' } });
  });

  it('holds video, audio and the theme icon to the image policy', () => {
    for (const kind of ['video', 'audio', 'icon'] as const) {
      expect(refusal(guard.url(kind, 'https://evil.example/m')).code, kind).toBe('image-host-not-allowed');
      expect(guard.url(kind, 'https://cdn.example/m').allowed, kind).toBe(true);
    }
    expect(refusal(guard.url('video', 'https://evil.example/m.mp4'))).toMatchObject({ tag: 'video', attribute: 'src', subject: 'image' });
  });

  it('checks the value a formatString or data binding resolved to', () => {
    // `formatString` with "https://cdn.example/${/secret}.png" and a data model holding a long token.
    const resolved = `https://cdn.example/${'c2VjcmV0LXRva2VuLWZyb20tdGhlLWNoYXQ'.repeat(3)}.png`;
    expect(refusal(guard.url('image', resolved)).code).toBe('url-encoded-payload');
  });

  it('blocks sink hosts even for allowed kinds of value', () => {
    expect(refusal(createA2uiGuard({ policy: { images: { hosts: 'any' } } }).url('image', 'https://webhook.site/x.png')).code).toBe('sink-host');
  });

  it('refuses values that are not a usable string', () => {
    for (const value of [undefined, null, 42, '', '   ', { path: '/img' }, ['https://cdn.example/a.png']]) {
      const result = guard.url('image', value);
      expect(refusal(result), JSON.stringify(value)).toMatchObject({ code: 'a2ui-not-a-url', tag: 'img', attribute: 'src' });
    }
  });

  it('allows same-origin and relative images under strict', () => {
    const strict = createA2uiGuard({ mode: 'strict' });
    expect(strict.url('image', '/assets/logo.png')).toMatchObject({ allowed: true, value: '/assets/logo.png' });
    expect(refusal(strict.url('image', 'https://cdn.example/a.png')).code).toBe('remote-images-disabled');
  });
});

describe('openUrl', () => {
  it('opens allowed http(s) targets with noopener,noreferrer', () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const result = createA2uiGuard().openUrl('https://docs.example/page');
    expect(result.allowed).toBe(true);
    expect(open).toHaveBeenCalledWith('https://docs.example/page', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('allows only http and https, whatever else the policy allows for links', () => {
    const open = vi.fn();
    const guard = createA2uiGuard({ open });
    for (const target of ['javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>x</script>', 'mailto:a@example.com', 'tel:+100', 'vbscript:x']) {
      expect(refusal(guard.openUrl(target)).code, target).toBe('scheme-not-allowed');
    }
    expect(open).not.toHaveBeenCalled();
  });

  it('resolves relative targets against the page and applies the sink denylist and urls.decide', () => {
    const open = vi.fn();
    const guard = createA2uiGuard({ open, policy: { urls: { decide: (url) => (url.host === 'off.example' ? { allow: false, reason: 'off-site' } : null) } } });
    expect(guard.openUrl('/settings').allowed).toBe(true);
    expect(refusal(guard.openUrl('https://abc.ngrok.io/collect')).code).toBe('sink-host');
    expect(refusal(guard.openUrl('https://off.example/'))).toMatchObject({ code: 'url-denied', reason: 'off-site', a2ui: { kind: 'openUrl' } });
    expect(open.mock.calls).toEqual([['/settings']]);
  });

  it('never throws when application hooks do', () => {
    const guard = createA2uiGuard({ open: () => {}, policy: { urls: { decide: () => { throw new Error('boom'); } } } });
    expect(refusal(guard.openUrl('https://docs.example/')).code).toBe('url-decider-failed');
  });
});

describe('text: the catalog contract', () => {
  const guard = createA2uiGuard({ policy: { images: { hosts: 'any' } } });

  it('shows raw HTML as text and keeps formatting', () => {
    const { fragment, decisions } = guard.text('**bold** <img src=x onerror=alert(1)> <b>tag</b>');
    expect(fragment.querySelector('strong')?.textContent).toBe('bold');
    expect(fragment.querySelector('img, b, [onerror]')).toBeNull();
    expect(fragment.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(decisions.filter((d) => d.code === 'a2ui-text-html').length).toBe(3);
    expect(decisions.every((d) => d.a2ui.kind === 'text')).toBe(true);
  });

  it('replaces images with their alt text and links with their text, even when the policy allows them', () => {
    const { fragment, decisions } = guard.text('![chart of sales](https://cdn.example/c.png) [**docs**](https://docs.example) https://auto.example/x [ref][r]\n\n[r]: https://ref.example', { componentId: 'msg' });
    expect(fragment.querySelector('a, img')).toBeNull();
    expect(fragment.textContent).toContain('chart of sales');
    expect(fragment.querySelector('strong')?.textContent).toBe('docs');
    expect(decisions.map((d) => d.code)).toEqual(['a2ui-text-image', 'a2ui-text-link', 'a2ui-text-link', 'a2ui-text-link']);
    expect(decisions[0]).toMatchObject({ value: 'https://cdn.example/c.png', a2ui: { kind: 'text', componentId: 'msg' } });
  });

  it('renders inline text without block wrappers', () => {
    const { fragment } = guard.text('a *b*', { inline: true });
    expect(fragment.querySelector('p')).toBeNull();
    expect(fragment.querySelector('em')?.textContent).toBe('b');
  });

  it('renders non-string values as their string form', () => {
    expect(guard.text(42).fragment.textContent?.trim()).toBe('42');
    expect(guard.text(null).fragment.textContent).toBe('');
  });

  it('text: "policy" renders Text like other Markdown under the policy', () => {
    const relaxed = createA2uiGuard({ text: 'policy', policy: { images: { hosts: ['cdn.example'] } } });
    const { fragment } = relaxed.text('[docs](https://docs.example) ![c](https://cdn.example/c.png) ![e](https://evil.example/e.png)');
    expect(fragment.querySelector('a[href="https://docs.example"]')).not.toBeNull();
    expect(fragment.querySelectorAll('img').length).toBe(1);
  });

  it('renderText inserts with replaceChildren, never innerHTML', () => {
    const target = document.createElement('div');
    target.append('old');
    Object.defineProperty(target, 'innerHTML', { set: () => { throw new Error('innerHTML must not be used'); } });
    guard.renderText(target, '# Title');
    expect(target.querySelector('h1')?.textContent).toBe('Title');
    expect(target.textContent).not.toContain('old');
  });

  it('reports every decision to onDecision', () => {
    const seen: A2uiDecision[] = [];
    const g = createA2uiGuard({ onDecision: (d) => seen.push(d) });
    g.text('[x](https://a.example)');
    g.url('image', 'https://evil.example/a.png');
    g.url('icon', 7);
    expect(seen.map((d) => `${d.a2ui.kind}:${d.code}`)).toEqual(['text:a2ui-text-link', 'image:image-host-not-allowed', 'icon:a2ui-not-a-url']);
  });
});

describe('createA2uiMarkdownRenderer: the renderers\' string plug-in', () => {
  const parse = (html: string): DocumentFragment => document.createRange().createContextualFragment(html);

  it('returns sanitized HTML without links, images or raw HTML', async () => {
    const render = createA2uiMarkdownRenderer();
    const html = await render('# Hi\n\n[x](javascript:alert(1)) ![y](https://evil.example/y.png) <svg onload=alert(1)>');
    const out = parse(html);
    expect(out.querySelector('h1')?.textContent).toBe('Hi');
    expect(out.querySelector('a, img, svg, [onload]')).toBeNull();
  });

  it('applies tagClassMap after sanitization and honours renderMode', async () => {
    const decisions: A2uiDecision[] = [];
    const render = createA2uiMarkdownRenderer({ onDecision: (d) => decisions.push(d) });
    const html = await render('**a** [b](https://b.example)', { renderMode: 'inline', tagClassMap: { strong: ['a2ui-bold'], 'p onclick': ['x'] } });
    expect(html).toBe('<strong class="a2ui-bold">a</strong> b');
    expect(decisions.map((d) => d.code)).toEqual(['a2ui-text-link']);
  });

  it('accepts a guard shared with the rest of the surface', async () => {
    const guard = createA2uiGuard({ text: 'policy' });
    expect(await createA2uiMarkdownRenderer({ guard })('[d](https://d.example)')).toContain('href="https://d.example"');
  });
});
