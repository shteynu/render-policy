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

- [ ] core, Angular and React adapters and the ESLint plugin published on npm as v0.1 (`.github/workflows/release.yml` attaches the tarballs to a GitHub release on every `v*` tag and publishes to npm once `NPM_TOKEN` is set)
- [x] every advisory class in the table has a test
- [x] the streaming render makes no request to an unclosed or unchecked URL (unit + browser)
- [x] demo of the same hostile markup with and without the policy
- [x] documentation: threat model, modes, migration
- [x] React adapter (planned for December 2026, done early: `@render-policy/react`)

Also planned for the core:

- [x] streaming v1: keep settled blocks, replace only from the first changed node (`patchChildren`)
- [x] streaming v2: re-parse only the unsettled Markdown tail instead of the whole buffer (`npm run bench`: a push on a 64 kB reply went from 16 ms to 1 ms; equivalence with the whole-buffer render is a fast-check property)
- [x] an evil-Markdown corpus other renderers can run (`corpus/`, 49 cases, reference results in `corpus/RESULTS.md`)
- [ ] image proxy guidance (SSRF-safe) for `rewriteImageUrl`

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
access. Results so far ([`census/SUMMARY.md`](census/SUMMARY.md), snapshot of 30 Sep 2026): 37,759 servers
in the registry, 62% with a remote endpoint; 168 npm packages depend on a UI SDK, 153 declare UI
resources, 39% of those declare any CSP domain list; 596 UI HTML documents analyzed. The protocol
census over the 22,618 streamable-http remotes still has to run from a machine with ordinary
outbound access. A draft publication built on these numbers is in
[`docs/writeup-mcp-apps-census.md`](docs/writeup-mcp-apps-census.md); its live-policy section
waits for that run.

## Stage 4: evil-mcp-app and rules for MCP scanners (30 Nov 2026 – 29 Jan 2027)

A Playwright suite with a malicious MCP server that grades any MCP Apps host: isolation and
origin, message spoofing, tool calls from UI without consent, `ui/message` as the user, links
with dangerous schemes, data egress through forms and frame navigation, fake consent UI.
Plus `mcp-app-lint`: SARIF rules for existing scanners, runnable in any CI. A GitHub composite
action (`action.yml`) runs it and uploads the SARIF to code scanning. Lives in its own repository.

Status: `mcp-app-lint` exists as a prototype in [`packages/mcp-app-lint`](packages/mcp-app-lint):
18 SARIF rules distilled from the census analyzer and a CLI over a package, a directory or the
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
