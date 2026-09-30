import type { TrustedHTML } from 'trusted-types/lib/index.js';
import { SINK_DENYLIST } from './data/sink-domains.js';
import type { RenderDecision } from './decisions.js';
import { patchChildren } from './dom.js';
import { messageOf } from './errors.js';
import { createMarkdownRenderer, type MarkdownRenderer } from './markdown.js';
import { resolvePolicy, type RenderMode, type RenderPolicy } from './policy.js';
import { createSanitizer } from './sanitize.js';
import type { SinkDenylist } from './sinks.js';
import { createRenderStream, type RenderStream, type StreamOptions } from './stream.js';
import { resolveWindow, type RenderWindow } from './window.js';

/** Where rendered content goes: an element, a shadow root or a fragment. Never a whole document. */
export type RenderTarget = Element | DocumentFragment;

export interface RenderResult {
  readonly decisions: readonly RenderDecision[];
}

/** What a render knows about itself. Transforms receive it, with the document added. */
export interface RenderContext {
  /** True while a stream renders, intermediate or final. Default false. */
  readonly streaming: boolean;
  /** True for a one-shot render or the final render of a stream. Default true. */
  readonly final: boolean;
  /** True when the source ended inside a code fence that the stream closed for display. Default false. */
  readonly openFenceAtEnd: boolean;
  /**
   * True when the fragment is a piece of a streamed document (a newly settled segment or the
   * unsettled tail), not the whole document. A transform that needs the whole document should
   * skip such renders. Default false.
   */
  readonly partial: boolean;
}

export interface RenderOptions extends Partial<RenderContext> {
  /**
   * Keep the leading child nodes of the target that are unchanged and replace only
   * from the first difference. Used by streams; a one-shot render replaces everything.
   */
  readonly patch?: boolean;
}

export interface TransformContext extends RenderContext {
  /** The document to create nodes in. The fragment itself may belong to the parser's document. */
  readonly document: Document;
}

/**
 * Post-processes a sanitized fragment before insertion: diagrams, syntax highlighting,
 * link decorations. A transform runs on already-sanitized content and is trusted code;
 * whatever it adds is inserted as is. A transform that throws is skipped and journaled;
 * the fragment is inserted without its work.
 */
export type FragmentTransform = (fragment: DocumentFragment, context: TransformContext) => void;

export interface FragmentResult extends RenderResult {
  readonly fragment: DocumentFragment;
}

export interface RendererOptions {
  /** The window to render with. Defaults to the global window; pass a JSDOM window in tests. */
  readonly window?: RenderWindow;
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
  sanitizeHtml(html: string, options?: RenderOptions): FragmentResult;
  /** Convert Markdown and sanitize into an inert fragment. */
  markdownToFragment(markdown: string, options?: RenderOptions): FragmentResult;
  /** Sanitize and insert with replaceChildren(). innerHTML is never used. */
  renderHtmlInto(target: RenderTarget, html: string, options?: RenderOptions): RenderResult;
  /** Convert Markdown, sanitize and insert with replaceChildren(). Falls back to plain text if the Markdown step throws. */
  renderMarkdownInto(target: RenderTarget, markdown: string, options?: RenderOptions): RenderResult;
  /** Insert plain text. Never interpreted as markup. */
  renderTextInto(target: RenderTarget, text: string): void;
  /** Escape hatch for string sinks you cannot remove: sanitized HTML as a TrustedHTML where the API exists, else a string. */
  trustedHTML(html: string): TrustedHTML | string;
  /** Same as trustedHTML, from Markdown. */
  markdownToTrustedHTML(markdown: string): TrustedHTML | string;
  /** Incremental rendering for streamed model output. */
  createStream(target: RenderTarget, options?: StreamOptions): RenderStream;
}

const MARKDOWN_FAILED: RenderDecision = Object.freeze({
  kind: 'blocked',
  subject: 'markdown',
  code: 'markdown-failed',
  reason: 'the Markdown renderer threw; the input was rendered as plain text',
});

export function createRenderer(options: RendererOptions = {}): Renderer {
  const win = resolveWindow(options.window);
  const policy = resolvePolicy(options.mode, options.policy);
  const sanitizer = createSanitizer(win, policy, options.sinkDenylist ?? SINK_DENYLIST);
  const markdown = options.markdown ?? createMarkdownRenderer();
  const onDecision = options.onDecision;
  const transforms = options.transforms ?? [];

  /** Run the transforms; a transform that throws is skipped and reported, the others still run. */
  const applyTransforms = (fragment: DocumentFragment, options?: RenderOptions): RenderDecision[] => {
    if (transforms.length === 0) return [];
    const context: TransformContext = {
      streaming: options?.streaming ?? false,
      final: options?.final ?? true,
      openFenceAtEnd: options?.openFenceAtEnd ?? false,
      partial: options?.partial ?? false,
      // The fragment belongs to the sanitizer's parser document; transforms create nodes in the live one.
      document: win.document,
    };
    const failures: RenderDecision[] = [];
    for (const transform of transforms) {
      try {
        transform(fragment, context);
      } catch (error) {
        failures.push({ kind: 'flagged', subject: 'transform', code: 'transform-failed', reason: `a transform threw and was skipped: ${messageOf(error)}` });
      }
    }
    return failures;
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

  const documentOf = (target: RenderTarget): Document => target.ownerDocument ?? win.document;

  const renderTextInto = (target: RenderTarget, text: string): void => {
    target.replaceChildren(documentOf(target).createTextNode(text));
  };

  const sanitizeHtml = (html: string, options?: RenderOptions): FragmentResult => {
    const { output, decisions: sanitized } = sanitizer.toFragment(html);
    const failures = applyTransforms(output, options);
    const decisions = failures.length === 0 ? sanitized : [...sanitized, ...failures];
    emit(decisions);
    return { fragment: output, decisions };
  };

  const markdownToFragment = (source: string, options?: RenderOptions): FragmentResult => {
    const converted = toHtml(source);
    if ('failed' in converted) {
      const fragment = win.document.createDocumentFragment();
      fragment.append(source);
      emit([MARKDOWN_FAILED]);
      return { fragment, decisions: [MARKDOWN_FAILED] };
    }
    return sanitizeHtml(converted.html, options);
  };

  const insert = (target: RenderTarget, fragment: DocumentFragment, options?: RenderOptions): void => {
    if (options?.patch) {
      patchChildren(target, fragment);
    } else {
      target.replaceChildren(fragment);
    }
  };

  const renderHtmlInto = (target: RenderTarget, html: string, options?: RenderOptions): RenderResult => {
    const { fragment, decisions } = sanitizeHtml(html, options);
    insert(target, fragment, options);
    return { decisions };
  };

  const renderMarkdownInto = (target: RenderTarget, source: string, options?: RenderOptions): RenderResult => {
    const converted = toHtml(source);
    if ('failed' in converted) {
      renderTextInto(target, source);
      emit([MARKDOWN_FAILED]);
      return { decisions: [MARKDOWN_FAILED] };
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
        emit([MARKDOWN_FAILED]);
        return trustedHTML(escapeText(source));
      }
      return trustedHTML(converted.html);
    },
    createStream(target, streamOptions = {}) {
      return createRenderStream(target, streamOptions, { markdown: renderMarkdownInto, html: renderHtmlInto, markdownFragment: markdownToFragment });
    },
  };
}

function escapeText(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
