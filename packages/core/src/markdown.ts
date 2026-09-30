import { Marked } from 'marked';

/** Markdown to HTML. The output is untrusted: it always goes through the sanitizer afterwards. */
export type MarkdownRenderer = (markdown: string) => string;

export interface MarkdownOptions {
  /** GitHub Flavored Markdown (tables, strikethrough, autolinks). Default true. */
  readonly gfm?: boolean;
  /** Render single newlines as <br>. Default false. */
  readonly breaks?: boolean;
}

/**
 * The default Markdown renderer, built on marked. Raw HTML in the Markdown is
 * passed through unchanged on purpose: sanitization runs last, on the final HTML,
 * so nothing the Markdown step produces can bypass it.
 */
export function createMarkdownRenderer(options: MarkdownOptions = {}): MarkdownRenderer {
  const marked = new Marked({
    gfm: options.gfm ?? true,
    breaks: options.breaks ?? false,
    async: false,
  });
  return (markdown) => marked.parse(markdown, { async: false });
}
