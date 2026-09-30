# @render-policy/mermaid

Strict Mermaid diagrams for [`@render-policy/core`](../core). Models emit ```mermaid blocks all
the time; rendering them is the one place where "sanitize the Markdown" is not enough, because
the diagram library itself produces markup from untrusted text.

```ts
import { createRenderer } from '@render-policy/core';
import { createMermaidTransform } from '@render-policy/mermaid';
import mermaid from 'mermaid';

const renderer = createRenderer({
  transforms: [createMermaidTransform({ mermaid, config: { theme: 'neutral' } })],
});
renderer.renderMarkdownInto(element, message.content);
```

What the transform guarantees, whatever the diagram source says:

- mermaid runs with `securityLevel: 'strict'`, no HTML labels (so no `foreignObject`), no error
  diagram injected into the page, nothing rendered on load; `config` cannot override these;
- the SVG mermaid produced goes through an SVG-only sanitizer: no `<a>`, `<script>`,
  `<foreignObject>`, `<image>`, `<use>` or animations, no `href`, no `data-*`, no stylesheet or
  inline style that imports, fetches an external `url()` or targets `:host`; the root `<svg>`
  gets a fixed style;
- the result lives in a shadow root inside a `contain: paint` wrapper: the diagram's stylesheet
  cannot reach the host page, the host page's CSS does not break the diagram, and nothing inside
  can overlay the page;
- the original code block stays as the wrapper's light DOM, so streaming keeps a finished
  diagram in place, and a block whose fence is still open is left as code until it closes;
- a diagram that fails to parse stays a code block, and the failure is journaled through
  `onDecision`.

Renders are cached by source (`cacheSize`, default 50). Diagram languages other than
`mermaid` can be mapped with `languages`.

Bring your own mermaid (peer dependency, 11 or later) and load it lazily if bundle size
matters; the transform only needs `initialize` and `render`. The browser proof in
`e2e/run.mjs` runs the real mermaid in Chromium against click handlers, label injection,
`themeCSS` directives, positioning through `classDef`, invalid input and streaming.
