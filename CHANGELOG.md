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
- Demo page and a Chromium proof covering payload execution, off-origin requests, Trusted Types
  enforcement and streaming.
