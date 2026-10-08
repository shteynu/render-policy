# Roadmap

The source of truth for the plan is the working document
[План: безопасность агентного UI](https://claude.ai/artifact/DARKTXxuaYovCfDhgxdRZa)
(private; owner: this repository's maintainer). This file mirrors the parts of it that
concern the code in this repository. Dates are from that plan.

## Stage 2: render-policy v0.1 and the Angular adapter (12 Oct – 27 Nov 2026)

Publish an open-source rendering-policy engine for agent output. Core in TypeScript without a
framework; Angular is the first adapter. MIT, so upstream projects can take the code.

| Component | Plan | Status |
| --- | --- | --- |
| Core | Policy for `img`, `a`, media, SVG; host allowlist without wildcards by default; query-string removal or proxy; URL length and entropy heuristics; "click to load" placeholder; applied as the last step over the final HTML | done: `@render-policy/core` |
| Sink denylist | Forms, blob storage, `workers.dev`, webhook services; data separate from code, versioned | done: `packages/core/src/data/sink-domains.ts` (starting set) |
| Angular adapter | Renders without `innerHTML`; streaming withholds images and links until the URL is closed and checked; Trusted Types | done (`[rpRender]`, `<rp-markdown>`, `provideRenderPolicy`); builds with ng-packagr in partial compilation mode, publish from `packages/angular/dist`; runtime proof in Chromium (`packages/angular/e2e`) |
| Strict Mermaid | Diagram blocks rendered only by a strict renderer | done as a framework-free transform: `@render-policy/mermaid` (works with every adapter through `transforms`) |
| Angular adapter: ngx-markdown bridge | A provider that routes ngx-markdown through the policy | not started (migration guide only) |
| ESLint | Forbid `innerHTML` and `[innerHTML]` for untrusted content | done: `no-unsafe-innerhtml`, `no-innerhtml-binding` |
| Regression tests | One per class of real advisories: sanitization order, fallback render, SVG in `data:`, Mermaid loose mode, sink through an allowed domain | done: `packages/core/test/regressions.test.ts` |
| Modes | strict (no remote images), balanced (allowlist, no query), permissive (everything, with a journal) | done |
| Demo | The same hostile markup rendered naively and through the policy | done: `demo/`, deployed to GitHub Pages, plus Chromium proofs in `e2e/` |
| Docs | Threat model, modes, migration from `innerHTML` and ngx-markdown | done: `README.md`, `docs/migration.md` |

Done when:

- [x] core, Angular and React adapters and the ESLint plugin published on npm as v0.1 (0.1.0 published by hand on 2026-10-06; from then on `.github/workflows/release.yml` attaches the tarballs to a GitHub release on every `vX.Y.Z` tag and publishes to npm through trusted publishing)
- [x] every advisory class in the table has a test
- [x] the streaming render makes no request to an unclosed or unchecked URL (unit + browser)
- [x] demo of the same hostile markup with and without the policy
- [x] documentation: threat model, modes, migration
- [x] React adapter (planned for December 2026, done early: `@render-policy/react`)

Also planned for the core:

- [x] streaming v1: keep settled blocks, replace only from the first changed node (`patchChildren`)
- [ ] streaming v2: re-parse only the unsettled Markdown tail instead of the whole buffer. Attempted with a line-scanner that finds a safe cut, but a strict fast-check equivalence property (incremental DOM must equal a whole-buffer render after every push) kept finding non-local Markdown cases — link reference definitions, loose-list continuation across a growing last line, and more — so it was reverted pending a design that meets the property. Whole-buffer rendering with tail `patchChildren` ships for now (`npm run bench`: a push costs 2 ms at 8 kB and 17 ms at 64 kB).
- [x] an evil-Markdown corpus other renderers can run (`corpus/`, 54 Markdown cases and 24 A2UI cases, reference results in `corpus/RESULTS.md`)
- [x] image proxy guidance (SSRF-safe) for `images.rewriteUrl`: [`docs/image-proxy.md`](docs/image-proxy.md), with a reference proxy checked against the guide's attack table

## Proposed: structured agent UI (A2UI)

Not yet in the plan document; dates to be set there. Scope and design notes, from reading the
A2UI specification v0.9 and the v1.0 candidate (`google/A2UI`, `specification/`).

An A2UI agent sends no HTML: `createSurface`, `updateComponents`, `updateDataModel` and
`deleteSurface` messages describe components from a catalog, and the client renders them with its
own widgets. What a sanitizer used to cover is gone by construction; what the policy covers is not.
In the basic catalog the policy-relevant places are:

| Place | Content | Class |
| --- | --- | --- |
| `Text.text` | Markdown; the catalog says "without HTML, images, or links", which is guidance to the agent, not a guarantee | markup injection, images and links that should not be there |
| `Image.url`, `Video.url`, `AudioPlayer.url` | URLs the browser requests without a click | exfiltration through the request, the same class as `<img>` in Markdown |
| `openUrl` function (button actions) | navigation | dangerous schemes, sink hosts; the spec itself mandates an `http`/`https` allowlist and `noopener,noreferrer` |
| `updateDataModel` | the data the fields above bind to | see below |

Nearly every property is `Dynamic*`: a literal, a JSON Pointer `path` into the data model, or a
function call such as `formatString` (`"https://${/host}/${/token}"`). The effective value exists
only after binding and changes with every data-model update, so checking message JSON is not
enough: the check has to run on the resolved value, at the moment the renderer uses it.

Integration point: the reference renderers (React, Lit, Angular) take Markdown through a plug-in,
`(text, options) => Promise<string>`, returning an HTML string the renderer inserts itself. That
contract is string-based; the policy's own output is a fragment.

| Component | Plan | Status |
| --- | --- | --- |
| Resolved-value guard | `guard.url(kind, value)` for `image`, `video`, `audio`, `icon` (`theme.iconUrl`) and `openUrl`: image-host allowlist, sink denylist, URL heuristics, `images.rewriteUrl`, schemes; every decision is a journal entry with the existing codes; application hooks that throw become entries, never aborted renders | done: `@render-policy/a2ui` `createA2uiGuard()`, on core's new `createUrlGuard()` |
| Strict text mode | A policy preset for `Text`: Markdown without HTML, images or links, matching the catalog's contract | done: raw HTML shown as text, images as alt text, links as text, each journaled; `text: 'policy'` opts out |
| Markdown plug-in | Fragment path: our React and Angular components render `Text` themselves. Compatibility path: a string for the reference renderers' plug-in contract, documented as weaker than a fragment | compatibility path done (`createA2uiMarkdownRenderer`); fragment path through `guard.renderText()`, React and Angular components not started |
| Public URL API | a link decision hook lands as `urls.decide(url, context)` (allow / deny / rewrite, for links and images); `checkUrlHeuristics` stays in `core/internal` for now | done: `urls.decide` |
| Static message scan | Literal hazards in A2UI messages (`javascript:` in `openUrl`, image hosts outside the allowlist) as `mcp-app-lint` rules; a CI aid, not a substitute for the guard | done: `mcp-app-lint --a2ui`, rules A2UI001–A2UI007; bindings and `formatString` resolved against the stream's own `updateDataModel` |
| Proofs | jsdom for the guard and presets; Chromium proof that an image URL arriving through `updateDataModel` and blocked by the policy makes no request | done: `packages/a2ui/test`, `packages/a2ui/e2e` (also `formatString`, the theme icon, `Text`, `openUrl`, with an unguarded control run) |
| Corpus | A2UI cases next to the evil-Markdown ones (bound URLs, `formatString`-assembled URLs, Markdown in `Text` that breaks the catalog contract) | done: `corpus/evil-a2ui.json`, 24 cases on a minimal v0.9 surface (`corpus/lib/a2ui-surface.js`); adapters opt in with `a2ui.createSurface(container)` |

Decided (2026-10-08): a separate package, `@render-policy/a2ui`, so core does not move with the
A2UI specification; v0.9 first, because that is what the reference renderers ship (v0.9.1, the
current production release, has the same basic catalog); v1.0 follows when it is stable. A
`formatString` result is checked as one value, the URL the renderer will use: the length and entropy
heuristics see an interpolated token there, and a per-part check would need the renderer's own
expression parser.

AG-UI needs no adapter of its own: it transports text deltas, which the existing streaming mode
already renders.

## Stage 3: census of CSP in public MCP Apps (26 Oct – 27 Nov 2026)

Measure how public MCP Apps declare CSP and allowed domains (`_meta.ui`: CSP, `connectDomains`,
`resourceDomains`) across 100+ servers; count wildcards and sink hosts, list/read policy
mismatches, side-effecting tools visible to UI by default, and data interpolation into HTML
templates. Read-only, protocol-level data; dangerous findings go to owners privately first.
Output: a publication with aggregates and the census script, which becomes the basis for
scanner rules in Stage 4.

Status: the tooling lives in [`census/`](census) (started early; it can move to its own
repository with `git subtree split`). Three collectors (registry snapshot, static census over
npm packages that use a UI SDK, protocol census over remote servers), one analyzer that reuses
the sink denylist and the ESLint rule, a report of aggregates. The registry snapshot and the
static census run from anywhere; the protocol census needs a machine with ordinary outbound
access. Results ([`census/SUMMARY.md`](census/SUMMARY.md), registry snapshot of 6 Oct 2026): 39,919
servers in the registry, 63% with a remote endpoint. Static census: 174 npm packages depend on a UI
SDK, 146 serve UI resources, 51% of those declare a CSP domain list. Protocol census over the
24,321 streamable-http remotes (run 6 Oct 2026): 15,120 speak MCP, 654 serve UI resources; a CSP
names a sink host anyone can use on 60 UI resources across 26 servers. Findings on specific
servers go to their owners privately before the publication. The publication built on these numbers is
[`docs/writeup-mcp-apps-census.md`](docs/writeup-mcp-apps-census.md), live-policy section
included; it waits for the maintainer's proofreading.

## Stage 4: evil-mcp-app and rules for MCP scanners (30 Nov 2026 – 29 Jan 2027)

A Playwright suite with a malicious MCP server that grades any MCP Apps host: isolation and
origin, message spoofing, tool calls from UI without consent, `ui/message` as the user, links
with dangerous schemes, data egress through forms and frame navigation, fake consent UI.
Plus `mcp-app-lint`: SARIF rules for existing scanners, runnable in any CI. A GitHub composite
action (`action.yml`) runs it and uploads the SARIF to code scanning. Lives in its own repository.

Status: `mcp-app-lint` exists as a prototype in [`packages/mcp-app-lint`](packages/mcp-app-lint):
19 SARIF rules distilled from the census analyzer and a CLI over a package, a directory or the
JSON a server returned. A host conformance harness has started in [`conformance/`](conformance):
a reference for the CSP and `allow` attribute the specification makes a host build from
`_meta.ui`, with unit tests against the spec formula and a Chromium run that asserts the
browser enforces it (declared hosts reachable, undeclared blocked, restrictive default with no
metadata, `frame-src`/`object-src`/`base-uri` locked down, host and sandbox on different
origins). The full adversarial suite (sandbox-proxy message relay, tool-call consent,
`ui/message` spoofing) is not started.

## Ordering

For a team of one to three: the private disclosure that started this work, then the core
library, then the CSP census, then evil-mcp-app. Decision point on continuing: 5 April 2027,
against thresholds recorded in the plan.
