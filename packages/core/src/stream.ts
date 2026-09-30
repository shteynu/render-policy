import { patchChildren } from './dom.js';
import type { FragmentResult, RenderOptions, RenderResult, RenderTarget } from './render.js';
import { scanSettled } from './settle.js';

export type Scheduler = (render: () => void) => void;

export interface StreamOptions {
  /** Treat pushed chunks as Markdown (default) or HTML. */
  readonly mode?: 'markdown' | 'html';
  /** Coalesce renders, for example one per animation frame. Default: render synchronously on every push. */
  readonly schedule?: Scheduler;
  /** Withhold a link, image or tag whose URL has not been closed yet. Default true. */
  readonly holdIncompleteUrls?: boolean;
  /** Close an unfinished ``` fence so a streaming code block renders as code, not as Markdown. Default true. */
  readonly closeFences?: boolean;
  /** Keep unchanged leading blocks in place and replace only from the first change. Default true. */
  readonly patch?: boolean;
  /**
   * Markdown only: re-parse and re-sanitize only the unsettled tail of the buffer; blocks
   * before the last safe cut keep their nodes and are never parsed again. Off: every render
   * re-parses the whole buffer (the v1 behaviour, kept as the reference). Default true;
   * requires `patch`.
   */
  readonly incremental?: boolean;
}

export interface RenderStream {
  /** Append a chunk and (re)render. */
  push(chunk: string): void;
  /** Replace the whole text and (re)render; for frameworks that hold the growing string. */
  set(text: string): void;
  /** Final render: nothing is withheld any more because nothing more is coming. Returns its decisions. */
  end(): RenderResult;
  /** Clear the buffer and the target. */
  reset(): void;
  readonly text: string;
  readonly ended: boolean;
}

export interface StreamRenderOps {
  markdown(target: RenderTarget, markdown: string, options: RenderOptions): RenderResult;
  html(target: RenderTarget, html: string, options: RenderOptions): RenderResult;
  /** Markdown to a sanitized fragment without touching the target; the incremental path composes these. */
  markdownFragment(markdown: string, options: RenderOptions): FragmentResult;
}

export function createRenderStream(target: RenderTarget, options: StreamOptions, ops: StreamRenderOps): RenderStream {
  const mode = options.mode ?? 'markdown';
  const schedule: Scheduler = options.schedule ?? ((render) => render());
  const hold = options.holdIncompleteUrls ?? true;
  const closeFences = options.closeFences ?? true;
  const patch = options.patch ?? true;
  const incremental = mode === 'markdown' && patch && (options.incremental ?? true);
  let text = '';
  let ended = false;

  // Incremental state: the settled prefix of the (held, fence-closed) source, how many of the
  // target's leading child nodes it produced, and the definitions it was rendered with.
  let settledText = '';
  let settledCount = 0;
  let settledDefinitions = '';

  const forget = (): void => {
    settledText = '';
    settledCount = 0;
    settledDefinitions = '';
  };

  const renderIncremental = (source: string, final: boolean, openFenceAtEnd: boolean): RenderResult => {
    if (!source.startsWith(settledText) || target.childNodes.length < settledCount) forget();
    let scan = scanSettled(source, settledText.length);
    const definitions = scan.definitions.join('\n');
    if (definitions !== settledDefinitions) {
      // A definition appeared or changed: it can alter links anywhere, so settle from scratch.
      forget();
      settledDefinitions = definitions;
      scan = scanSettled(source, 0);
    }
    // Definitions go in front of every piece: appended ones could be swallowed by an unclosed
    // construct at the end of the buffer; in front, after a blank line, they change nothing.
    const prefix = definitions === '' ? '' : `${definitions}\n\n`;
    const decisions: RenderResult['decisions'][number][] = [];
    let combined: DocumentFragment | null = null;
    let newlySettled = 0;

    if (scan.boundary > settledText.length) {
      const segment = ops.markdownFragment(prefix + source.slice(settledText.length, scan.boundary), { streaming: true, final, openFenceAtEnd: false, partial: true });
      newlySettled = segment.fragment.childNodes.length;
      decisions.push(...segment.decisions);
      combined = segment.fragment;
    }
    const tail = ops.markdownFragment(prefix + source.slice(scan.boundary), { streaming: true, final, openFenceAtEnd, partial: true });
    decisions.push(...tail.decisions);
    if (combined) combined.append(...Array.from(tail.fragment.childNodes));
    else combined = tail.fragment;

    patchChildren(target, combined, { from: settledCount });
    settledText = source.slice(0, scan.boundary);
    settledCount += newlySettled;
    return { decisions };
  };

  const render = (final: boolean): RenderResult => {
    let source = text;
    if (mode === 'markdown') {
      if (!final && hold) source = holdIncompleteMarkdown(source);
      let openFenceAtEnd = false;
      if (closeFences) {
        const completed = completeFences(source);
        source = completed.text;
        openFenceAtEnd = completed.closed;
      }
      if (incremental) return renderIncremental(source, final, openFenceAtEnd);
      return ops.markdown(target, source, { patch, streaming: true, final, openFenceAtEnd });
    }
    if (!final && hold) source = holdIncompleteHtml(source);
    return ops.html(target, source, { patch, streaming: true, final, openFenceAtEnd: false });
  };

  return {
    push(chunk) {
      if (ended) throw new Error('@render-policy/core: push() after end()');
      text += chunk;
      schedule(() => {
        if (!ended) render(false);
      });
    },
    set(next) {
      if (ended) throw new Error('@render-policy/core: set() after end()');
      text = next;
      schedule(() => {
        if (!ended) render(false);
      });
    },
    end() {
      if (ended) return { decisions: [] };
      ended = true;
      return render(true);
    },
    reset() {
      text = '';
      ended = false;
      forget();
      target.replaceChildren();
    },
    get text() {
      return text;
    },
    get ended() {
      return ended;
    },
  };
}

/**
 * The scheduler an adapter should use unless told otherwise: one render per animation
 * frame where the window has requestAnimationFrame, synchronous rendering elsewhere.
 */
export function defaultScheduler(win: { requestAnimationFrame?: (callback: () => void) => number } | null | undefined = globalWindow()): Scheduler {
  if (win && typeof win.requestAnimationFrame === 'function') return frameScheduler(win as { requestAnimationFrame(callback: () => void): number });
  return (render) => render();
}

function globalWindow(): { requestAnimationFrame?: (callback: () => void) => number } | undefined {
  return typeof window === 'undefined' ? undefined : window;
}

/** Coalesce renders to one per animation frame. */
export function frameScheduler(win: { requestAnimationFrame(callback: () => void): number }): Scheduler {
  let pending = false;
  let latest: (() => void) | null = null;
  return (render) => {
    latest = render;
    if (pending) return;
    pending = true;
    win.requestAnimationFrame(() => {
      pending = false;
      const run = latest;
      latest = null;
      run?.();
    });
  };
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/** Append the closing fence of an unfinished ``` or ~~~ block, and say whether one had to be closed. */
export function completeFences(markdown: string): { readonly text: string; readonly closed: boolean } {
  let open: { char: string; length: number } | null = null;
  for (const line of markdown.split('\n')) {
    const match = FENCE_RE.exec(line);
    if (!match) continue;
    const fence = match[1] ?? '';
    const rest = match[2] ?? '';
    const char = fence[0] ?? '`';
    if (open === null) {
      // A backtick fence's info string may not contain backticks.
      if (char === '`' && rest.includes('`')) continue;
      open = { char, length: fence.length };
    } else if (char === open.char && fence.length >= open.length && rest.trim() === '') {
      open = null;
    }
  }
  if (open === null) return { text: markdown, closed: false };
  const newline = markdown.endsWith('\n') ? '' : '\n';
  return { text: `${markdown}${newline}${open.char.repeat(open.length)}`, closed: true };
}

// A bare URL still being received. A URL preceded by `(` or `<` belongs to a link or autolink handled above.
const BARE_URL_TAIL_RE = /(?:^|\s)((?:https?:\/\/|www\.)\S*)$/i;
const REFERENCE_DEFINITION_TAIL_RE = /^ {0,3}\[[^\]]*\]:\s*\S*$/;

/**
 * Cut the buffer before any link, image, autolink, reference definition or
 * raw tag whose URL has not been closed yet. A half-received URL is never
 * turned into a request; the construct appears once it is complete and
 * has passed the policy.
 */
export function holdIncompleteMarkdown(markdown: string): string {
  let cut = markdown.length;

  const lastDestination = markdown.lastIndexOf('](');
  if (lastDestination !== -1 && !hasClosingParen(markdown, lastDestination + 2)) {
    const bracket = markdown.lastIndexOf('[', lastDestination);
    let start = bracket === -1 ? lastDestination : bracket;
    if (start > 0 && markdown[start - 1] === '!') start -= 1;
    cut = Math.min(cut, start);
  }

  cut = Math.min(cut, incompleteTagStart(markdown));

  const bare = BARE_URL_TAIL_RE.exec(markdown);
  if (bare) {
    cut = Math.min(cut, bare.index + bare[0].length - (bare[1] ?? '').length);
  }

  const lastLineStart = markdown.lastIndexOf('\n') + 1;
  if (REFERENCE_DEFINITION_TAIL_RE.test(markdown.slice(lastLineStart))) {
    cut = Math.min(cut, lastLineStart);
  }

  return markdown.slice(0, cut);
}

/** Cut the buffer before a raw tag that has not been closed with `>`. */
export function holdIncompleteHtml(html: string): string {
  return html.slice(0, incompleteTagStart(html));
}

function incompleteTagStart(text: string): number {
  const lastLt = text.lastIndexOf('<');
  if (lastLt === -1) return text.length;
  const lastGt = text.lastIndexOf('>');
  if (lastGt > lastLt) return text.length;
  return /^<[a-zA-Z!/?]/.test(text.slice(lastLt, lastLt + 2)) || lastLt === text.length - 1 ? lastLt : text.length;
}

function hasClosingParen(text: string, from: number): boolean {
  let depth = 0;
  for (let i = from; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '\\') {
      i += 1;
    } else if (ch === '(') {
      depth += 1;
    } else if (ch === ')') {
      if (depth === 0) return true;
      depth -= 1;
    }
  }
  return false;
}
