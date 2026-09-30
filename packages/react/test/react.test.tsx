import { createRenderer, type Renderer } from '@render-policy/core';
import { act, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderPolicyProvider, RpHtml, RpMarkdown, useRenderPolicy, useRenderer } from '../src/index.js';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const sync = (render: () => void): void => render();
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

describe('RpMarkdown', () => {
  it('renders Markdown through the policy', () => {
    const { container } = mount(<RpMarkdown content={'# Hi\n\n<img src="/a.png" onerror="alert(1)">'} />);
    expect(container.querySelector('h1')?.textContent).toBe('Hi');
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/a.png');
    expect(img?.hasAttribute('onerror')).toBe(false);
  });

  it('re-renders when the content changes', () => {
    const { container, update } = mount(<RpMarkdown content="one" />);
    update(<RpMarkdown content="**two**" />);
    expect(container.querySelector('strong')?.textContent).toBe('two');
    expect(container.textContent?.trim()).toBe('two');
  });

  it('never assigns innerHTML', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!descriptor?.set) throw new Error('jsdom innerHTML accessor missing');
    const setter = vi.fn(descriptor.set);
    Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor, set: setter });
    try {
      const { container, update } = mount(<RpMarkdown content="# a" />);
      update(<RpMarkdown content="# b" />);
      expect(container.querySelector('h1')?.textContent).toBe('b');
      expect(setter).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
    }
  });

  it('applies the provider config', () => {
    const { container } = mount(
      <RenderPolicyProvider config={{ mode: 'strict' }}>
        <RpMarkdown content="![x](https://cdn.example/a.png)" />
      </RenderPolicyProvider>,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('a.rp-blocked-image')?.getAttribute('href')).toBe('https://cdn.example/a.png');
  });

  it('accepts a prebuilt renderer', () => {
    const renderer = createRenderer({ mode: 'permissive' });
    const { container } = mount(
      <RenderPolicyProvider renderer={renderer}>
        <RpMarkdown content="![x](https://cdn.example/a.png?q=1)" />
      </RenderPolicyProvider>,
    );
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png?q=1');
  });

  it('streams: withholds an incomplete image, renders it once complete, keeps settled nodes', () => {
    const config = { policy: { images: { hosts: ['cdn.example'] } } };
    const ui = (content: string, streaming: boolean): ReactElement => (
      <RenderPolicyProvider config={config}>
        <RpMarkdown content={content} streaming={streaming} scheduler={sync} />
      </RenderPolicyProvider>
    );
    const { container, update } = mount(ui('# Chart\n\n![x](https://cdn.example/a', true));
    const heading = container.querySelector('h1');
    expect(container.querySelector('img')).toBeNull();
    update(ui('# Chart\n\n![x](https://cdn.example/a.png) done', true));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(container.querySelector('h1')).toBe(heading);
    update(ui('# Chart\n\n![x](https://cdn.example/a.png) done', false));
    expect(container.querySelector('img')?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(container.textContent).toContain('done');
    expect(container.querySelector('h1')).toBe(heading);
  });

  it('renders into the requested element with the remaining props', () => {
    const { container } = mount(<RpMarkdown as="section" className="message" data-testid="m" content="x" />);
    const section = container.querySelector('section.message');
    expect(section?.getAttribute('data-testid')).toBe('m');
    expect(section?.querySelector('p')?.textContent).toBe('x');
  });

  it('reports decisions', () => {
    const seen: string[] = [];
    const onDecisions = (decisions: readonly { attribute?: string }[]): void => {
      seen.push(...decisions.map((d) => d.attribute ?? ''));
    };
    mount(<RpMarkdown content={'<img src="/a.png" onerror="alert(1)">'} onDecisions={onDecisions} />);
    expect(seen).toContain('onerror');
  });

  it('renders an empty container on the server', () => {
    expect(renderToString(<RpMarkdown content="# x" className="m" />)).toBe('<div class="m"></div>');
    expect(renderToString(<RpHtml html="<b>x</b>" as="span" />)).toBe('<span></span>');
  });
});

describe('RpHtml', () => {
  it('renders HTML through the policy', () => {
    const { container } = mount(<RpHtml html={'<b>x</b><script>alert(1)</script><a href="javascript:1">l</a>'} />);
    expect(container.querySelector('b')?.textContent).toBe('x');
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('a')?.hasAttribute('href')).toBe(false);
  });
});

describe('hooks', () => {
  it('useRenderer falls back to a default balanced renderer', () => {
    let captured: Renderer | null = null;
    function Probe(): null {
      captured = useRenderer();
      return null;
    }
    mount(<Probe />);
    expect(captured).not.toBeNull();
    expect((captured as unknown as Renderer).policy.mode).toBe('balanced');
  });

  it('useRenderPolicy renders into a custom element', () => {
    function Custom({ text }: { text: string }): ReactElement {
      const ref = useRenderPolicy<HTMLTableCellElement>(text, { mode: 'markdown' });
      return (
        <table>
          <tbody>
            <tr>
              <td ref={ref} />
            </tr>
          </tbody>
        </table>
      );
    }
    const { container } = mount(<Custom text="**cell**" />);
    expect(container.querySelector('td strong')?.textContent).toBe('cell');
  });
});
