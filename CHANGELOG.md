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
- URL classification resolves values against the page base the way the browser does
  (`//host` takes the page scheme, `http:path` stays on the page); verified against Chromium on
  115,810 generated strings (`e2e/url-parity.mjs`). Property tests (fast-check) for streaming,
  fence closing and DOM patching.
- MCP Apps UI census (`census/`): registry snapshot, static census over npm packages using a UI
  SDK, protocol census over remote servers (read-only), analyzer for `_meta.ui` CSP domain lists,
  permissions, tool visibility and resource HTML, report of aggregates.
- `mcp-app-lint`: the census analyzer as a package with 18 SARIF rules (MCPAPP001–018) over
  `_meta.ui` CSP domain lists, permissions, tool visibility, list/read policy differences and the
  HTML of UI resources; a CLI for a package directory, an npm package, a UI document or the JSON a
  server returned (`--format sarif|text`, `--fail-on`).
- Census: scheme-only CSP entries (`https:`) count as allowing every host, as they do in CSP; the
  report breaks the declared hosts down by category (fonts, analytics, maps, storage, media, CDNs,
  APIs, development leftovers, sinks) and re-classifies from the raw lists kept in each scan.
- `npm run size` (bundle sizes: esbuild, gzip, brotli) and `npm run bench` (one-shot and streaming
  render timings in Chromium); one run is quoted in the README.
- Evil-Markdown corpus (`corpus/`): 49 cases across script execution, URL schemes, exfiltration,
  UI spoofing, DOM clobbering, Markdown specifics, over-blocking guards and streaming, with a
  Chromium runner for any renderer and reference results for naive, DOMPurify-default and
  render-policy adapters.
