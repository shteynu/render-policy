# Evil-Markdown corpus

Hostile Markdown of the kind a prompt-injected agent produces, with the invariants a safe
renderer must hold, and a runner that checks any renderer against it in a real Chromium.
The point is not to grade sanitizers on XSS alone: most of the corpus is about what happens
after sanitization, when a "clean" document still leaks data through an image request, shows
a password form inside the reply, restyles the host page, or turns a half-received URL into a
request.

- `evil-markdown.json`: the cases. Each has an `input` (or `stream.chunks`) and an `expect`
  block; payload markers call `p('<case id>')` instead of doing harm; `{{origin}}` is replaced
  with the origin of the page under test.
- `lib/evaluate.js`: the DOM invariants, evaluated inside the page after rendering.
- `run.mjs`: bundles an adapter with esbuild, opens one page per case, intercepts and aborts
  every off-origin request, records same-origin requests, and reports a table.
- `adapters/`: three reference adapters: `naive` (marked + innerHTML), `dompurify-default`
  (DOMPurify's default configuration + innerHTML) and `render-policy` (balanced mode, no
  configuration).
- `RESULTS.md`: the table for the three reference adapters, regenerated with `--results`.

## Invariants

| Key | Meaning |
| --- | --- |
| `noExecution` | the case's marker was never called |
| `noElements` | none of these selectors match inside the container |
| `noAttributes` | no attribute name matches these regular expressions (`^on`, `^style$`, `^srcset$`, `^ping$`) |
| `noUrlScheme` | no URL-bearing attribute (`href`, `src`, `srcset`, `poster`, `data`, ...) uses these schemes, after browser-style normalization |
| `noRequestTo` | no request left the page for these hosts (or their subdomains) |
| `noClassNames`, `noIds`, `noNames` | these class tokens, ids or names do not survive |
| `relNoopenerOnTargetBlank` | every kept `target="_blank"` link carries `rel="noopener"` |
| `mustHave`, `mustContainText`, `mustNotContainText` | guards against over-blocking |
| `stream.*` | chunk-by-chunk: `noRequestsBeforeLast` (with `requestUrlContains`), `requestsAtEnd`, `noElementsBeforeLast`, `mustHaveAfterEachChunk` |

## Running your renderer

Write an adapter: an ES module whose default export has a `name`, a `render(container, markdown)`
function (sync or async) and, optionally, `createStream(container)` returning `{ push(chunk), end() }`.
It is bundled with esbuild from the repository root, so it can import anything installed there.

```js
// my-renderer.mjs
import { renderMarkdown } from 'my-renderer';

export default {
  name: 'my-renderer 2.0',
  render(container, markdown) {
    container.replaceChildren(renderMarkdown(markdown));
  },
};
```

```
npm ci && npm run build -w packages/core
node corpus/run.mjs --adapter ./my-renderer.mjs --results my-results.md
```

`--only <case id>` runs one case, `--json out.json` writes the raw results, and
`--require-pass <adapter file name>` exits non-zero when that adapter fails a case (CI uses it
for `render-policy`).

## Adding a case

Add an object to `evil-markdown.json` with a unique `id`, a `category`, a one-line `title`, the
`input` and the smallest `expect` block that captures the invariant. Cases that need a payload to
run call `p('<id>')`. Cases that need the page's own origin use `{{origin}}`. Run the corpus
against the reference adapters and commit the updated `RESULTS.md`.

A case that a widely used renderer fails is not a reason to name that renderer here before its
maintainers had a chance to fix it. Report it to them first.
