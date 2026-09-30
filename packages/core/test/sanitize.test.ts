import { describe, expect, it } from 'vitest';
import { createRenderer } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('script execution vectors', () => {
  it('removes <script> and keeps the surrounding text', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<p>hi</p><script>window.__pwned = 1</script>');
    expect(target.querySelector('script')).toBeNull();
    expect(target.textContent).toBe('hi');
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it('strips onerror from <img> and keeps a same-origin image', () => {
    const target = box();
    const { decisions } = createRenderer().renderHtmlInto(target, '<img src="/x.png" onerror="window.__pwned=1">');
    const img = target.querySelector('img');
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/x.png');
    expect(img?.hasAttribute('onerror')).toBe(false);
    expect(decisions.some((d) => d.kind === 'blocked' && d.attribute === 'onerror')).toBe(true);
  });

  it('drops inline SVG together with its event handlers', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<svg onload="alert(1)"><circle r="1"/></svg><p>after</p>');
    expect(target.querySelector('svg')).toBeNull();
    expect(target.querySelector('[onload]')).toBeNull();
    expect(target.textContent).toBe('after');
  });

  it.each([
    'javascript:alert(1)',
    'java\tscript:alert(1)',
    'java\nscript:alert(1)',
    ' JaVaScRiPt:alert(1)',
    '\u0001javascript:alert(1)',
    'javascript&colon;alert(1)',
    'vbscript:MsgBox(1)',
    'data:text/html,<script>alert(1)</script>',
  ])('drops the link destination %j', (href) => {
    const target = box();
    createRenderer().renderHtmlInto(target, `<a href="${href}">click</a>`);
    const link = target.querySelector('a');
    expect(link).not.toBeNull();
    expect(link?.hasAttribute('href')).toBe(false);
    expect(link?.textContent).toBe('click');
  });

  it('renders a Markdown code block containing a payload as text', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, '```html\n<img src=x onerror=alert(1)>\n```');
    const code = target.querySelector('pre > code');
    expect(code?.className).toBe('language-html');
    expect(code?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(target.querySelector('img')).toBeNull();
  });

  it('renders inline code as text', () => {
    const target = box();
    createRenderer().renderMarkdownInto(target, 'use `<b>bold</b>` here');
    expect(target.querySelector('b')).toBeNull();
    expect(target.querySelector('code')?.textContent).toBe('<b>bold</b>');
  });
});

describe('host UI protection', () => {
  it('removes forms and form controls but keeps their text', () => {
    const target = box();
    createRenderer().renderHtmlInto(
      target,
      '<form action="https://evil.example"><label>Password <input type="password"></label><button>Sign in</button></form>',
    );
    expect(target.querySelector('form, input, button, label')).toBeNull();
    expect(target.textContent).toContain('Password');
    expect(target.textContent).toContain('Sign in');
  });

  it('removes <style> elements and style attributes', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<style>body{display:none}</style><p style="position:fixed;inset:0">x</p>');
    expect(target.querySelector('style')).toBeNull();
    expect(target.textContent).toBe('x');
    expect(target.querySelector('p')?.hasAttribute('style')).toBe(false);
  });

  it('keeps only allowlisted class names', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<p class="modal-open language-ts">a</p><p class="hidden">b</p>');
    const [first, second] = Array.from(target.querySelectorAll('p'));
    expect(first?.getAttribute('class')).toBe('language-ts');
    expect(second?.hasAttribute('class')).toBe(false);
  });

  it('accepts additional class patterns from the policy', () => {
    const target = box();
    createRenderer({ policy: { allowedClassPatterns: [/^chat-/] } }).renderHtmlInto(target, '<p class="chat-quote hidden">a</p>');
    expect(target.querySelector('p')?.getAttribute('class')).toBe('chat-quote');
  });

  it('drops data-* attributes', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<div data-toggle="modal" data-target="#x">x</div>');
    expect(target.querySelector('div')?.attributes.length).toBe(0);
  });

  it('neutralizes DOM clobbering through id and name', () => {
    const target = box();
    createRenderer().renderHtmlInto(target, '<a id="location">x</a><img name="body" src="/x.png"><p id="user-content">y</p>');
    expect(target.querySelector('a')?.id).not.toBe('location');
    expect(target.querySelector('img')?.getAttribute('name')).not.toBe('body');
    expect(target.querySelector('#location')).toBeNull();
  });

  it('forces rel="noopener noreferrer" on target="_blank" and drops other targets', () => {
    const target = box();
    createRenderer().renderHtmlInto(
      target,
      '<a href="https://x.example/" target="_blank" rel="opener">x</a><a href="https://x.example/" target="_top">y</a>',
    );
    const [blank, top] = Array.from(target.querySelectorAll('a'));
    expect(blank?.getAttribute('target')).toBe('_blank');
    expect(blank?.getAttribute('rel')).toBe('noopener noreferrer');
    expect(top?.hasAttribute('target')).toBe(false);
  });

  it('drops srcset and ping, which fetch without a click', () => {
    const target = box();
    createRenderer().renderHtmlInto(
      target,
      '<img src="/a.png" srcset="https://evil.example/a.png 1x"><a href="https://x.example/" ping="https://evil.example/p">x</a>',
    );
    expect(target.querySelector('img')?.hasAttribute('srcset')).toBe(false);
    expect(target.querySelector('a')?.hasAttribute('ping')).toBe(false);
  });

  it('removes embedding and metadata elements', () => {
    const target = box();
    createRenderer().renderHtmlInto(
      target,
      '<iframe src="https://evil.example"></iframe><object data="/x.swf"></object><embed src="/x"><meta http-equiv="refresh" content="0;url=https://evil.example"><base href="https://evil.example/"><template><img src=x onerror=alert(1)></template><p>ok</p>',
    );
    expect(target.querySelector('iframe, object, embed, meta, base, template, img')).toBeNull();
    expect(target.textContent).toBe('ok');
  });

  it('removes media elements by default and allows them by policy', () => {
    const html = '<video src="https://cdn.example/v.mp4" autoplay></video><audio src="https://cdn.example/a.mp3"></audio>';
    const closed = box();
    createRenderer().renderHtmlInto(closed, html);
    expect(closed.querySelector('video, audio')).toBeNull();
    const open = box();
    createRenderer({ policy: { allowMedia: true } }).renderHtmlInto(open, html);
    expect(open.querySelectorAll('video, audio').length).toBe(2);
  });
});

describe('insertion', () => {
  it('never assigns innerHTML on the target', () => {
    const target = box();
    Object.defineProperty(target, 'innerHTML', {
      get: () => '',
      set: () => {
        throw new Error('innerHTML must not be used');
      },
    });
    createRenderer().renderHtmlInto(target, '<p>ok</p>');
    expect(target.querySelector('p')?.textContent).toBe('ok');
  });

  it('renders into a shadow root and a document fragment', () => {
    const host = box();
    const shadow = host.attachShadow({ mode: 'open' });
    createRenderer().renderMarkdownInto(shadow, '# Title');
    expect(shadow.querySelector('h1')?.textContent).toBe('Title');

    const fragment = document.createDocumentFragment();
    createRenderer().renderHtmlInto(fragment, '<em>x</em>');
    expect(fragment.querySelector('em')?.textContent).toBe('x');
  });

  it('replaces previous content', () => {
    const target = box();
    const renderer = createRenderer();
    renderer.renderMarkdownInto(target, 'one');
    renderer.renderMarkdownInto(target, 'two');
    expect(target.textContent?.trim()).toBe('two');
    expect(target.querySelectorAll('p').length).toBe(1);
  });

  it('renders plain text without interpreting markup', () => {
    const target = box();
    createRenderer().renderTextInto(target, '<b>x</b>');
    expect(target.querySelector('b')).toBeNull();
    expect(target.textContent).toBe('<b>x</b>');
  });

  it('produces fragments without touching any live DOM', () => {
    const { fragment, decisions } = createRenderer().markdownToFragment('**bold** <script>1</script>');
    expect(fragment.querySelector('strong')?.textContent).toBe('bold');
    expect(fragment.querySelector('script')).toBeNull();
    expect(decisions.some((d) => d.subject === 'element' && d.tag === 'script')).toBe(true);
  });

  it('reports decisions through onDecision as well as the result', () => {
    const seen: string[] = [];
    const renderer = createRenderer({ onDecision: (d) => seen.push(`${d.kind}:${d.subject}:${d.attribute ?? d.tag ?? ''}`) });
    const { decisions } = renderer.renderHtmlInto(box(), '<img src="/a.png" onerror="x()">');
    expect(seen).toEqual(decisions.map((d) => `${d.kind}:${d.subject}:${d.attribute ?? d.tag ?? ''}`));
    expect(seen).toContain('blocked:attribute:onerror');
  });
});

describe('decision codes and application-code failures', () => {
  const box = (): HTMLDivElement => document.createElement('div');

  it('every decision carries a stable code next to its reason', () => {
    const renderer = createRenderer({ policy: { imageHosts: ['cdn.example'] } });
    const { decisions } = renderer.renderHtmlInto(
      box(),
      '<a href="javascript:alert(1)" onclick="x()" class="evil">l</a><img src="https://cdn.example/a.png?token=1"><img src="https://webhook.site/x.png"><img src="https://other.example/b.png"><form></form>',
    );
    const codes = decisions.map((d) => d.code);
    for (const expected of ['scheme-not-allowed', 'event-handler', 'class-not-allowed', 'image-query-stripped', 'sink-host', 'image-host-not-allowed', 'element-not-allowed']) {
      expect(codes, expected).toContain(expected);
    }
    expect(decisions.every((d) => typeof d.code === 'string' && d.code.length > 0 && d.reason.length > 0)).toBe(true);
  });

  it('a rewriteImageUrl that throws blocks that image and the render goes on', () => {
    const renderer = createRenderer({
      policy: {
        imageHosts: ['cdn.example'],
        rewriteImageUrl: (url) => {
          if (url.pathname.endsWith('boom.png')) throw new Error('proxy down');
          return `https://proxy.example/?u=${encodeURIComponent(url.href)}`;
        },
      },
    });
    const target = box();
    const { decisions } = renderer.renderHtmlInto(target, '<p>before</p><img src="https://cdn.example/boom.png" alt="b"><img src="https://cdn.example/ok.png"><p>after</p>');
    expect(target.querySelectorAll('p').length).toBe(2);
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://proxy.example/?u=https%3A%2F%2Fcdn.example%2Fok.png');
    expect(target.querySelector('a.rp-blocked-image')?.textContent).toBe('[image blocked: b]');
    const failure = decisions.find((d) => d.code === 'image-rewrite-failed');
    expect(failure?.kind).toBe('blocked');
    expect(failure?.reason).toContain('proxy down');
    expect(decisions.some((d) => d.code === 'image-rewritten')).toBe(true);
  });

  it('re-entering the renderer from rewriteImageUrl is refused, not silently mixed up', () => {
    const other = box();
    const renderer = createRenderer({
      policy: {
        imageHosts: ['cdn.example'],
        rewriteImageUrl: () => {
          renderer.renderHtmlInto(other, '<b>nested</b>');
          return null;
        },
      },
    });
    const { decisions } = renderer.renderHtmlInto(box(), '<img src="https://cdn.example/a.png">');
    const failure = decisions.find((d) => d.code === 'image-rewrite-failed');
    expect(failure?.reason).toContain('re-entered');
    expect(other.textContent).toBe('');
    // The sanitizer is usable again afterwards.
    expect(renderer.renderHtmlInto(other, '<b>later</b>').decisions).toEqual([]);
    expect(other.querySelector('b')?.textContent).toBe('later');
  });
});
