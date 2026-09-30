import type { WindowLike } from 'dompurify';
import type { TrustedHTML } from 'trusted-types/lib/index.js';
import { SINK_DENYLIST } from './data/sink-domains.js';
import type { RenderDecision } from './decisions.js';
import { patchChildren } from './dom.js';
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown.js';
import { resolvePolicy, type RenderMode, type RenderPolicy } from './policy.js';
import { createSanitizer } from './sanitize.js';
import type { SinkDenylist } from './sinks.js';
import { createRenderStream, type RenderStream, type StreamOptions } from './stream.js';

/** Anything with replaceChildren(): an element, a shadow root, a fragment. */
export type RenderTarget = ParentNode;

export interface RenderResult {
  readonly decisions: readonly RenderDecision[];
}

export interface InsertOptions {
  /**
   * Keep the leading child nodes of the target that are unchanged and replace only
   * from the first difference. Used by streams; a one-shot render replaces everything.
   */
  readonly patch?: boolean;
  /** True while a stream renders an intermediate state. Default false. */
  readonly streaming?: boolean;
  /** True for a one-shot render or the final render of a stream. Default true. */
  readonly final?: boolean;
  /** True when the source ended inside a code fence that the stream closed for display. Default false. */
  readonly openFenceAtEnd?: boolean;
}

/** What a transform knows about the render it is post-processing. */
export interface TransformContext {
  readonly streaming: boolean;
  readonly final: boolean;
  readonly openFenceAtEnd: boolean;
  readonly document: Document;
}

/**
 * Post-processes a sanitized fragment before insertion: diagrams, syntax highlighting,
 * link decorations. A transform runs on already-sanitized content and is trusted code;
 * whatever it adds is inserted as is.
 */
export type FragmentTransform = (fragment: DocumentFragment, context: TransformContext) => void;

export interface FragmentResult extends RenderResult {
  readonly fragment: DocumentFragment;
}

export interface RendererOptions {
  /** The window to sanitize with. Defaults to the global window; pass a JSDOM window in tests. */
  readonly window?: WindowLike;
  /** Policy preset. Default 'balanced'. */
  readonly mode?: RenderMode;
  /** Overrides applied on top of the preset. */
  readonly policy?: Partial<RenderPolicy>;
  /** Replace the bundled sink denylist. */
  readonly sinkDenylist?: SinkDenylist;
  /** Replace the Markdown renderer. Its output is sanitized regardless. */
  readonly markdown?: MarkdownRenderer;
  /** Receive every policy decision as it is made. */
  readonly onDecision?: (decision: RenderDecision) => void;
  /** Post-processors applied to every sanitized fragment before insertion, in order. */
  readonly transforms?: readonly FragmentTransform[];
}

export interface Renderer {
  readonly policy: RenderPolicy;
  /** Sanitize HTML into an inert fragment without touching any live DOM. */
  sanitizeHtml(html: string, options?: InsertOptions): FragmentResult;
  /** Convert Markdown and sanitize into an inert fragment. */
  markdownToFragment(markdown: string, options?: InsertOptions): FragmentResult;
  /** Sanitize and insert with replaceChildren(). innerHTML is never used. */
  renderHtmlInto(target: RenderTarget, html: string, options?: InsertOptions): RenderResult;
  /** Convert Markdown, sanitize and insert with replaceChildren(). Falls back to plain text if the Markdown step throws. */
  renderMarkdownInto(target: RenderTarget, markdown: string, options?: InsertOptions): RenderResult;
  /** Insert plain text. Never interpreted as markup. */
  renderTextInto(target: RenderTarget, text: string): void;
  /** Escape hatch for string sinks you cannot remove: sanitized HTML as a TrustedHTML where the API exists, else a string. */
  trustedHTML(html: string): TrustedHTML | string;
  /** Same as trustedHTML, from Markdown. */
  markdownToTrustedHTML(markdown: string): TrustedHTML | string;
  /** Incremental rendering for streamed model output. */
  createStream(target: RenderTarget, options?: StreamOptions): RenderStream;
}

export function createRenderer(options: RendererOptions = {}): Renderer {
  const win = options.window ?? defaultWindow();
  const policy = resolvePolicy(options.mode, options.policy);
  const sanitizer = createSanitizer(win, policy, options.sinkDenylist ?? SINK_DENYLIST);
  const markdown = options.markdown ?? createMarkdownRenderer();
  const onDecision = options.onDecision;
  const transforms = options.transforms ?? [];

  const applyTransforms = (fragment: DocumentFragment, insert?: InsertOptions): void => {
    if (transforms.length === 0) return;
    const context: TransformContext = {
      streaming: insert?.streaming ?? false,
      final: insert?.final ?? true,
      openFenceAtEnd: insert?.openFenceAtEnd ?? false,
      // The fragment belongs to the sanitizer's parser document; transforms create nodes in the live one.
      document: win.document ?? fragment.ownerDocument,
    };
    for (const transform of transforms) transform(fragment, context);
  };

  const emit = (decisions: readonly RenderDecision[]): void => {
    if (!onDecision) return;
    for (const decision of decisions) onDecision(decision);
  };

  const toHtml = (source: string): { html: string } | { failed: true } => {
    try {
      return { html: markdown(source) };
    } catch {
      return { failed: true };
    }
  };

  const markdownFailed: RenderDecision = Object.freeze({
    kind: 'blocked',
    subject: 'markdown',
    reason: 'the Markdown renderer threw; the input was rendered as plain text',
  });

  const documentOf = (target: RenderTarget): Document => {
    const doc = (target as Node).ownerDocument ?? win.document;
    if (!doc) throw new Error('@render-policy/core: render target has no document');
    return doc;
  };

  const renderTextInto = (target: RenderTarget, text: string): void => {
    target.replaceChildren(documentOf(target).createTextNode(text));
  };

  const sanitizeHtml = (html: string, insert?: InsertOptions): FragmentResult => {
    const { output, decisions } = sanitizer.toFragment(html);
    applyTransforms(output, insert);
    emit(decisions);
    return { fragment: output, decisions };
  };

  const markdownToFragment = (source: string, insert?: InsertOptions): FragmentResult => {
    const converted = toHtml(source);
    if ('failed' in converted) {
      const fragment = (win.document ?? globalThis.document).createDocumentFragment();
      fragment.append(source);
      emit([markdownFailed]);
      return { fragment, decisions: [markdownFailed] };
    }
    return sanitizeHtml(converted.html, insert);
  };

  const insert = (target: RenderTarget, fragment: DocumentFragment, options?: InsertOptions): void => {
    if (options?.patch) {
      patchChildren(target, fragment);
    } else {
      target.replaceChildren(fragment);
    }
  };

  const renderHtmlInto = (target: RenderTarget, html: string, options?: InsertOptions): RenderResult => {
    const { fragment, decisions } = sanitizeHtml(html, options);
    insert(target, fragment, options);
    return { decisions };
  };

  const renderMarkdownInto = (target: RenderTarget, source: string, options?: InsertOptions): RenderResult => {
    const converted = toHtml(source);
    if ('failed' in converted) {
      renderTextInto(target, source);
      emit([markdownFailed]);
      return { decisions: [markdownFailed] };
    }
    return renderHtmlInto(target, converted.html, options);
  };

  const trustedHTML = (html: string): TrustedHTML | string => {
    const { output, decisions } = sanitizer.toTrustedHTML(html);
    emit(decisions);
    return output;
  };

  return {
    policy,
    sanitizeHtml,
    markdownToFragment,
    renderHtmlInto,
    renderMarkdownInto,
    renderTextInto,
    trustedHTML,
    markdownToTrustedHTML(source) {
      const converted = toHtml(source);
      if ('failed' in converted) {
        emit([markdownFailed]);
        return trustedHTML(escapeText(source));
      }
      return trustedHTML(converted.html);
    },
    createStream(target, streamOptions = {}) {
      return createRenderStream(target, streamOptions, { markdown: renderMarkdownInto, html: renderHtmlInto });
    },
  };
}

function defaultWindow(): WindowLike {
  if (typeof window !== 'undefined') return window as unknown as WindowLike;
  throw new Error('@render-policy/core: no global window. Pass { window } (for example a JSDOM window) outside a browser.');
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
