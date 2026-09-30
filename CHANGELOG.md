# Changelog

## 0.1.0 (unreleased)

First release.

- `@render-policy/core`: sanitize into a `DocumentFragment` and insert with `replaceChildren()`;
  strict / balanced / permissive modes; image host allowlist without wildcards by default; query
  stripping or proxy rewrite; URL length and entropy heuristics; versioned sink-domain denylist;
  "click to open" placeholder for blocked images; class, attribute and scheme allowlists; forced
  `rel="noopener noreferrer"`; streaming with withheld incomplete URLs, closed fences and tail-only
  DOM patching; decision journal; `trustedHTML()` escape hatch.
- `@render-policy/angular`: `[rpRender]` directive, `<rp-markdown>` component with streaming,
  `provideRenderPolicy()`; built with ng-packagr in partial compilation mode.
- `@render-policy/react`: `RenderPolicyProvider`, `useRenderPolicy()`, `<RpMarkdown>`, `<RpHtml>`
  with streaming.
- `eslint-plugin-render-policy`: `no-unsafe-innerhtml` (JS/TS/JSX sinks) and `no-innerhtml-binding`
  (Angular templates).
- `@render-policy/mermaid`: strict Mermaid diagrams as a fragment transform (SVG-only sanitizer,
  shadow-root isolation, open fences left as code while streaming, source cache); core gained
  `transforms` with a streaming-aware context.
- Demo page, deployed to GitHub Pages, and Chromium proofs for the core, the Angular adapter and
  the static site: payload execution, off-origin requests, Trusted Types enforcement, streaming.
- Release workflow: tarballs on every GitHub release, npm publish with provenance when a token is set.
- Evil-Markdown corpus (`corpus/`): 49 cases across script execution, URL schemes, exfiltration,
  UI spoofing, DOM clobbering, Markdown specifics, over-blocking guards and streaming, with a
  Chromium runner for any renderer and reference results for naive, DOMPurify-default and
  render-policy adapters.
