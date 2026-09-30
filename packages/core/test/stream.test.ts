import { describe, expect, it } from 'vitest';
import { closeOpenFences, createRenderer, holdIncompleteHtml, holdIncompleteMarkdown } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');

describe('closeOpenFences', () => {
  it('leaves text without fences alone', () => {
    expect(closeOpenFences('plain **text**')).toBe('plain **text**');
  });
  it('closes an unfinished backtick fence', () => {
    expect(closeOpenFences('```js\nconst a = 1;')).toBe('```js\nconst a = 1;\n```');
  });
  it('closes an unfinished tilde fence with the same length', () => {
    expect(closeOpenFences('~~~~\ncode\n')).toBe('~~~~\ncode\n~~~~');
  });
  it('does not treat a shorter fence as a closer', () => {
    expect(closeOpenFences('````\n```\ninner')).toBe('````\n```\ninner\n````');
  });
  it('leaves a closed fence alone', () => {
    expect(closeOpenFences('```\ncode\n```\nafter')).toBe('```\ncode\n```\nafter');
  });
  it('ignores backtick fences whose info string contains a backtick', () => {
    expect(closeOpenFences('``` a`b\ntext')).toBe('``` a`b\ntext');
  });
});

describe('holdIncompleteMarkdown', () => {
  it.each([
    ['see [docs](https://exa', 'see '],
    ['![a](https://cdn.example/a.png', ''],
    ['text ![a](https://x.example/a.png) more', 'text ![a](https://x.example/a.png) more'],
    ['[link](https://x.example/a(b)', ''],
    ['go to https://exa', 'go to '],
    ['go to https://x.example/ done', 'go to https://x.example/ done'],
    ['visit www.exa', 'visit '],
    ['<img src="https://x', ''],
    ['before <a href="https://x.example/">ok</a> <', 'before <a href="https://x.example/">ok</a> '],
    ['a < b', 'a < b'],
    ['[ref]: https://exa', ''],
    ['text\n[ref]: https://x.example/ "title"', 'text\n[ref]: https://x.example/ "title"'],
    ['nothing to hold', 'nothing to hold'],
  ])('%j -> %j', (input, expected) => {
    expect(holdIncompleteMarkdown(input)).toBe(expected);
  });
});

describe('holdIncompleteHtml', () => {
  it('cuts before an unclosed tag', () => {
    expect(holdIncompleteHtml('<p>hi</p><img src="https://x')).toBe('<p>hi</p>');
    expect(holdIncompleteHtml('<p>hi</p>')).toBe('<p>hi</p>');
  });
});

describe('streaming render', () => {
  it('never renders an image before its URL is closed and verified', () => {
    const target = box();
    const stream = createRenderer({ policy: { imageHosts: ['cdn.example'] } }).createStream(target);
    stream.push('Look: ![chart](https://cdn.exa');
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).not.toContain('https://');
    stream.push('mple/c.png?sig=1');
    expect(target.querySelector('img')).toBeNull();
    stream.push(') done');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/c.png');
    expect(target.textContent).toContain('done');
    stream.end();
    expect(target.querySelectorAll('img').length).toBe(1);
    expect(stream.ended).toBe(true);
  });

  it('withholds a half-received link and shows it once complete', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.push('read [the spec](https://spec.exa');
    expect(target.querySelector('a')).toBeNull();
    expect(target.textContent?.trim()).toBe('read');
    stream.push('mple/v1)');
    expect(target.querySelector('a')?.getAttribute('href')).toBe('https://spec.example/v1');
  });

  it('renders a streaming code block as code from the first chunk', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.push('```js\nconst a = 1;');
    expect(target.querySelector('pre > code.language-js')?.textContent).toContain('const a = 1;');
    stream.push('\nconst b = 2;\n```\nafter');
    expect(target.querySelector('pre > code.language-js')?.textContent).toContain('const b = 2;');
    expect(target.textContent).not.toContain('```');
    expect(target.textContent).toContain('after');
  });

  it('end() renders an unfinished link literally, never as a link', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.push('[x](https://evil.example/a');
    expect(target.textContent).toBe('');
    stream.end();
    // Nothing more is coming: the leftover is final text under the policy. GFM may autolink the bare URL; that needs a click.
    expect(target.querySelector('img')).toBeNull();
    expect(target.textContent).toContain('[x](https://evil.example/a');
    expect(() => stream.push('more')).toThrow();
  });

  it('set() replaces the buffer', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.set('# one');
    stream.set('# one two');
    expect(target.querySelector('h1')?.textContent).toBe('one two');
    expect(stream.text).toBe('# one two');
  });

  it('coalesces renders through the scheduler', () => {
    const target = box();
    const queued: Array<() => void> = [];
    const stream = createRenderer().createStream(target, { schedule: (render) => queued.push(render) });
    stream.push('a');
    stream.push('b');
    expect(target.textContent).toBe('');
    queued.at(-1)?.();
    expect(target.textContent?.trim()).toBe('ab');
  });

  it('withholds an unclosed tag in html mode', () => {
    const target = box();
    const stream = createRenderer({ mode: 'permissive' }).createStream(target, { mode: 'html' });
    stream.push('<p>hi</p><img src="https://cdn.example/a.png');
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('p')?.textContent).toBe('hi');
    stream.push('">');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
  });

  it('applies the policy to streamed content like any other render', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.push('<img src=x onerror=alert(1)> and ![p](https://webhook.site/x.png)');
    expect(target.querySelector('[onerror]')).toBeNull();
    const images = Array.from(target.querySelectorAll('img'));
    expect(images.map((i) => i.getAttribute('src'))).toEqual(['x']);
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
  });

  it('keeps settled blocks in place and replaces only the tail (streaming v1)', () => {
    const target = box();
    const renderer = createRenderer();
    const stream = renderer.createStream(target);
    stream.push('# Title\n\nFirst paragraph.\n\nSecond para');
    const heading = target.querySelector('h1');
    const first = target.querySelectorAll('p')[0];
    stream.push('graph continues.\n\n- item');
    expect(target.querySelector('h1')).toBe(heading);
    expect(target.querySelectorAll('p')[0]).toBe(first);
    expect(target.querySelectorAll('p')[1]?.textContent).toBe('Second paragraph continues.');
    expect(target.querySelector('li')?.textContent).toBe('item');
    stream.end();
    const fresh = box();
    renderer.renderMarkdownInto(fresh, stream.text);
    expect(target.innerHTML).toBe(fresh.innerHTML);
    expect(target.querySelector('h1')).toBe(heading);
  });

  it('patch: false replaces every node on each push', () => {
    const target = box();
    const stream = createRenderer().createStream(target, { patch: false });
    stream.push('# Title\n\nabc');
    const heading = target.querySelector('h1');
    stream.push('def');
    expect(target.querySelector('h1')).not.toBe(heading);
    expect(target.querySelector('p')?.textContent).toBe('abcdef');
  });

  it('reset() clears the target and the buffer', () => {
    const target = box();
    const stream = createRenderer().createStream(target);
    stream.push('text');
    stream.reset();
    expect(target.childNodes.length).toBe(0);
    expect(stream.text).toBe('');
  });
});
