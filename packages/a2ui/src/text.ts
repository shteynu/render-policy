import { Marked } from 'marked';
import type { RenderDecision } from '@render-policy/core';

/** Markdown to HTML that also reports what it took out. */
export interface StrictMarkdown {
  (markdown: string): string;
  /** Decisions made by the last call; reset on every call. */
  readonly decisions: readonly RenderDecision[];
}

const escapeHtml = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Markdown for the basic catalog's `Text`: "simple Markdown formatting ... without HTML, images, or
 * links". The catalog states this as guidance to the agent; here it is enforced. Raw HTML is shown as
 * text, an image becomes its alt text and a link its text, so nothing is fetched or navigated to and
 * nothing the agent wrote disappears silently. Each change is a journal entry. The output still goes
 * through the sanitizer, which forbids `a` and `img` on top.
 */
export function createStrictMarkdown(inline: boolean): StrictMarkdown {
  let decisions: RenderDecision[] = [];
  const marked = new Marked({
    gfm: true,
    breaks: false,
    async: false,
    renderer: {
      html(token) {
        decisions.push({ kind: 'rewritten', subject: 'markdown', code: 'a2ui-text-html', reason: 'raw HTML in Text shown as text: the catalog allows no HTML', value: token.text });
        return escapeHtml(token.text);
      },
      image(token) {
        decisions.push({ kind: 'blocked', subject: 'image', code: 'a2ui-text-image', reason: 'image in Text replaced by its alt text: the catalog allows no images', tag: 'img', attribute: 'src', value: token.href });
        return escapeHtml(token.text);
      },
      link(token) {
        decisions.push({ kind: 'blocked', subject: 'link', code: 'a2ui-text-link', reason: 'link in Text replaced by its text: the catalog allows no links', tag: 'a', attribute: 'href', value: token.href });
        return this.parser.parseInline(token.tokens);
      },
    },
  });
  const render = (markdown: string): string => {
    decisions = [];
    return inline ? marked.parseInline(markdown, { async: false }) : marked.parse(markdown, { async: false });
  };
  Object.defineProperty(render, 'decisions', { get: () => decisions });
  return render as StrictMarkdown;
}
