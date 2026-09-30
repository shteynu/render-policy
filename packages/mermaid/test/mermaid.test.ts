import { createRenderer } from '@render-policy/core';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { createDiagramSanitizer, createMermaidTransform, type MermaidLike } from '../src/index.js';

const box = (): HTMLDivElement => document.createElement('div');
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type FakeMermaid = MermaidLike & {
  initialize: Mock<(config: Record<string, unknown>) => void>;
  render: Mock<(id: string, source: string) => Promise<{ readonly svg: string }>>;
};

function fakeMermaid(svgFor: (source: string) => string = () => '<svg xmlns="http://www.w3.org/2000/svg"><rect width="1" height="1"/></svg>'): FakeMermaid {
  return {
    initialize: vi.fn<(config: Record<string, unknown>) => void>(),
    render: vi.fn<(id: string, source: string) => Promise<{ readonly svg: string }>>(async (_id, source) => {
      if (source.includes('BROKEN')) throw new Error('Parse error on line 1');
      return { svg: svgFor(source) };
    }),
  };
}

const DIAGRAM = '```mermaid\ngraph TD\nA-->B\n```';

describe('createMermaidTransform', () => {
  it('replaces a mermaid code block with an isolated diagram and keeps the source as light DOM', async () => {
    const mermaid = fakeMermaid();
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid })] });
    const target = box();
    renderer.renderMarkdownInto(target, `before\n\n${DIAGRAM}\n\nafter`);
    const wrapper = target.querySelector('.rp-diagram');
    const host = wrapper?.querySelector('.rp-diagram-host');
    expect(wrapper?.getAttribute('style')).toContain('contain:paint');
    expect(host?.shadowRoot).not.toBeNull();
    expect(host?.querySelector('pre > code.language-mermaid')?.textContent).toBe('graph TD\nA-->B\n');
    expect(host?.shadowRoot?.querySelector('pre code')?.textContent).toBe('graph TD\nA-->B\n');
    await settle();
    expect(host?.shadowRoot?.querySelector('svg rect')).not.toBeNull();
    expect(host?.shadowRoot?.querySelector('pre')).toBeNull();
    expect(target.textContent).toContain('after');
  });

  it('forces the strict configuration over whatever the caller passes', () => {
    const mermaid = fakeMermaid();
    const renderer = createRenderer({
      transforms: [createMermaidTransform({ mermaid, config: { securityLevel: 'loose', theme: 'dark', flowchart: { htmlLabels: true, curve: 'basis' } } })],
    });
    renderer.renderMarkdownInto(box(), DIAGRAM);
    expect(mermaid.initialize).toHaveBeenCalledTimes(1);
    const config = mermaid.initialize.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(config.securityLevel).toBe('strict');
    expect(config.startOnLoad).toBe(false);
    expect(config.suppressErrorRendering).toBe(true);
    expect(config.theme).toBe('dark');
    expect(config.flowchart).toEqual({ htmlLabels: false });
  });

  it('leaves non-mermaid code blocks alone and honours custom languages', () => {
    const mermaid = fakeMermaid();
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid, languages: ['mermaid', 'diagram'] })] });
    const target = box();
    renderer.renderMarkdownInto(target, '```ts\nconst a = 1;\n```\n\n```diagram\ngraph TD\n```');
    expect(target.querySelector('pre > code.language-ts')).not.toBeNull();
    expect(target.querySelectorAll('.rp-diagram').length).toBe(1);
  });

  it('keeps a code block whose fence is still open while streaming, then renders it', async () => {
    const mermaid = fakeMermaid();
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid })] });
    const target = box();
    const stream = renderer.createStream(target);
    stream.push('Intro\n\n```mermaid\ngraph TD\nA-->B');
    expect(target.querySelector('.rp-diagram')).toBeNull();
    expect(target.querySelector('pre > code.language-mermaid')).not.toBeNull();
    expect(mermaid.render).not.toHaveBeenCalled();
    stream.push('\n```\n\nOutro');
    const host = target.querySelector('.rp-diagram-host');
    expect(host).not.toBeNull();
    stream.push(' continues');
    stream.end();
    expect(target.querySelector('.rp-diagram-host')).toBe(host);
    await settle();
    expect(host?.shadowRoot?.querySelector('svg')).not.toBeNull();
    expect(mermaid.render).toHaveBeenCalledTimes(1);
  });

  it('keeps a diagram as a code block when mermaid fails, and journals it', async () => {
    const decisions: string[] = [];
    const mermaid = fakeMermaid();
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid, onDecision: (d) => decisions.push(d.reason) })] });
    const target = box();
    renderer.renderMarkdownInto(target, '```mermaid\nBROKEN\n```');
    await settle();
    const host = target.querySelector('.rp-diagram-host');
    expect(host?.shadowRoot?.querySelector('svg')).toBeNull();
    expect(host?.shadowRoot?.querySelector('pre code')?.textContent).toBe('BROKEN\n');
    expect(decisions.some((r) => r.includes('Parse error'))).toBe(true);
  });

  it('caches renders by source', async () => {
    const mermaid = fakeMermaid();
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid })] });
    renderer.renderMarkdownInto(box(), DIAGRAM);
    renderer.renderMarkdownInto(box(), DIAGRAM);
    renderer.renderMarkdownInto(box(), '```mermaid\ngraph LR\nX-->Y\n```');
    await settle();
    expect(mermaid.render).toHaveBeenCalledTimes(2);
  });

  it('sanitizes what mermaid produced', async () => {
    const hostile =
      '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="position:fixed;inset:0" onload="alert(1)">' +
      '<style>.node { fill: #fff } @import url(https://evil.example/x.css);</style>' +
      '<script>alert(1)</script>' +
      '<a href="https://evil.example/"><rect width="1" height="1"/></a>' +
      '<foreignObject><div>html</div></foreignObject>' +
      '<image href="https://evil.example/i.png"/>' +
      '<use xlink:href="https://evil.example/s.svg#x"/>' +
      '<rect style="fill:url(https://evil.example/p.svg#g)" width="1" height="1"/>' +
      '<circle style="fill:#f00" r="1"/>' +
      '<path marker-end="url(#arrow)" d="M0 0"/>' +
      '</svg>';
    const mermaid = fakeMermaid(() => hostile);
    const decisions: string[] = [];
    const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid, onDecision: (d) => decisions.push(`${d.subject}:${d.tag ?? ''}:${d.attribute ?? ''}`) })] });
    const target = box();
    renderer.renderMarkdownInto(target, DIAGRAM);
    await settle();
    const shadow = target.querySelector('.rp-diagram-host')?.shadowRoot;
    if (!shadow) throw new Error('no shadow root');
    const svg = shadow.querySelector('svg');
    expect(svg?.getAttribute('style')).toBe('display:block;max-width:100%;height:auto');
    expect(svg?.hasAttribute('onload')).toBe(false);
    expect(shadow.querySelector('style, script, a, foreignObject, image, use')).toBeNull();
    expect(shadow.querySelector('rect')?.hasAttribute('style')).toBe(false);
    expect(shadow.querySelector('circle')?.getAttribute('style')).toBe('fill:#f00');
    expect(shadow.querySelector('path')?.getAttribute('marker-end')).toBe('url(#arrow)');
    expect(decisions).toContain('element:script:');
    expect(decisions).toContain('element:style:');
    expect(decisions).toContain('attribute:rect:style');
  });
});

describe('createDiagramSanitizer', () => {
  const sanitize = createDiagramSanitizer(window);

  it('keeps ordinary diagram markup', () => {
    const { fragment, decisions } = sanitize('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><defs><marker id="m"><path d="M0 0"/></marker></defs><g class="node"><rect width="1" height="1" fill="#fff"/><text x="1" y="1">A</text></g></svg>');
    expect(fragment.querySelector('svg')?.getAttribute('viewBox')).toBe('0 0 10 10');
    expect(fragment.querySelector('marker path')).not.toBeNull();
    expect(fragment.querySelector('text')?.textContent).toBe('A');
    expect(decisions).toEqual([]);
  });

  it('drops a stylesheet that positions or escapes', () => {
    const { fragment } = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><style>:host { display: none }</style><rect/></svg>');
    expect(fragment.querySelector('style')).toBeNull();
    const kept = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><style>.edge { stroke: url(#grad) } .mermaidTooltip { position: absolute }</style><rect/></svg>');
    expect(kept.fragment.querySelector('style')?.textContent).toContain('url(#grad)');
    const imported = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><style>@import url(https://evil.example/x.css);</style><rect/></svg>');
    expect(imported.fragment.querySelector('style')).toBeNull();
  });

  it('reports the removals of each call, not a suffix of the previous one', () => {
    const noisy = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script><a href="x"/><image href="y"/><use href="z"/><rect onload="1" onclick="2" data-a="1"/></svg>');
    expect(noisy.decisions.length).toBeGreaterThan(3);
    const quiet = sanitize('<svg xmlns="http://www.w3.org/2000/svg"><script>1</script><rect/></svg>');
    expect(quiet.decisions.map((d) => d.tag)).toEqual(['script']);
  });

  it('allows only an svg root', () => {
    const { fragment } = sanitize('<div>x</div><svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(fragment.children.length).toBe(1);
    expect(fragment.firstElementChild?.nodeName.toLowerCase()).toBe('svg');
  });
});
