# Changelog

## 0.1.4 — 2026-10-07

`@render-policy/react`, `@render-policy/mermaid`, `@render-policy/angular` and
`eslint-plugin-render-policy` are unchanged; they move to 0.1.4 so all six packages share one
version. `mcp-app-lint` requires `@render-policy/core` ^0.1.4 for the new denylist entries.

- `@render-policy/core`: sink denylist 2026-10-07 adds S3-compatible object stores and backend
  platforms with public storage, where anyone can open an account and receive data through a
  presigned upload or a public bucket: Cloudflare R2's S3 endpoint (`r2.cloudflarestorage.com`;
  `r2.dev` was already listed), Linode, Yandex Cloud, Alibaba OSS, Tencent COS, Scaleway, IBM
  COS, Oracle Object Storage, Hetzner, Storj, Firebase Storage, Vercel Blob and Supabase. Links
  and images to these hosts are blocked in `balanced` and `strict` like the other storage hosts.
  `mcp-app-lint` follows: a wildcard over them or their path-style endpoint is MCPAPP005, one
  named account MCPAPP019.
- `mcp-app-lint`: MCPAPP017 and MCPAPP018 compare `resources/list` and `resources/read` field by
  field (`csp`, `permissions`, `domain`), and only where both sides declare the field. The MCP
  Apps SDK puts the CSP in the read result only, so a listing without one is not a mismatch; it
  raised MCPAPP017 whenever the listing carried any `_meta`. MCPAPP018 now also catches a replaced
  domain (the listing has `api.example.com`, read has another host), which was a mismatch only.
  `compareListRead()` returns `conflict` beside `mismatch`; `mismatch` keeps its meaning (any
  difference) for the census.

## 0.1.3 — 2026-10-06

`@render-policy/core`, `@render-policy/react`, `@render-policy/mermaid`, `@render-policy/angular`
and `eslint-plugin-render-policy` are unchanged; they move to 0.1.3 so all six packages share one
version.

- `mcp-app-lint`: MCPAPP001 (`csp-missing`) fires only when the UI references an external host:
  an attribute such as `src` or `href`, or an absolute URL in `fetch`, `WebSocket`,
  `EventSource`, XHR `open`, `sendBeacon` or `import()`. Without a CSP a compliant host applies
  `default-src 'none'`, so a self-contained UI was being told to declare a policy it does not
  need (19 of the 25 examples in the MCP Apps SDK repository; 72 of the 146 census packages that
  serve a UI, now 15). The finding lists the hosts (`properties.hosts`). In a package scan the
  hosts come from its HTML documents, not from server code. `lintUiMeta()` takes the hosts as a
  third argument and reports nothing for a missing CSP without them; `analyzeHtml()` returns
  `networkHosts` beside `externalHosts`.
- `mcp-app-lint`: text output no longer prints `:undefined` for a finding with a line and no
  column (CSP entries in a package scan).

## 0.1.2 — 2026-10-06

`@render-policy/core`, `@render-policy/react`, `@render-policy/mermaid` and `@render-policy/angular`
are unchanged; they move to 0.1.2 so all six packages share one version.

- `mcp-app-lint`: a CSP entry on the sink denylist is split by whom it reaches. MCPAPP005 (error)
  now fires only for entries that reach accounts anyone can create: the service host itself
  (`storage.googleapis.com` and `s3.amazonaws.com` serve any bucket by path), a wildcard over the
  customers (`*.blob.core.windows.net`, `*.ngrok-free.dev`), path-style endpoints, and every name
  on tunnel, request-catcher, OAST and form services. One account on a storage or serverless
  service (`acct.blob.core.windows.net`, `pub-<id>.r2.dev`, `app.team.workers.dev`) is the new
  MCPAPP019 `csp-sink-tenant-host` (note). `sinkScope()` is exported; `classifyDomains()` returns
  `tenantSinks` beside `sinks`, which now holds the shared ones only, and the domain category
  `sink` follows it (a tenant bucket is `storage`).
- `mcp-app-lint`: denylist entries with `*` (`s3.*.amazonaws.com`, `s3-*.amazonaws.com`,
  `lambda-url.*.on.aws`) match as in core; they were compared literally and never matched.
- `mcp-app-lint`, after a run over the 174 npm packages that depend on a UI SDK:
  - CSP findings (MCPAPP002–006, 019) in a package scan point at the file and line of the entry;
    they pointed at the package. One list referenced twice is reported once.
  - Domain lists written through a constant or shorthand in the same file are read; a list built
    at runtime counts as declared. Before, both raised MCPAPP001.
  - MCPAPP001 for a package requires that it serves a UI resource (`scanPackageDir` returns
    `servesUi` beside `declaresUi`); hosts, renderers and SDKs that only mention the MIME type
    or `ui://` are no longer told to declare a CSP.
  - MCPAPP004 skips loopback origins (MCPAPP006 reports them); MCPAPP006 no longer reports
    `blob:`, and local schemes have their own domain category, `local-scheme`.
  - MCPAPP005 covers a wildcard above a sink service (`*.amazonaws.com`, `*.googleapis.com`).
  - MCPAPP010 leaves out values whose every dynamic part goes through an escaping helper
    (`ESCAPE_FUNCTIONS`); MCPAPP011 leaves out the app protocol (JSON-RPC or mcp-ui messages to
    `parent`/`top`) and reports each remaining call with its line. The analysis keeps the old
    totals and adds `unsafeInnerHtmlHandwrittenUnescaped`, `postMessageStarHandwrittenNonProtocol`
    and `postMessages`.
- `mcp-app-lint` ships TypeScript declarations (`dist/*.d.mts`, generated from JSDoc in the
  sources at build time), including the shapes it returns and takes: `Finding`, `Rule`,
  `DomainPattern`, `HtmlAnalysis`, `PackageScan`, `PackageMeta`, `ScanOptions` and others. The
  sources are type-checked with `checkJs`. Two inputs that used to fail late now fail early: an
  option given without its value (`--dir` at the end of the command line) is a usage error, and
  `scanPackage()` rejects a package without a tarball before downloading.
- `mcp-app-lint`: the SARIF driver version is read from `package.json`; it was a constant left at
  `0.1.0`, so 0.1.1 reported the wrong version.
- `eslint-plugin-render-policy`: `no-unsafe-innerhtml` takes `escapeFunctions`, names of functions
  whose result counts as static (default none, so library code is checked as before).
- Census report: the protocol census re-classifies domain lists from the hosts kept in each
  record, reports shared and tenant sink hosts separately, and gives server counts beside the
  resource counts.

## 0.1.1 — 2026-10-06

- `@render-policy/core` (security): `urls.decide` now sees an image only after the image host,
  query and heuristic checks, and receives the URL after query handling. In 0.1.0 the hook ran
  first, so rewriting an image to a same-origin proxy (`/img-proxy?url=…`) skipped the image
  policy: an unlisted host was let through and a query string such as `?q=secret` travelled to the
  image host inside the proxy URL. `images.rewriteUrl` was not affected. A `decide` hook no longer
  sees images the image policy blocks.
- `@render-policy/core`: sink denylist `2026-10-06`. Patterns may use `*` for part of one host
  label or path segment. New entries: regional, dual-stack, website, access-point and legacy S3
  endpoints (before, only `s3.amazonaws.com` and its subdomains matched); Lambda function URLs;
  Azure `dfs`/`web` storage; Telegram Bot API (`sendMessage` works as a GET), versioned Discord
  webhook paths, Microsoft Teams and Google Chat incoming webhooks, smee.io; IP loggers
  (iplogger, yip.su, grabify); requestrepo; ngrok's newer domains, Pinggy, zrok public shares,
  Tunnelmole, Microsoft dev tunnels, Codespaces forwarded ports; more form builders. A custom
  denylist that relied on `*` matching a literal asterisk now matches as a wildcard.
- `@render-policy/mermaid`: the source cache evicts the least recently used diagram (it evicted the
  oldest insert, so a diagram a stream re-renders on every push could be dropped and rendered
  again); `cacheSize: 0` turns caching off (it kept one entry). Render ids are unique per page,
  not per transform: two transforms rendering at once both used `rp-mermaid-1`, and mermaid
  places a temporary element with that id in the document.
- `mcp-app-lint`: requires `@render-policy/core` and `eslint-plugin-render-policy` `^0.1.1`, so its
  sink-host findings use the `2026-10-06` denylist.
- Docs: [`docs/image-proxy.md`](docs/image-proxy.md), routing images through a proxy without
  opening an SSRF hole on the server.
- Corpus `2026-10-06`: five link-to-sink cases (chat bot API, versioned chat webhook, IP logger,
  regional object storage, serverless function URL); 54 cases. The 0.1.0 denylist fails all five.

## 0.1.0 — 2026-09-30

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
- `RenderPolicy` is grouped into `content` (elements, attributes, classes), `urls` (schemes,
  relative URLs, `heuristics`, `sinkDenylist`, and a new `decide` hook) and `images` (`hosts`,
  `allowWildcardHosts`, `query`, `rewriteUrl`, `blocked`). An override names only the fields it
  changes; each group is merged onto the mode preset. `urls.decide(url, context)` is the general
  URL hook the design review asked for: it runs for every URL attribute after the scheme, relative
  and sink checks, for links and images alike, and can allow, deny or rewrite (a link through a
  redirector, an image through a proxy, re-checked against the scheme allowlist); it is where a
  link policy lives. If it throws, that one URL is dropped and the render goes on
  (`url-denied`, `url-rewritten`, `url-rewrite-invalid`, `url-decider-failed` journal codes).
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
- `mcp-app-lint` ships a GitHub composite action (`action.yml`): it runs the scanner and uploads
  the SARIF to code scanning, with `directory`, `fail-on`, `upload-sarif`, `version` and `args`
  inputs. The CLI now normalises filesystem locations to repo-relative forward-slash paths so code
  scanning maps them to the source, and records the command line in the SARIF invocation.
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
