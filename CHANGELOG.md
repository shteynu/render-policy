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
- MCP Apps host conformance (`conformance/`): a reference for the CSP and iframe `allow`
  attribute the specification (SEP-1865) makes a host build from a resource's `_meta.ui`, with
  `node:test` unit tests against the spec formula and a Chromium run asserting the browser
  enforces it (declared hosts reachable, undeclared blocked by `connect-src`, the restrictive
  default when no `ui.csp` is declared, `frame-src`/`object-src`/`base-uri` locked down, host
  and sandbox on different origins). Closes the loop with the census (what servers declare) and
  mcp-app-lint (what is risky to declare): `npm run conformance`, folded into `npm run check`.
- Streaming v2: a Markdown stream re-parses and re-sanitizes only the unsettled tail of the
  buffer. The settled prefix ends at the last cut where the text before renders the same on
  its own as inside the whole document (after a blank line; never inside a fence or an HTML
  block that spans blank lines, before an indented line or a list item, or while raw tags are
  unbalanced); link reference definitions travel with every piece and a new one re-renders
  everything once. Settled blocks keep their nodes and are never parsed again; a push on a
  64 kB reply drops from 16 ms to 1 ms. A fast-check property streams generated documents
  through both paths and requires identical DOM after every push. `createStream(target,
  { incremental: false })` keeps the whole-buffer path; transforms see `partial: true` on
  pieces. The sanitizer now parses with `FORCE_BODY`, so a piece parses like the whole.
- Design pass before the first release. Every journal entry carries a stable `code` next to its
  `reason` (`scheme-not-allowed`, `sink-host`, `image-host-not-allowed`, `transform-failed`, …).
  Application code that throws no longer aborts a render: a failing `rewriteImageUrl` blocks that
  image (`image-rewrite-failed`), a failing transform is skipped (`transform-failed`), both journaled.
  The sanitizer refuses re-entry instead of mixing up two journals. `createContentBinding` holds the
  one stream lifecycle every adapter needs; the React hook and both Angular directives are wrappers
  over it, `[rpRender]` gains `rpRenderStreaming`, `RenderStream.end()` returns the final render's
  decisions and React's `onDecisions` receives them. Public surface narrowed: internals moved to
  `@render-policy/core/internal` (not covered by semver); `RenderWindow` replaces the sanitizer
  library's window type in the options; `RenderTarget` no longer admits a `Document`;
  `InsertOptions` became `RenderOptions` over a `RenderContext` that transforms extend;
  `closeOpenFences` folded into `completeFences`; `Sanitizer.toHtml` removed; `defaultScheduler`
  and `resolveWindow` exported so adapters stop duplicating them.
- `@render-policy/mermaid` is proven against mermaid 12 as well as 11 (ELK layout, new default look);
  the peer range already allowed it, the development dependency and the browser proof now use 12.
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
