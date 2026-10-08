# render-policy: working notes for Claude Code sessions

Start with `TODO.md`: the maintainer's task list (in Russian) with the exact commands for the next steps.

Safe rendering of agent-generated Markdown/HTML. Monorepo, npm workspaces, ESM only.
The action plan lives in a private Claude Doc (link in ROADMAP.md); this repository mirrors its
technical part. Documentation is written in English; the maintainer communicates in Russian.

## Layout

- `packages/core`: `@render-policy/core`. Sanitize (DOMPurify) into a DocumentFragment, policy
  (modes, image hosts, sink denylist, URL heuristics; one Trusted Types policy `dompurify` per window, shared by all sanitizers), URL checks in `url-guard.ts` (shared by the sanitizer and the
  public `createUrlGuard`), streaming (`stream.ts`, whole-buffer render + tail `patchChildren`;
  incremental re-parse of only the unsettled tail was attempted and reverted, see ROADMAP streaming v2), transforms hook,
  `createContentBinding` (the lifecycle adapters share). `src/index.ts` is the public API; building blocks go to `src/internal.ts`
  (`@render-policy/core/internal`, not semver). Every journal entry has a stable `code`. Tests: vitest + jsdom.
- `packages/eslint-plugin`: `eslint-plugin-render-policy`. Rules `no-unsafe-innerhtml` (JS/TS/JSX)
  and `no-innerhtml-binding` (Angular templates, needs `@angular-eslint/template-parser`).
- `packages/react`: `@render-policy/react`. Provider, hook, `<RpMarkdown>`, `<RpHtml>`. Tests with react-dom/client + act.
- `packages/angular`: `@render-policy/angular`. Built with ng-packagr (partial compilation); TypeScript 6.0 is
  installed nested in this package because Angular 22 needs it, the workspace root uses TypeScript 7.
  Unit tests with TestBed (vitest + jsdom) run over the built FESM, not the source: JIT from source does not see
  signal inputs, so `npm test -w packages/angular` needs core and angular built first.
  Runtime proof in `packages/angular/e2e` (JIT app over the FESM, Playwright).
- `packages/mermaid`: `@render-policy/mermaid`. Strict Mermaid as a fragment transform; unit tests with a fake
  mermaid, browser proof with the real one in `packages/mermaid/e2e`.
- `packages/a2ui`: `@render-policy/a2ui`. The policy for A2UI v0.9 surfaces: `createA2uiGuard` checks resolved
  URL values (image, video, audio, icon, `openUrl`) through core's `createUrlGuard` and renders `Text` in a strict
  mode (no HTML, images, links); `createA2uiMarkdownRenderer` fits the A2UI renderers' string plug-in. Unit tests
  alias core's `src`; browser proof in `packages/a2ui/e2e` (a minimal v0.9 surface, guarded and unguarded).
- `packages/mcp-app-lint`: `mcp-app-lint`. Plain ESM with JSDoc types, checked by `tsc` (`checkJs`); its `build` only
  emits declarations to `dist/` and compiles `test/types/consumer.ts` against them. The census analyzer (`analyze.mjs`, `domains.mjs`,
  `npm.mjs`) plus SARIF rules (`rules.mjs`, `lint.mjs`, `sarif.mjs`), A2UI message rules (`a2ui.mjs`, `--a2ui`) and a CLI (`cli.mjs`, SARIF paths are made
  repo-relative for code scanning). It `require`s the built `dist` of core and eslint-plugin, so build before its
  tests. Tests with `node:test` (`test/*.test.mjs`, run by root `npm test`). The repo-root `action.yml` is a
  composite GitHub Action that runs the CLI and uploads SARIF to code scanning.
- `plugins/render-policy/`: Claude Code plugin, two skills (`safe-agent-html`, `mcp-app-csp`) that point Claude
  at the packages and the linter; listed by `.claude-plugin/marketplace.json` at the repository root.
- `e2e/`: browser proofs (`run.mjs` core, `url-parity.mjs` URL classification vs Chromium, `site.mjs` Pages build,
  `bench.mjs` render timings) and the shared harness `e2e/lib/harness.mjs`.
- `corpus/`: evil-Markdown corpus (`evil-markdown.json`) and A2UI cases (`evil-a2ui.json`, on the shared minimal surface
  `lib/a2ui-surface.js`), runner and reference adapters; `corpus/RESULTS.md` is a committed snapshot.
- `demo/`: the naive-vs-policy demo; `demo/build.mjs` produces `site/` for GitHub Pages.
- `conformance/`: MCP Apps host conformance. `host.mjs` is a reference for the CSP and `allow` attribute the spec
  makes a host build from `_meta.ui`; `host.test.mjs` checks it against the spec formula; `run.mjs` is a Chromium
  proof that the browser enforces the built policy. `npm run conformance`; folded into `npm run check` and CI.
- `census/`: MCP Apps UI census (registry snapshot, static npm census, protocol census, report). The analysis
  code is imported from `mcp-app-lint`; the report re-classifies domain lists from the raw entries kept in each
  scan, so a classifier change shows up on `npm run census:report` without a rescan. Tests with `node:test`
  (`npm run test:census`). `census/data/` is not committed except `summary.json`; `SUMMARY.md` is aggregates
  only and never names a server or package.

## Commands

```
npm ci
npm run check          # typecheck, unit tests, build, all browser proofs, corpus (the CI gate)
npm run typecheck | npm test | npm run build
npm run e2e            # needs Chromium: Playwright's own, or RP_CHROMIUM=/path/to/chrome
npm run corpus         # fails if @render-policy/core fails any corpus case
npm run corpus:results # regenerates corpus/RESULTS.md
npm run demo:build     # site/
npm run test:census    # census analyzer and client tests (node:test)
npm run census:registry | census:npm | census:remote | census:report
npm run size           # bundle sizes (esbuild + gzip/brotli), after a build
npm run bench          # render timings in Chromium; writes e2e/output/bench.json
npx mcp-app-lint --dir packages/x --format text   # the scanner on a package directory
npm test -w packages/core         # one package (vitest's own -w means watch; use npm's)
```

Build order matters: core first (others resolve `@render-policy/core` through the workspace link to its `dist`).
Unit tests of react/mermaid/a2ui alias `@render-policy/core` to core's `src`, so they run without a build.

## Rules that are not negotiable

- Library code never assigns `innerHTML`/`outerHTML`, never calls `insertAdjacentHTML` or `document.write`.
  Sanitize to a fragment, insert with `replaceChildren()`. Tests and the ESLint rule enforce it.
- Sanitization runs last, on the final HTML. Transforms run on sanitized fragments and are trusted code.
- Application code (`rewriteImageUrl`, transforms, Markdown renderer) may throw; the render never aborts,
  the failure becomes a journal entry with a code. Keep it that way when adding hooks.
- Adapters do not implement the stream lifecycle themselves; they wrap `createContentBinding`.
- Do not name the vendor, product or advisory of the private disclosure that started this work, nor any
  unfixed third-party issue, anywhere in this repository until the fix or the agreed disclosure date.
  Ecosystem names (MCP Apps, AG-UI, A2UI) and documented defaults of public libraries are fine.
- The corpus never names a renderer that fails a case before its maintainers had a chance to fix it.
- Every behavioural change ships with a test at the right level: jsdom for logic, Chromium for anything
  involving execution, network or Trusted Types. `npm run check` must stay green before a push.
- Commit messages: imperative subject, body explains what and why per package.

## Publishing

`git tag v0.1.0 && git push origin v0.1.0` runs `.github/workflows/release.yml`: checks, version/tag
match, tarballs attached to the GitHub release, npm publish through trusted publishing (OIDC, no token
secret, provenance added by npm). Every package trusts `shteynu/render-policy` + `release.yml` on npmjs.com;
a new package needs `npm trust github <pkg> --repo shteynu/render-policy --file release.yml --allow-publish`
(npm 11.10+) after its first manual publish. The Angular package publishes from `packages/angular/dist`.
Scoped packages live in the `render-policy` npm organisation. GitHub Pages must be enabled with source "GitHub Actions" for `pages.yml` to deploy.
The Claude Code plugin (`plugins/render-policy`, marketplace file `.claude-plugin/marketplace.json`) has the
same version as the packages; `release.yml` fails the tag otherwise. Its skills never run a package
launcher (`npx`): Anthropic's plugin directory flags download-and-run commands. Check it with `claude plugin validate ./plugins/render-policy` and `claude plugin validate .`.
