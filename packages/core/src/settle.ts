/**
 * Where a streamed Markdown buffer can be cut so that the part before the cut renders the
 * same on its own as it does inside the whole document. Streaming v2 re-parses only what
 * comes after the cut; the blocks before it keep their DOM nodes untouched.
 *
 * The cut is conservative. It sits at the start of a non-blank line that follows a blank
 * line, and never: inside a fenced code block; inside an HTML block that may span blank
 * lines (script, pre, style, textarea, comments, processing instructions, declarations,
 * CDATA); before an indented line (it could continue an indented code block or a list
 * item: a list item's content is indented by as little as two spaces, so any indentation
 * counts); before a list item (it could continue the list above and change its looseness);
 * while raw HTML tags are unbalanced (an unclosed `<details>` makes the HTML parser nest the
 * following blocks, an unclosed formatting element is carried into the next block). Inside an
 * HTML block that a blank line terminates (CommonMark types 6 and 7) every line is raw HTML,
 * so a line that looks like a fence or a definition there is neither. A comment opened in
 * such a block and still open when the block ends swallows the rest of the document in the
 * HTML parser (Markdown text never emits a raw `-->`), so nothing after it is cut any more.
 *
 * Link reference definitions apply to the whole document, so the scan collects them and
 * every piece is rendered with all of them appended. A definition only counts where
 * CommonMark lets one start: not inside a paragraph, a table, a list item's or quote's
 * paragraph, or an HTML block, because there the line is literal text.
 */
export interface SettleScan {
  /** Offset up to which the buffer is settled. Never below the `atLeast` given to the scan. */
  readonly boundary: number;
  /** The link reference definitions of the whole buffer, container markers stripped, in order. */
  readonly definitions: readonly string[];
}

const FENCE_RE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const BLANK_RE = /^[ \t]*$/;
/** Any leading whitespace after a blank line may continue the list item or code block above. */
const INDENTED_RE = /^[ \t]/;
const CODE_INDENT_RE = /^(?: {4}|\t)/;
const LIST_ITEM_RE = /^ {0,3}(?:[-+*]|\d{1,9}[.)])(?:[ \t]|$)/;
const ATX_HEADING_RE = /^ {0,3}#{1,6}(?:[ \t]|$)/;
const THEMATIC_BREAK_RE = /^ {0,3}(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/;
const SETEXT_UNDERLINE_RE = /^ {0,3}(?:=+|-+)[ \t]*$/;
/**
 * A complete definition line, possibly inside blockquote or list markers; group 1 is the
 * definition itself: label, destination, optional title on the same line. A line that only
 * starts like one (an unterminated title, say) is paragraph text, for marked too.
 */
const DEFINITION_RE =
  /^(?:[ \t]{0,3}>[ \t]?|[ \t]{0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)*[ \t]{0,3}(\[[^\]]+\]:[ \t]*(?:<[^>\n]*>|[^\s<][^\s]*)(?:[ \t]+(?:"(?:[^"\\]|\\.)*"|'[^'\n]*'|\([^()\n]*\)))?)[ \t]*$/;
/** A definition's title on its own line. */
const TITLE_LINE_RE = /^[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))[ \t]*$/;
/** CommonMark HTML block type 6: known block-level tag names, open or close, at the start of a line. */
const HTML_BLOCK_6_RE =
  /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:[ \t]|\/?>|$)/i;
/** CommonMark HTML block type 7: a complete open or closing tag alone on its line; cannot interrupt a paragraph. */
const HTML_BLOCK_7_RE =
  /^ {0,3}(?:<[A-Za-z][A-Za-z0-9-]*(?:[ \t]+[A-Za-z_:][A-Za-z0-9_.:-]*(?:[ \t]*=[ \t]*(?:[^ \t"'=<>`]+|'[^']*'|"[^"]*"))?)*[ \t]*\/?>|<\/[A-Za-z][A-Za-z0-9-]*[ \t]*>)[ \t]*$/;
/** A raw tag: the name must be followed by whitespace, `/` or `>`, so `<https://…>` autolinks do not count. */
const TAG_RE = /<(\/?)([A-Za-z][A-Za-z0-9-]*)(?=[\s/>])[^>]*>/g;
const VOID_ELEMENTS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
/** HTML blocks that end at a marker rather than at a blank line (CommonMark types 1 to 5). */
const HTML_BLOCKS: readonly { readonly start: RegExp; readonly end: RegExp }[] = [
  { start: /^ {0,3}<(?:script|pre|style|textarea)(?:[\s>]|$)/i, end: /<\/(?:script|pre|style|textarea)>/i },
  { start: /^ {0,3}<!--/, end: /-->/ },
  { start: /^ {0,3}<\?/, end: /\?>/ },
  { start: /^ {0,3}<![A-Za-z]/, end: />/ },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/ },
];

/** The line opens a comment it does not close; the HTML parser then swallows everything up to the next `-->`. */
function opensComment(line: string): boolean {
  const at = line.lastIndexOf('<!--');
  return at !== -1 && !line.includes('-->', at + 4);
}

/** Opening minus closing raw tags on a line, void and self-closing tags ignored. */
function tagBalance(line: string): number {
  let balance = 0;
  for (const match of line.matchAll(TAG_RE)) {
    const closing = match[1] === '/';
    const name = (match[2] ?? '').toLowerCase();
    if (VOID_ELEMENTS.has(name) || (!closing && match[0].endsWith('/>'))) continue;
    balance += closing ? -1 : 1;
  }
  return balance;
}

export function scanSettled(source: string, atLeast = 0): SettleScan {
  const definitions: string[] = [];
  const lines = source.split('\n');
  let fence: { readonly char: string; readonly length: number } | null = null;
  let html: RegExp | null = null;
  /** Inside an HTML block that a blank line terminates (types 6 and 7). */
  let htmlUntilBlank = false;
  /** A comment opened in such a block and not closed by its raw lines. */
  let commentInBlock = false;
  /** The HTML parser is inside a comment that Markdown text cannot close: no more cuts. */
  let swallowed = false;
  /** A paragraph, table, list item or quote paragraph, or blank-line-terminated HTML block is open. */
  let blockOpen = false;
  let afterBlank = false;
  let openTags = 0;
  let boundary = atLeast;
  let offset = 0;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!;
    const lineStart = offset;
    offset += line.length + 1;

    if (fence) {
      const match = FENCE_RE.exec(line);
      if (match && (match[1] ?? '')[0] === fence.char && (match[1] ?? '').length >= fence.length && (match[2] ?? '').trim() === '') fence = null;
      continue;
    }
    if (html) {
      if (html.test(line)) html = null;
      continue;
    }
    if (htmlUntilBlank) {
      if (BLANK_RE.test(line)) {
        htmlUntilBlank = false;
        afterBlank = true;
        blockOpen = false;
        if (commentInBlock) swallowed = true;
        commentInBlock = false;
      } else {
        openTags = Math.max(0, openTags + tagBalance(line));
        if (opensComment(line)) commentInBlock = true;
        else if (commentInBlock && line.includes('-->')) commentInBlock = false;
      }
      continue;
    }
    if (BLANK_RE.test(line)) {
      afterBlank = true;
      blockOpen = false;
      continue;
    }

    if (afterBlank && !swallowed && openTags === 0 && lineStart >= atLeast && !INDENTED_RE.test(line) && !LIST_ITEM_RE.test(line)) boundary = lineStart;
    afterBlank = false;

    const fenceMatch = FENCE_RE.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1] ?? '';
      const char = marker[0] ?? '`';
      // A backtick fence's info string may not contain backticks; then it is not a fence.
      if (!(char === '`' && (fenceMatch[2] ?? '').includes('`'))) {
        fence = { char, length: marker.length };
        blockOpen = false;
        continue;
      }
    }
    const block = HTML_BLOCKS.find((h) => h.start.test(line));
    if (block) {
      if (!block.end.test(line)) html = block.end;
      blockOpen = false;
      continue;
    }
    if (HTML_BLOCK_6_RE.test(line) || (!blockOpen && HTML_BLOCK_7_RE.test(line))) {
      htmlUntilBlank = true;
      commentInBlock = opensComment(line);
      openTags = Math.max(0, openTags + tagBalance(line));
      continue;
    }
    // An unclosed `<!--` in paragraph text is escaped by the Markdown renderer: plain text, no state.
    openTags = Math.max(0, openTags + tagBalance(line));

    if (ATX_HEADING_RE.test(line) || THEMATIC_BREAK_RE.test(line) || (blockOpen && SETEXT_UNDERLINE_RE.test(line))) {
      blockOpen = false;
      continue;
    }
    if (!blockOpen) {
      if (CODE_INDENT_RE.test(line)) continue; // indented code: not a paragraph, and no definition
      const definition = DEFINITION_RE.exec(line);
      if (definition) {
        const next = lines[i + 1];
        const title = next !== undefined && TITLE_LINE_RE.test(next) ? `\n${next.trim()}` : '';
        definitions.push(`${definition[1] ?? ''}${title}`);
        if (title) {
          i += 1;
          offset += (next?.length ?? 0) + 1;
        }
        continue;
      }
    }
    blockOpen = true;
  }

  return { boundary, definitions };
}
