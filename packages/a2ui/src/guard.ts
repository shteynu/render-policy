import {
  createRenderer,
  createUrlGuard,
  resolvePolicy,
  resolveWindow,
  type ContentPolicy,
  type RenderDecision,
  type RenderMode,
  type RenderPolicyOverrides,
  type RenderTarget,
  type RenderWindow,
  type Renderer,
  type SinkDenylist,
  type UrlGuard,
  type UrlRequest,
} from '@render-policy/core';
import { createStrictMarkdown, type StrictMarkdown } from './text.js';

/**
 * Where an A2UI value is used, by the catalog's names:
 *
 * - `image`: `Image.url`
 * - `video`: `Video.url`
 * - `audio`: `AudioPlayer.url`
 * - `icon`: `theme.iconUrl` in `createSurface` (an image next to the surface)
 * - `openUrl`: `args.url` of the `openUrl` function (navigation)
 *
 * The first four are fetched without a click and go through the image policy; video and audio
 * players request metadata on their own, so they are held to the same rule as images.
 */
export type A2uiUrlKind = 'image' | 'video' | 'audio' | 'icon' | 'openUrl';

/** Optional location of a value, copied into its journal entries. */
export interface A2uiWhere {
  readonly surfaceId?: string;
  readonly componentId?: string;
}

/** A journal entry with the A2UI place it came from. */
export interface A2uiDecision extends RenderDecision {
  readonly a2ui: A2uiWhere & { readonly kind: A2uiUrlKind | 'text' };
}

export type A2uiUrlResult =
  | { readonly allowed: true; readonly value: string; readonly decisions: readonly A2uiDecision[] }
  | { readonly allowed: false; readonly decision: A2uiDecision; readonly decisions: readonly A2uiDecision[] };

export interface A2uiTextResult {
  readonly fragment: DocumentFragment;
  readonly decisions: readonly A2uiDecision[];
}

export interface A2uiTextOptions extends A2uiWhere {
  /** Render without block wrappers (no `<p>`), for a label. Default false. */
  readonly inline?: boolean;
}

export interface A2uiGuardOptions {
  /** The window to render with and resolve relative URLs against. Defaults to the global window. */
  readonly window?: RenderWindow;
  /** Policy preset. Default 'balanced': no remote image host until you list it. */
  readonly mode?: RenderMode;
  /** Overrides applied on top of the preset, as in `createRenderer`. */
  readonly policy?: RenderPolicyOverrides;
  /** Replace the bundled sink denylist. */
  readonly sinkDenylist?: SinkDenylist;
  /**
   * `strict` (default) holds `Text` to the basic catalog's contract: Markdown without HTML, images or
   * links. `policy` renders `Text` like any other Markdown under the policy, for a catalog of your own
   * that allows more.
   */
  readonly text?: 'strict' | 'policy';
  /** Opens an allowed `openUrl` target. Default: `window.open(url, '_blank', 'noopener,noreferrer')`. */
  readonly open?: (url: string) => void;
  /** Receive every decision as it is made. */
  readonly onDecision?: (decision: A2uiDecision) => void;
}

export interface A2uiGuard {
  /**
   * Check a resolved value right before the renderer uses it: after data binding and function calls
   * (`{ "path": "/img" }`, `formatString`), on every data-model update. Use the returned `value`, not
   * the one passed in: it may be rewritten (query string stripped, image proxy). Never throws.
   */
  url(kind: A2uiUrlKind, value: unknown, where?: A2uiWhere): A2uiUrlResult;
  /**
   * The basic catalog's `openUrl`: checks the target (http and https only, as the catalog requires,
   * plus the policy) and opens it with `noopener,noreferrer` only when it is allowed.
   */
  openUrl(value: unknown, where?: A2uiWhere): A2uiUrlResult;
  /** `Text.text` as an inert fragment. Non-string values are rendered as their string form. */
  text(value: unknown, options?: A2uiTextOptions): A2uiTextResult;
  /** `Text.text` inserted into `target` with `replaceChildren()`. */
  renderText(target: RenderTarget, value: unknown, options?: A2uiTextOptions): { readonly decisions: readonly A2uiDecision[] };
}

const REQUESTS: Readonly<Record<A2uiUrlKind, UrlRequest>> = {
  image: { subject: 'image', tag: 'img', attribute: 'src' },
  icon: { subject: 'image', tag: 'img', attribute: 'src' },
  video: { subject: 'image', tag: 'video', attribute: 'src' },
  audio: { subject: 'image', tag: 'audio', attribute: 'src' },
  openUrl: { subject: 'link', tag: 'a', attribute: 'href' },
};

/** The catalog: "Strictly validate that the resolved URL protocol/scheme is either https: or http:". */
const OPEN_URL_SCHEMES = ['http', 'https'];

/** No form controls, SVG, media, images or links in `Text`, whatever the policy allows elsewhere. */
const strictContent = (content: Partial<ContentPolicy> | undefined): Partial<ContentPolicy> => ({
  ...content,
  allowImages: false,
  allowForms: false,
  allowSvg: false,
  allowMedia: false,
  forbidTags: [...(content?.forbidTags ?? []), 'a', 'img'],
});

/**
 * The render policy for an A2UI surface. A2UI sends no HTML, so sanitization is no longer the
 * question; where the agent's data may flow still is. Every URL a component property or function
 * argument carries is checked on its resolved value, with the same policy, sink denylist and journal
 * codes as `@render-policy/core`, and `Text` is held to the catalog's "no HTML, images or links".
 */
export function createA2uiGuard(options: A2uiGuardOptions = {}): A2uiGuard {
  const win = resolveWindow(options.window, '@render-policy/a2ui');
  const { mode, policy = {}, sinkDenylist } = options;
  const onDecision = options.onDecision;
  const urlGuard: UrlGuard = createUrlGuard({ window: win, mode, policy, sinkDenylist });
  const openUrlSchemes = resolvePolicy(mode, policy).urls.allowedSchemes.filter((s) => OPEN_URL_SCHEMES.includes(s));
  const openUrlGuard: UrlGuard = createUrlGuard({ window: win, mode, policy: { ...policy, urls: { ...policy.urls, allowedSchemes: openUrlSchemes } }, sinkDenylist });
  const open =
    options.open ??
    ((url: string) => {
      const opener = (win as RenderWindow & { open?: (url: string, target: string, features: string) => unknown }).open;
      opener?.call(win, url, '_blank', 'noopener,noreferrer');
    });

  const located = (decisions: readonly RenderDecision[], kind: A2uiDecision['a2ui']['kind'], where: A2uiWhere | undefined): A2uiDecision[] =>
    decisions.map((d) => ({ ...d, a2ui: { ...where, kind } }));
  const emit = (decisions: readonly A2uiDecision[]): void => {
    if (onDecision) for (const d of decisions) onDecision(d);
  };

  const check = (guard: UrlGuard, kind: A2uiUrlKind, value: unknown, where: A2uiWhere | undefined): A2uiUrlResult => {
    const request = REQUESTS[kind];
    if (typeof value !== 'string' || value.trim() === '') {
      // A binding that resolved to nothing usable: there is no URL to check, so there is none to use.
      const [decision] = located(
        [{ kind: 'blocked', subject: request.subject, code: 'a2ui-not-a-url', reason: `expected a non-empty string, got ${describe(value)}`, tag: request.tag, attribute: request.attribute }],
        kind,
        where,
      ) as [A2uiDecision];
      emit([decision]);
      return { allowed: false, decision, decisions: [] };
    }
    const result = guard(value, request);
    const decisions = located(result.decisions, kind, where);
    if (result.allowed) {
      emit(decisions);
      return { allowed: true, value: result.value, decisions };
    }
    const [decision] = located([result.decision], kind, where) as [A2uiDecision];
    emit([...decisions, decision]);
    return { allowed: false, decision, decisions };
  };

  // One renderer per text shape, created on first use.
  const textRenderers = new Map<boolean, { renderer: Renderer; markdown: StrictMarkdown | null }>();
  const textRenderer = (inline: boolean) => {
    let entry = textRenderers.get(inline);
    if (!entry) {
      if (options.text === 'policy') {
        entry = { renderer: createRenderer({ window: win, mode, policy, sinkDenylist }), markdown: null };
      } else {
        const markdown = createStrictMarkdown(inline);
        const renderer = createRenderer({ window: win, mode, policy: { ...policy, content: strictContent(policy.content) }, sinkDenylist, markdown });
        entry = { renderer, markdown };
      }
      textRenderers.set(inline, entry);
    }
    return entry;
  };

  const text = (value: unknown, textOptions: A2uiTextOptions = {}): A2uiTextResult => {
    const { inline = false, ...where } = textOptions;
    const source = typeof value === 'string' ? value : value === null || value === undefined ? '' : String(value);
    const { renderer, markdown } = textRenderer(inline);
    const { fragment, decisions: rendered } = renderer.markdownToFragment(source);
    // Markdown-level decisions come first: they happened first.
    const decisions = located([...(markdown?.decisions ?? []), ...rendered], 'text', where);
    emit(decisions);
    return { fragment, decisions };
  };

  return {
    url: (kind, value, where) => check(kind === 'openUrl' ? openUrlGuard : urlGuard, kind, value, where),
    openUrl(value, where) {
      const result = check(openUrlGuard, 'openUrl', value, where);
      if (result.allowed) open(result.value);
      return result;
    },
    text,
    renderText(target, value, textOptions) {
      const { fragment, decisions } = text(value, textOptions);
      target.replaceChildren(fragment);
      return { decisions };
    },
  };
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'string') return 'an empty string';
  return typeof value === 'object' ? 'an object' : `a ${typeof value}`;
}
