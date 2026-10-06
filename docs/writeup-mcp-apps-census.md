# What MCP Apps declare, and what hosts have to enforce: a census

*Draft, 6 October 2026. Numbers come from `census/SUMMARY.md` in this repository (registry snapshot, npm census and protocol census of 6 October 2026); the method and its limits are in `census/README.md`.*

## In one paragraph

MCP Apps let a server ship an interactive interface that a host renders in a sandboxed iframe. The specification puts almost all of the security work on the host: it must build a Content Security Policy from what the server declares, apply a no-network default when nothing is declared, prefer the policy delivered at read time over the one seen at listing time, and keep the sandbox on a separate origin. We measured what servers actually declare, twice: in the source of the 174 npm packages that depend on a UI SDK, and on the wire, by asking every reachable remote server in the official registry for its UI resources. Of 15,120 remote servers that answered, 654 serve UI resources. Their declared policies are mostly narrow: wildcards appear on 35 servers, a policy that allows every host on one. The gaps are elsewhere. On 18 servers the policy names a storage or tunnel host that reaches accounts anyone can create, so data can leave the sandbox for a stranger's bucket without breaking the CSP. On 203 servers at least one policy exists only in the `resources/read` result, so a host that reviews policies when it connects sees nothing to review. And the interfaces themselves are hand-written and render tool output through `innerHTML`: 466 of 833 live documents with a hand-written script pass a dynamic value to an HTML sink, on 211 servers. Under the specification's default `script-src 'unsafe-inline'`, an injected tool result that reaches one of those sinks unescaped runs as script inside the sandbox, with the app's tool surface as the blast radius.

## Why this matters

An MCP App is a `ui://` resource: an HTML document with the MIME type `text/html;profile=mcp-app`, referenced from a tool's `_meta.ui.resourceUri`. The host fetches it with `resources/read`, wraps it in a sandbox and talks to it over `postMessage`. Three things in the specification decide how safe that is, and all three are the host's job:

1. **CSP construction.** The server may declare `connectDomains`, `resourceDomains`, `frameDomains` and `baseUriDomains` under `_meta.ui.csp`. The host "MUST construct CSP headers based on declared domains" and "MUST NOT allow undeclared domains". If `ui.csp` is omitted, the host "MUST use" a default of `default-src 'none'` with `connect-src 'none'` and `img-src 'self' data:`; scripts and styles are `'self' 'unsafe-inline'`. `resourceDomains` widens `script-src`, `style-src`, `img-src`, `font-src` and `media-src`; `connectDomains` widens `connect-src`.
2. **Precedence.** Metadata may sit on the `resources/list` entry, on the `resources/read` content item, or both. "When `_meta.ui` is present on both, the content-item value takes precedence." A host that reviews policies at connection time is looking at the one that can be replaced at render time.
3. **Tool visibility.** A tool's `_meta.ui.visibility` defaults to `["model", "app"]`. Every tool is callable from the app unless the server says otherwise; the host must reject calls to tools that exclude `"app"`, and nothing in the specification requires consent for the ones that include it.

Hosts are being built now: the SDK package went from 1.4 million to 4.7 million weekly downloads between June and September 2026, and Claude, ChatGPT, VS Code and others render MCP Apps. Nobody had measured what the servers put in these fields. This census does.

## Method

- **Registry snapshot.** Every server in the official registry, latest version of each name (`GET /v0/servers?version=latest`), 6 October 2026.
- **Static census.** Candidate packages: the npm packages the registry names plus npm keyword searches (`mcp-apps`, `mcp-app`, `ext-apps`, `mcp-ui`). For every candidate the latest manifest; for every package that depends on a UI SDK (`@modelcontextprotocol/ext-apps`, `@mcp-ui/server`, `@mcp-ui/client`) the tarball, scanned for app resource registrations, `_meta.ui` domain lists and permissions (written as literals or through a constant in the same file), tool visibility, and the HTML of the UI resources (files and documents embedded in source).
- **Protocol census.** `initialize`, `resources/list`, `resources/read` of UI resources (up to ten per server) and `tools/list` against every streamable-http endpoint in the registry. Read-only: no tool was ever called, no credentials were sent, and servers that answered 401 or 403 were counted and left alone. The `_meta.ui` of the listing and of the read result are recorded separately and compared.
- **HTML analysis.** Inline scripts are linted with `eslint-plugin-render-policy`'s `no-unsafe-innerhtml`, which flags `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment` and `document.write` with non-static values; the document is searched for `postMessage(…, '*')`, inline event handlers, `eval`, forms that post, external hosts and hosts on a denylist of data sinks. Scripts are split into hand-written (short lines, few of them) and bundled, because bundles carry framework internals and the SDK's own bridge, which posts to `'*'` by design.
- **Sink hosts.** Hosts are checked against render-policy's denylist of services that exist to receive data. A storage or serverless host counts as a sink only when the entry reaches other people's accounts: the service host itself (`storage.googleapis.com` serves any bucket by path), a wildcard over the service's customers (`*.blob.core.windows.net`), or a path-style endpoint. One named account (`mycompany.blob.core.windows.net`) is reported separately; it reaches nobody else's storage while its owner keeps the name. Tunnels, request catchers and form builders count whoever owns the name.

Aggregates only. No server or package is named here or in the summary. Findings about specific servers go to their owners privately before publication.

## Findings

### The registry

| | |
| --- | --- |
| servers, latest version of each | 39,919 |
| with a remote endpoint | 25,060 (63%); 24,321 streamable-http, 1,078 legacy SSE |
| distributed as a package (stdio) | 16,349 (41%); npm 10,811, PyPI 4,235, MCPB 1,461, OCI 1,069, NuGet 138, Cargo 70 |

Remote servers are the majority and the ones a host connects to over the network with no code review in between. They are the population of the protocol census.

### Who ships an interface

| | |
| --- | --- |
| remote endpoints probed (streamable-http) | 24,321 |
| reachable and speaking MCP without credentials | 15,120 (6,126 more require authentication) |
| serving UI resources | 654 servers, 1,440 resources read (1,115 with the MCP Apps MIME type) |
| candidate npm packages examined | 10,419 |
| depending on a UI SDK | 174 (ext-apps 165, mcp-ui/server 13, mcp-ui/client 1) |
| serving UI resources | 146 (158 mention them; the rest are hosts, renderers and SDKs) |

The two populations barely overlap in character. The npm packages are the reusable servers and the SDK's own examples; the live servers are hosted services with an interface built for that one service; about a fifth of them (126) name their resources `ui://widget/…`, the convention of ChatGPT apps. Six hundred and fifty-four servers is a small share of the registry, and it is the share where declared policies matter most: none of these interfaces went through a host vendor's review.

### What packages declare

| | |
| --- | --- |
| declare any CSP domain list | 74 of 146 (51%); 2 of them only through lists built at runtime |
| with a wildcard host (`*.example.com`) | 10 (14% of declared) |
| allowing every host (a bare `*` or a scheme-only entry such as `https:`) | 5 |
| with an `http:` origin | 2, both loopback |
| naming a sink host anyone can use | 2 |
| requesting sandbox permissions | clipboardWrite 3, microphone 2, camera 1 |
| declaring a tool visibility that includes the app | 46 |

The 324 declared entries (133 distinct hosts) fall into these categories. The classification is heuristic, by well-known hosts and naming conventions; a package counts once per category.

| Category | Packages | Entries |
| --- | --- | --- |
| images and media | 10 | 46 |
| script and asset CDNs | 14 | 46 |
| maps and tiles | 5 | 41 |
| API endpoints | 6 | 41 |
| fonts | 4 | 16 |
| every host (`*`, `https:`) | 5 | 9 |
| analytics and telemetry | 3 | 8 |
| loopback (localhost, 127.0.0.1) | 2 | 7 |
| local schemes (`blob:`, `data:`) | 3 | 6 |
| object storage | 3 | 4 |
| sink denylist | 2 | 3 |
| other, mostly the vendor's own site | 13 | 97 |

Three readings of the 51%:

- **The default is doing the work.** Under the specification, the 72 packages that declare nothing get `connect-src 'none'` and `img-src 'self' data:`. Their interfaces cannot fetch anything. That is consistent with what the HTML shows: only 88 of 577 documents reference an external host, and those hosts are mostly fonts (28 documents) and script or asset CDNs (31), then map tiles (8) and an API host (2); the rest (32) are the vendor's own sites. A large share of the packaged MCP Apps are self-contained, and the restrictive default costs them nothing.
- **The pressure is on hosts to relax it.** An app that needs an API and forgot to declare it breaks on a compliant host and works on a lenient one. The census cannot see which hosts are lenient; the evil-mcp-app test suite in the roadmap will. Until then, "declares nothing" is safe only as long as hosts keep the default.
- **The declared lists are where the surface is.** Wildcards are rare, which is good news. The entries that allow every host are the ones to watch: a bare `*` in one package and a scheme-only `https:` in four others. `https:` is syntactically a valid CSP source and it allows every host on the web, including request catchers and tunnels. A host that expands declared entries into its CSP verbatim will honour it. Loopback origins also reach published packages: `http://localhost:*` and `http://127.0.0.1:*` appear in `connectDomains`, `resourceDomains` and `frameDomains`. For a tool that runs on the user's machine that can be intended; in a hosted server it is a development leftover. The two packages with a sink host both name `storage.googleapis.com`, which serves any bucket by path.

### What packaged interfaces do on their own

| | |
| --- | --- |
| HTML documents found | 577 (files and documents embedded in source) |
| with inline scripts | 358; 124 with a hand-written script, the rest bundles |
| hand-written scripts with a dynamic `innerHTML`-class sink | 12 of 124 documents (10%), in 9 packages; all 12 also have a value that does not go through an escaping helper |
| any script with such a sink, bundles included | 194 |
| `postMessage(…, '*')` in hand-written scripts | 33 (192 including bundles; the SDK bridge posts to `'*'` by design); 11 outside the app protocol |
| inline event handlers | 59 |
| `eval` or `new Function` in hand-written scripts | 0 (76 in bundles) |
| forms that post somewhere | 7 |
| a CSP meta tag of the document's own | 15 |
| referencing a sink host | 0 |

In packages, hand-written interface code is the minority and mostly careful. Most hand-written `postMessage(…, '*')` calls are the app protocol itself, a JSON-RPC or mcp-ui message to the parent frame, which is how a sandboxed app has to talk to a host whose origin it does not know; 11 documents post something else to `'*'`. The live servers are a different picture.

### Live policies, list versus read, tools as served

Every measure below is from the protocol census: what 654 servers returned for 1,440 UI resources. Each row counts resources and, in parentheses, the servers with at least one.

**Live servers declare more than packages do, and mostly narrowly.**

| | resources (servers) |
| --- | --- |
| declaring a CSP, on list or read | 1,032 of 1,440, 72% (474 of 654) |
| of which every domain list is empty | 280 (162) |
| with a wildcard host | 87 (35) |
| allowing every host (`*` or scheme-only) | 2 (1) |
| with an `http:` origin | 1 (1) |
| naming a sink host anyone can use | 43 (18) |
| naming one account on a storage or serverless service | 74 (27) |

Seventy-two percent declare a policy, against 51% of packages; more than a quarter of those declarations (280) are empty lists, the same as the default. A hosted product that loads its own images and API needs a policy to work on a compliant host, and most of them have one. Development origins, which reach published packages, do not appear in any live policy, and the widest entries are rare: one server allows every host.

What the enforced policies allow, by category of host (the read-time policy when it carries one, otherwise the listing's):

| Category | resources (servers) | entries |
| --- | --- | --- |
| script and asset CDNs | 276 (91) | 451 |
| images and media | 150 (59) | 227 |
| object storage | 106 (49) | 125 |
| API endpoints | 94 (30) | 217 |
| fonts | 57 (23) | 112 |
| maps and tiles | 41 (13) | 112 |
| sink denylist | 43 (18) | 47 |
| analytics and telemetry | 13 (2) | 13 |
| every host | 2 (1) | 3 |
| other, mostly the vendor's own hosts | 624 (266) | 1,803 |

**The sink entries are storage, not request catchers.** No live policy names a request catcher, an OAST service or a form builder. The 18 servers with a sink host anyone can use list either the storage service host itself (`storage.googleapis.com`, `s3.amazonaws.com` and its regional forms, which serve any bucket by path), a wildcard over a storage provider's customers (`*.blob.core.windows.net`, `*.s3.amazonaws.com`) or over a whole cloud provider (`*.amazonaws.com`, which covers every bucket), or a wildcard over a tunnel service left over from development. Each of these is a channel to an account anyone can create: content injected into the interface can send what the interface shows to the attacker's own bucket, by `fetch` where `connectDomains` allows it or by an image URL where `resourceDomains` does, and the CSP the host built will allow it. The fix is one line per entry: name the bucket's own host. Another 27 servers name a single account on such a service, presumably their own; that is not a channel to a stranger, as long as the name is not abandoned and claimed by someone else.

**List versus read: the policy is usually only at read time.**

| | resources (servers) |
| --- | --- |
| `_meta.ui` present on list, read or both | 1,074 (503) |
| list and read differ | 496 (227) |
| only the read result carries `_meta.ui` | 436 (203) |
| only the listing carries it | 32 (17) |
| both carry it, with different values | 28 (11) |
| read wider than list | 6 (2) |

The specification makes the read-time policy win, and most servers put the policy only there: on 203 servers at least one interface has `_meta.ui` in the read result and none in the listing. A host that inspects `resources/list` at connection time, to show the user what an app may reach or to apply an organisation's allowlist, sees no policy for those interfaces at all; the one that will be enforced arrives with the document. Where both carry a policy and they differ, the read result is wider in six resources on two servers. In both cases the addition is the server's own origin, which is harmless. The pattern a connection-time review cannot catch, a narrow policy in the listing and a wide one at render, is possible by design and was not seen in this snapshot. A host that wants the review to mean something has to repeat it on every read.

**The interfaces render tool output through `innerHTML`.**

| | resources (servers) |
| --- | --- |
| HTML documents read | 1,380 (633) |
| with a hand-written inline script | 833 (412) |
| hand-written script with a dynamic `innerHTML`-class sink | 466 (211) |
| any script with such a sink, bundles included | 810 (336) |
| `postMessage(…, '*')` in a hand-written script | 468 (238) |
| inline event handlers | 144 (58) |
| `eval` or `new Function` in a hand-written script | 0 |
| a CSP meta tag of the document's own | 153 (75) |
| referencing a sink host | 1 (1) |

This is the largest difference between the two censuses. Ten percent of hand-written documents in packages pass a dynamic value to an HTML sink; on live servers it is 56% (466 of 833), on 211 servers. Live interfaces tend to be written per service and by hand, and the shortest way to show a tool result in a hand-written widget is a template string assigned to `innerHTML`. The documents are not copies of one template; they are spread over 211 servers.

The count is an upper bound on what is injectable. The lint rule flags every non-static value, including values the code escapes first (the live scans were not split by escaping helper, unlike the package scan), and the census does not execute anything. What it does show is where the burden sits: in those 466 documents, the only thing between a tool result and script running in the sandbox is whether each template escapes each field. The specification's default `script-src 'unsafe-inline'` means the CSP will not catch a miss, and an `<img onerror>` inside a product name, a review or a web page the agent summarised is enough. The sandbox keeps the script away from the host page; it does not keep it away from the app's tools.

**Tools the app can call.** The 654 servers expose 10,716 tools. Counting only the tools that carry `_meta.ui`, which is a lower bound, 2,267 are visible to the app, explicitly or by the default, and only 110 are app-only. Of the app-visible ones, 603 on 194 servers (30% of the servers with an interface) have no `readOnlyHint`: injected script in the interface can call them with the user's session, and the specification asks the host to reject only calls to tools the app cannot see.

## What follows

For hosts:

- Build the CSP from the `resources/read` metadata, every time; a policy reviewed at connection time is not the policy you enforce, and for most servers there is nothing to review at connection time.
- Treat scheme-only entries (`https:`, `http:`) and bare `*` as errors, not as domains. Refuse `http:` origins. Check declared hosts against a sink denylist, including the service hosts and wildcards of object storage, and ask the user before allowing a match.
- Keep the restrictive default. It is what most packaged apps already run under.
- Log the CSP you constructed, as the specification suggests; it is the only audit trail an app's network access has.
- Ask before letting an app call a tool without `readOnlyHint`. The specification only mandates rejecting calls to tools the app cannot see.

For servers:

- Declare the domains you use, exactly. For object storage, name your bucket's own host (`mybucket.storage.googleapis.com`, `myaccount.blob.core.windows.net`), not the service host or a wildcard over its customers.
- Do not build the interface with `innerHTML` from tool results. Render Markdown and HTML through a policy (that is what `@render-policy/core` is for), or use `textContent`.
- Leave development origins and tunnels out of published metadata.

For the specification:

- `script-src 'unsafe-inline'` in the default policy makes every injection in an app a script. Apps could ship a hash or nonce; the sandbox could at least offer a strict variant.
- A validation rule for domain entries (scheme plus host, no scheme-only sources, no `*`) would remove the widest declarations at the source.
- Asking servers to put `_meta.ui` on the listing as well, and hosts to flag a read-time policy wider than the listed one, would make connection-time review possible.

## Reproduce

```
git clone https://github.com/shteynu/render-policy && cd render-policy
npm ci && npm run build
npm run census:registry
npm run census:npm
npm run census:remote      # from a machine with ordinary outbound access
npm run census:report
```

The analyzer, the SARIF rules derived from it (`mcp-app-lint`), and the evil-Markdown corpus are in the same repository.

## Definitions

- *Serves UI resources*: the package source registers an app resource, sets the `text/html;profile=mcp-app` MIME type or a `ui://` URI on a resource, or writes a CSP domain list. *Mentions UI resources*: the source names that MIME type or a `ui://` URI anywhere, which hosts, renderers and SDKs also do. For live servers: `resources/list` returns a `ui://` resource or one with the MCP Apps MIME type.
- *Declares a CSP*: at least one of `connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains` is written in the source as a literal array, through a constant defined in the same file, or as a list built at runtime (counted as declared, entries unknown); for live servers, it appears in `_meta.ui.csp` of the listing or the read result.
- *Wildcard*: a host entry containing `*`; *scheme-only*: an entry such as `https:` with no host.
- *Sink host anyone can use*: a host on the render-policy denylist of services that exist to receive data (request catchers, tunnels, anonymous serverless endpoints, form builders, public object storage), where the entry reaches accounts other than one named customer's.
- *Hand-written script*: an inline script with no line over 2,000 characters, an average line under 200 and fewer than 3,000 lines.
- *Dynamic `innerHTML`-class sink*: an assignment to `innerHTML`/`outerHTML`, a call to `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment` or `document.write`, whose value is not a static string. *Unescaped*: some dynamic part of that value is not the result of a known escaping helper (`escapeHtml`, `esc`, `DOMPurify.sanitize` and similar); measured for packages only.
- *App protocol message*: a `postMessage` to `parent` or `top` whose payload is a JSON-RPC message or an mcp-ui message type.
