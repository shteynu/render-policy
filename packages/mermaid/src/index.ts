import createDOMPurify, { type Config } from 'dompurify';
import { resolveWindow, type FragmentTransform, type RenderDecision, type RenderWindow } from '@render-policy/core';

/** The part of the mermaid API this package uses. Pass the real `mermaid` default export. */
export interface MermaidLike {
  initialize(config: Record<string, unknown>): void;
  render(id: string, text: string): Promise<{ readonly svg: string }>;
}

export interface MermaidTransformOptions {
  /** The mermaid module (`import mermaid from 'mermaid'`). Loaded lazily by you, not by this package. */
  readonly mermaid: MermaidLike;
  /** The window to sanitize with. Defaults to the global window. */
  readonly window?: RenderWindow;
  /** Extra mermaid configuration (theme, fonts). The strict settings below always win. */
  readonly config?: Record<string, unknown>;
  /** Code block languages rendered as diagrams. Default ['mermaid']. */
  readonly languages?: readonly string[];
  /** Receives a decision for every diagram that failed to render or lost content to sanitization. */
  readonly onDecision?: (decision: RenderDecision) => void;
  /** Upper bound of the source -> SVG cache; the least recently used diagram goes first. Default 50, 0 turns caching off. */
  readonly cacheSize?: number;
}

/**
 * Settings the diagram source cannot change: no HTML labels (so no foreignObject), no click
 * handlers or links, no error diagram injected into the page, nothing rendered on load.
 */
export const STRICT_MERMAID_CONFIG: Readonly<Record<string, unknown>> = Object.freeze({
  startOnLoad: false,
  securityLevel: 'strict',
  htmlLabels: false,
  flowchart: Object.freeze({ htmlLabels: false }),
  class: Object.freeze({ htmlLabels: false }),
  state: Object.freeze({ htmlLabels: false }),
  er: Object.freeze({ htmlLabels: false }),
  suppressErrorRendering: true,
});

/** Class names of the wrapper and the shadow host, for styling. */
export const DIAGRAM_CLASS = 'rp-diagram';
export const DIAGRAM_HOST_CLASS = 'rp-diagram-host';

const SVG_CONFIG: Config = {
  USE_PROFILES: { svg: true, svgFilters: true },
  ADD_TAGS: ['style'],
  ADD_ATTR: ['role'], // accessibility: mermaid marks the root as a graphics document
  // Links, embedded documents, external references and animations have no place in a diagram
  // produced from untrusted text.
  FORBID_TAGS: ['foreignObject', 'script', 'a', 'image', 'use', 'set', 'animate', 'animateMotion', 'animateTransform', 'feImage'],
  FORBID_ATTR: ['href', 'xlink:href', 'ping', 'formaction'],
  ALLOW_DATA_ATTR: false,
  ALLOW_UNKNOWN_PROTOCOLS: false,
  KEEP_CONTENT: false,
  RETURN_DOM_FRAGMENT: true,
};

/** `url(#marker)` is a reference into the SVG itself; anything else in CSS is a fetch. */
const EXTERNAL_URL_RE = /url\((?!\s*['"]?#)/i;
/**
 * CSS that could reach outside the diagram: imports and legacy script hooks, and `:host`,
 * the one selector a shadow tree can aim at its host. Positioning is not on the list: SVG
 * graphics ignore it, the root <svg> gets a fixed style below, and the wrapper's
 * `contain: paint` confines whatever is left.
 */
const DANGEROUS_CSS_RE = /@import|expression\(|:host|behavior\s*:|-moz-binding/i;
const ROOT_SVG_STYLE = 'display:block;max-width:100%;height:auto';

export interface DiagramSanitizeResult {
  readonly fragment: DocumentFragment;
  readonly decisions: readonly RenderDecision[];
}

/**
 * Sanitize an SVG string produced by mermaid into a fragment that can only draw.
 * Exported for tests and for hosts that render diagrams themselves.
 */
export function createDiagramSanitizer(win: RenderWindow): (svg: string) => DiagramSanitizeResult {
  const purify = createDOMPurify(win);
  return (svg) => {
    const decisions: RenderDecision[] = [];
    const fragment = purify.sanitize(svg, { ...SVG_CONFIG, RETURN_DOM_FRAGMENT: true });
    // DOMPurify resets `removed` on every sanitize() call, so this is exactly this call's list.
    for (const removed of purify.removed) {
      if ('element' in removed && removed.element) {
        const tag = (removed.element.nodeName ?? '').toLowerCase();
        if (tag === 'body' || tag === 'html' || tag === 'head') continue; // parser scaffolding, not content
        decisions.push({ kind: 'blocked', subject: 'element', code: 'diagram-element-not-allowed', reason: 'element is not allowed in a diagram', tag });
      } else if ('attribute' in removed && removed.attribute) {
        decisions.push({ kind: 'blocked', subject: 'attribute', code: 'diagram-attribute-not-allowed', reason: 'attribute is not allowed in a diagram', tag: (removed.from?.nodeName ?? '').toLowerCase(), attribute: removed.attribute.name, value: removed.attribute.value });
      }
    }

    for (const style of Array.from(fragment.querySelectorAll('style'))) {
      const css = style.textContent ?? '';
      if (EXTERNAL_URL_RE.test(css) || DANGEROUS_CSS_RE.test(css)) {
        style.remove();
        decisions.push({ kind: 'blocked', subject: 'element', code: 'diagram-style-escapes', reason: 'diagram stylesheet references external resources or escapes the diagram', tag: 'style' });
      }
    }
    for (const element of Array.from(fragment.querySelectorAll('[style]'))) {
      const css = element.getAttribute('style') ?? '';
      if (EXTERNAL_URL_RE.test(css) || DANGEROUS_CSS_RE.test(css)) {
        element.removeAttribute('style');
        decisions.push({ kind: 'blocked', subject: 'attribute', code: 'diagram-style-escapes', reason: 'inline style references external resources or escapes the diagram', tag: element.nodeName.toLowerCase(), attribute: 'style', value: css });
      }
    }
    for (const root of Array.from(fragment.children)) {
      if (root.nodeName.toLowerCase() === 'svg') {
        root.setAttribute('style', ROOT_SVG_STYLE);
      } else {
        root.remove();
        decisions.push({ kind: 'blocked', subject: 'element', code: 'diagram-root-not-svg', reason: 'only an <svg> root is allowed in a diagram', tag: root.nodeName.toLowerCase() });
      }
    }
    return { fragment, decisions };
  };
}

/** A bounded map that forgets the entry used least recently. A size of 0 or less stores nothing. */
function createLruCache<K, V>(size: number): { get(key: K): V | undefined; set(key: K, value: V): void } {
  const entries = new Map<K, V>();
  return {
    get(key) {
      const value = entries.get(key);
      if (value !== undefined) {
        // Map keeps insertion order: re-inserting marks the entry as the most recent.
        entries.delete(key);
        entries.set(key, value);
      }
      return value;
    },
    set(key, value) {
      if (size <= 0) return;
      entries.delete(key);
      if (entries.size >= size) {
        const oldest = entries.keys().next().value;
        if (oldest !== undefined) entries.delete(oldest);
      }
      entries.set(key, value);
    },
  };
}

/** mermaid puts a temporary element with the render id into the document, so ids are unique per page, not per transform. */
let renderCounter = 0;

/**
 * Diagram source -> sanitized SVG, cached by source. Initializes mermaid with the strict settings
 * on first use and reports each render's decisions once, when the source is first rendered.
 * Resolves to null when mermaid cannot render the source.
 */
function createDiagramRenderer(options: MermaidTransformOptions, win: RenderWindow): (source: string) => Promise<DiagramSanitizeResult | null> {
  const sanitize = createDiagramSanitizer(win);
  const cache = createLruCache<string, Promise<DiagramSanitizeResult | null>>(options.cacheSize ?? 50);
  let initialized = false;

  const emit = (decisions: readonly RenderDecision[]): void => {
    if (!options.onDecision) return;
    for (const decision of decisions) options.onDecision(decision);
  };

  const render = async (source: string): Promise<DiagramSanitizeResult | null> => {
    if (!initialized) {
      options.mermaid.initialize({ ...(options.config ?? {}), ...STRICT_MERMAID_CONFIG });
      initialized = true;
    }
    renderCounter += 1;
    let svg: string;
    try {
      svg = (await options.mermaid.render(`rp-mermaid-${renderCounter}`, source)).svg;
    } catch (error) {
      emit([{ kind: 'blocked', subject: 'markdown', code: 'diagram-render-failed', reason: `Mermaid could not render the diagram: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}` }]);
      return null;
    }
    const result = sanitize(svg);
    emit(result.decisions);
    return result;
  };

  return (source) => {
    const cached = cache.get(source);
    if (cached) return cached;
    const promise = render(source);
    cache.set(source, promise);
    return promise;
  };
}

/**
 * A fragment transform for createRenderer({ transforms }) that turns
 * ```mermaid code blocks into diagrams:
 *
 * - mermaid runs in `securityLevel: 'strict'` without HTML labels, whatever `config` says;
 * - the SVG goes through an SVG-only sanitizer: no links, scripts, foreignObject, images,
 *   external references or animations, no stylesheet that imports, fetches or escapes;
 * - the result lives in a shadow root inside a `contain: paint` wrapper, so the diagram's
 *   own styles cannot reach the host page and the host page's styles do not break the diagram;
 * - the wrapper keeps the original code block as light DOM: streaming keeps a finished diagram
 *   in place, and a block whose fence is still open is left as code until it closes;
 * - a diagram that fails to parse stays a code block; nothing is injected into <body>.
 */
export function createMermaidTransform(options: MermaidTransformOptions): FragmentTransform {
  const win = resolveWindow(options.window, '@render-policy/mermaid');
  const renderDiagram = createDiagramRenderer(options, win);
  const languages = new Set(options.languages ?? ['mermaid']);

  return (fragment, context) => {
    const blocks = Array.from(fragment.querySelectorAll('pre > code')).filter((code) => languages.has(languageOf(code)));
    if (blocks.length === 0) return;
    const allPre = fragment.querySelectorAll('pre');
    const lastPre = allPre[allPre.length - 1] ?? null;

    for (const code of blocks) {
      const pre = code.parentElement;
      if (!pre) continue;
      if (context.openFenceAtEnd && pre === lastPre) continue; // still being typed

      const source = code.textContent ?? '';
      const shadow = mountDiagram(context.document, pre, source);
      void renderDiagram(source).then((result) => {
        if (!result) return;
        shadow.replaceChildren(result.fragment.cloneNode(true));
      });
    }
  };
}

/**
 * Replace a code block with the diagram wrapper and return the shadow root the diagram goes into.
 * Until the diagram arrives (or if it never does) the shadow root shows the source as code.
 */
function mountDiagram(doc: Document, pre: Element, source: string): ShadowRoot {
  const wrapper = doc.createElement('div');
  wrapper.className = DIAGRAM_CLASS;
  wrapper.setAttribute('style', 'display:block;contain:paint');
  const host = doc.createElement('div');
  host.className = DIAGRAM_HOST_CLASS;
  pre.replaceWith(wrapper);
  wrapper.append(host);
  host.append(pre); // light DOM: the source, hidden by the shadow root, compared by patchChildren
  const shadow = host.attachShadow({ mode: 'open' });
  shadow.append(fallback(doc, source));
  return shadow;
}

function languageOf(code: Element): string {
  for (const token of (code.getAttribute('class') ?? '').split(/\s+/)) {
    if (token.startsWith('language-')) return token.slice('language-'.length);
  }
  return '';
}

function fallback(doc: Document, source: string): Element {
  const pre = doc.createElement('pre');
  const code = doc.createElement('code');
  code.textContent = source;
  pre.append(code);
  return pre;
}
