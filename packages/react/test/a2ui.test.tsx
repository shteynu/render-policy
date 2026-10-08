import { createA2uiGuard, type A2uiDecision } from '@render-policy/a2ui';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { A2uiGuardProvider, RpA2uiImage, RpA2uiText, useA2uiGuard } from '../src/a2ui/index.js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let roots: Root[] = [];

function mount(ui: ReactElement): { container: HTMLDivElement; update: (next: ReactElement) => void } {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(ui));
  roots.push(root);
  return { container, update: (next) => act(() => root.render(next)) };
}

afterEach(() => {
  for (const root of roots) act(() => root.unmount());
  roots = [];
  document.body.replaceChildren();
});

const hosts = { policy: { images: { hosts: ['cdn.example'] } } };

describe('RpA2uiText', () => {
  it('renders the catalog contract: Markdown without HTML, images or links', () => {
    const seen: A2uiDecision[] = [];
    const { container } = mount(
      <RpA2uiText
        text={'**Done.** <img src="https://evil.example/p.png"> ![chart](https://evil.example/c.png) [sign in](https://evil.example/login)'}
        componentId="t"
        onDecisions={(d) => seen.push(...d)}
      />,
    );
    const element = container.firstElementChild as HTMLElement;
    expect(element.tagName).toBe('DIV');
    expect(element.className).toBe('a2ui-text body');
    expect(element.querySelector('strong')?.textContent).toBe('Done.');
    expect(element.querySelector('img, a')).toBeNull();
    expect(element.textContent).toContain('sign in');
    expect(seen.map((d) => d.code)).toEqual(['a2ui-text-html', 'a2ui-text-image', 'a2ui-text-link']);
    expect(seen[0]?.a2ui).toEqual({ kind: 'text', componentId: 't' });
  });

  it('renders headings and captions inline, in their own element, with the caller class', () => {
    const { container, update } = mount(<RpA2uiText text="A *title*" variant="h2" className="mine" />);
    const heading = container.firstElementChild as HTMLElement;
    expect(heading.tagName).toBe('H2');
    expect(heading.className).toBe('a2ui-text h2 mine');
    expect(heading.querySelector('p')).toBeNull();
    expect(heading.querySelector('em')?.textContent).toBe('title');
    update(<RpA2uiText text="small print" variant="caption" />);
    expect(container.firstElementChild?.tagName).toBe('SPAN');
    expect(container.firstElementChild?.textContent).toBe('small print');
  });

  it('re-renders a bound value swapped after the first render, without innerHTML', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!descriptor?.set) throw new Error('jsdom innerHTML accessor missing');
    const setter = vi.fn(descriptor.set);
    Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor, set: setter });
    try {
      const { container, update } = mount(<RpA2uiText text="Loading..." />);
      update(<RpA2uiText text={'Done. <img src=x onerror="alert(1)">'} />);
      expect(container.textContent).toContain('Done.');
      expect(container.textContent).not.toContain('Loading');
      expect(container.querySelector('img')).toBeNull();
      expect(setter).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
    }
  });

  it('takes only the catalog variants: an unknown one is body, never a tag or a class', () => {
    const { container } = mount(<RpA2uiText text="hi" variant={'script' as never} />);
    const element = container.firstElementChild as HTMLElement;
    expect([element.tagName, element.className]).toEqual(['DIV', 'a2ui-text body']);
    expect(container.querySelector('script')).toBeNull();
  });

  it('renders non-string values as their string form', () => {
    const { container } = mount(<RpA2uiText text={42} variant="h1" />);
    expect(container.querySelector('h1')?.textContent).toBe('42');
  });
});

describe('RpA2uiImage', () => {
  it('renders an allowed URL with the value the guard returns', () => {
    const seen: A2uiDecision[] = [];
    const { container } = mount(
      <A2uiGuardProvider config={hosts}>
        <RpA2uiImage url="https://cdn.example/a.png?track=1" description="A chart" fit="scaleDown" variant="avatar" componentId="hero" onDecisions={(d) => seen.push(...d)} />
      </A2uiGuardProvider>,
    );
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(img?.getAttribute('alt')).toBe('A chart');
    expect(img?.className).toBe('a2ui-image avatar');
    expect(img?.style.objectFit).toBe('scale-down');
    expect(seen).toMatchObject([{ code: 'image-query-stripped', a2ui: { kind: 'image', componentId: 'hero' } }]);
  });

  it('creates no element for a blocked URL and renders the fallback', () => {
    const seen: A2uiDecision[] = [];
    const { container } = mount(<RpA2uiImage url="https://evil.example/p.png?d=secret" fallback={<em>image blocked</em>} onDecisions={(d) => seen.push(...d)} />);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('em')?.textContent).toBe('image blocked');
    expect(seen.map((d) => d.code)).toEqual(['image-host-not-allowed']);
  });

  it('checks a value swapped after a clean first render', () => {
    const ui = (url: string) => (
      <A2uiGuardProvider config={hosts}>
        <RpA2uiImage url={url} />
      </A2uiGuardProvider>
    );
    const { container, update } = mount(ui('https://cdn.example/a.png'));
    expect(container.querySelector('img')).not.toBeNull();
    update(ui('https://evil.example/late.png'));
    expect(container.querySelector('img')).toBeNull();
  });

  it('refuses a binding that resolved to something other than a URL', () => {
    const seen: A2uiDecision[] = [];
    const { container } = mount(<RpA2uiImage url={undefined} onDecisions={(d) => seen.push(...d)} />);
    expect(container.querySelector('img')).toBeNull();
    expect(seen.map((d) => d.code)).toEqual(['a2ui-not-a-url']);
  });

  it('takes only the catalog variants and fits', () => {
    const { container } = mount(<RpA2uiImage url="/a.png" variant={'rp-blocked-image' as never} fit={'url(x)' as never} />);
    const img = container.querySelector('img');
    expect(img?.className).toBe('a2ui-image mediumFeature');
    expect(img?.style.objectFit).toBe('fill');
  });

  it('allows same-origin and relative URLs with no configuration', () => {
    const { container } = mount(
      <>
        <RpA2uiImage url="/static/a.png" />
        <RpA2uiImage url="./b.png" />
      </>,
    );
    expect([...container.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['/static/a.png', './b.png']);
  });
});

describe('A2uiGuardProvider', () => {
  it('accepts a prebuilt guard and reports through its onDecision', () => {
    const seen: string[] = [];
    const guard = createA2uiGuard({ onDecision: (d) => seen.push(d.code) });
    let used: unknown;
    function Probe(): null {
      used = useA2uiGuard();
      return null;
    }
    mount(
      <A2uiGuardProvider guard={guard}>
        <Probe />
        <RpA2uiImage url="https://evil.example/p.png" />
      </A2uiGuardProvider>,
    );
    expect(used).toBe(guard);
    expect(seen).toEqual(['image-host-not-allowed']);
  });

  it('server rendering puts no Text content into the HTML: it is inserted by a layout effect', () => {
    const html = renderToString(<RpA2uiText text="<b>hi</b>" />);
    expect(html).toBe('<div class="a2ui-text body"></div>');
  });
});
