import { resolveWindow } from '@render-policy/core';
import { createA2uiGuard, type A2uiGuard, type A2uiGuardOptions } from './guard.js';

/** The options the A2UI web renderers pass to a Markdown plug-in (`MarkdownRendererOptions` in their web core). */
export interface A2uiMarkdownOptions {
  /** Class names to put on rendered elements, by tag name. */
  readonly tagClassMap?: Readonly<Record<string, readonly string[]>>;
  /** `inline` renders without block wrappers. */
  readonly renderMode?: 'inline' | 'block';
}

/** The A2UI renderers' Markdown plug-in contract: Markdown in, an HTML string out. */
export type A2uiMarkdownRenderer = (markdown: string, options?: A2uiMarkdownOptions) => Promise<string>;

export interface A2uiMarkdownRendererOptions extends A2uiGuardOptions {
  /** Use this guard instead of creating one from the options above. */
  readonly guard?: A2uiGuard;
}

/**
 * A Markdown plug-in for the A2UI web renderers (React, Lit, Angular), which take
 * `(markdown, options) => Promise<string>` and insert the string themselves. `Text` gets the strict
 * text mode: no HTML, images or links, sanitized, with the journal through `onDecision`.
 *
 * This is the compatibility path and it is weaker than a fragment: the HTML is serialized here and
 * parsed again by the renderer, so what reaches the page depends on how the renderer inserts the
 * string. Where you render `Text` yourself, use `guard.renderText()`, which inserts a sanitized fragment.
 */
export function createA2uiMarkdownRenderer(options: A2uiMarkdownRendererOptions = {}): A2uiMarkdownRenderer {
  const guard = options.guard ?? createA2uiGuard(options);
  const win = resolveWindow(options.window, '@render-policy/a2ui');
  return async (markdown, renderOptions) => {
    const { fragment } = guard.text(markdown, { inline: renderOptions?.renderMode === 'inline' });
    // Classes come from the application's configuration and are added after sanitization.
    for (const [tag, classes] of Object.entries(renderOptions?.tagClassMap ?? {})) {
      if (!/^[a-z][a-z0-9]*$/i.test(tag) || classes.length === 0) continue;
      for (const element of fragment.querySelectorAll(tag)) element.classList.add(...classes);
    }
    const holder = win.document.createElement('template');
    holder.content.append(fragment);
    return holder.innerHTML;
  };
}
