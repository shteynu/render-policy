# What MCP Apps declare, and what hosts have to enforce: a census

*Draft, 30 September 2026. Numbers come from `census/SUMMARY.md` in this repository; the method and its limits are in `census/README.md`. The protocol census over live servers has not run yet; the section that depends on it is marked.*

## In one paragraph

MCP Apps let a server ship an interactive interface that a host renders in a sandboxed iframe. The specification puts almost all of the security work on the host: it must build a Content Security Policy from what the server declares, apply a no-network default when nothing is declared, prefer the policy delivered at read time over the one seen at listing time, and keep the sandbox on a separate origin. We measured what servers actually declare. Of 37,759 servers in the official registry, 168 npm packages depend on a UI SDK and 153 of them ship UI resources. Only 39% of those declare any CSP domain list; the rest fall under the specification's restrictive default, which means no network at all if the host follows the rules. Where lists are declared, wildcards are rare (10%), four packages allow every host (a bare `*` or a scheme-only `https:` entry), two allow `http:` origins, one names a host on a data-sink denylist. In the HTML of the interfaces themselves, 17% of hand-written inline scripts build DOM through `innerHTML` with dynamic values, which under the specification's default `script-src 'unsafe-inline'` turns any injected tool result into script running inside the sandbox, with the app's tool surface as the blast radius.

## Why this matters

An MCP App is a `ui://` resource: an HTML document with the MIME type `text/html;profile=mcp-app`, referenced from a tool's `_meta.ui.resourceUri`. The host fetches it with `resources/read`, wraps it in a sandbox and talks to it over `postMessage`. Three things in the specification decide how safe that is, and all three are the host's job:

1. **CSP construction.** The server may declare `connectDomains`, `resourceDomains`, `frameDomains` and `baseUriDomains` under `_meta.ui.csp`. The host "MUST construct CSP headers based on declared domains" and "MUST NOT allow undeclared domains". If `ui.csp` is omitted, the host "MUST use" a default of `default-src 'none'` with `connect-src 'none'` and `img-src 'self' data:`; scripts and styles are `'self' 'unsafe-inline'`.
2. **Precedence.** Metadata may sit on the `resources/list` entry, on the `resources/read` content item, or both. "When `_meta.ui` is present on both, the content-item value takes precedence." A host that reviews policies at connection time is looking at the one that can be replaced at render time.
3. **Tool visibility.** A tool's `_meta.ui.visibility` defaults to `["model", "app"]`. Every tool is callable from the app unless the server says otherwise; the host must reject calls to tools that exclude `"app"`, and nothing in the specification requires consent for the ones that include it.

Hosts are being built now: the SDK package went from 1.4 million to 4.7 million weekly downloads between June and September 2026, and Claude, ChatGPT, VS Code and others render MCP Apps. Nobody had measured what the servers put in these fields. This census does.

## Method

- **Registry snapshot.** Every server in the official registry, latest version of each name (`GET /v0/servers?version=latest`), 30 September 2026.
- **Static census.** Candidate packages: the npm packages the registry names plus npm keyword searches (`mcp-apps`, `mcp-app`, `ext-apps`, `mcp-ui`). For every candidate the latest manifest; for every package that depends on a UI SDK (`@modelcontextprotocol/ext-apps`, `@mcp-ui/server`, `@mcp-ui/client`) the tarball, scanned for app resource registrations, `_meta.ui` domain lists and permissions written as literals, tool visibility, and the HTML of the UI resources (files and documents embedded in source).
- **HTML analysis.** Inline scripts are linted with `eslint-plugin-render-policy`'s `no-unsafe-innerhtml`, which flags `innerHTML`, `outerHTML`, `insertAdjacentHTML` and `document.write` with non-static values; the document is searched for `postMessage(…, '*')`, inline event handlers, `eval`, forms that post, external hosts and hosts on a denylist of data sinks. Scripts are split into hand-written (short lines, few of them) and bundled, because bundles carry framework internals and the SDK's own bridge, which posts to `'*'` by design.
- **Protocol census** (pending): `initialize`, `resources/list`, `resources/read` of UI resources, `tools/list` against the registry's remote endpoints, read-only, no tool ever called. It measures the live policy, the list-versus-read difference and tool visibility as served.

Aggregates only. No server or package is named here or in the summary; a dangerous finding about a specific server goes to its owner first.

## Findings

### The registry

| | |
| --- | --- |
| servers, latest version of each | 37,759 |
| with a remote endpoint | 23,358 (62%); 22,618 streamable-http, 1,077 legacy SSE |
| distributed as a package (stdio) | 15,795 (42%); npm 10,462, PyPI 4,101, MCPB 1,377, OCI 1,027, NuGet 135, Cargo 64 |

Remote servers are the majority and the ones a host connects to over the network with no code review in between. They are also the population the protocol census will cover.

### Who ships an interface

| | |
| --- | --- |
| candidate npm packages examined | 10,077 |
| depending on a UI SDK | 168 (ext-apps 159, mcp-ui/server 13, mcp-ui/client 1) |
| declaring UI resources | 153 |

UI adoption among published servers is still small in absolute terms. The SDK's download numbers say the hosts and their bundled examples account for most of the volume; the long tail of servers with an interface is a few hundred packages, which is exactly the population where declared policies matter most, because none of them went through a host vendor's review.

### What they declare

| | |
| --- | --- |
| declare any CSP domain list | 60 of 153 (39%) |
| with a wildcard host (`*.example.com`) | 6 (10% of declared) |
| allowing every host (a bare `*` or a scheme-only entry such as `https:`) | 4 |
| with an `http:` origin | 2 |
| naming a host on the sink denylist | 1 |
| requesting sandbox permissions | clipboardWrite 3, microphone 1 |
| setting tool visibility explicitly | 46 |

The 211 declared entries (93 distinct hosts) fall into these categories. The classification is heuristic, by well-known hosts and naming conventions; a package counts once per category.

| Category | Packages | Entries |
| --- | --- | --- |
| maps and tiles | 5 | 41 |
| API endpoints | 4 | 38 |
| script and asset CDNs | 10 | 34 |
| images and media | 7 | 33 |
| fonts | 3 | 12 |
| development leftovers (localhost, 127.0.0.1, `blob:`) | 2 | 12 |
| analytics and telemetry | 3 | 8 |
| every host (`*`, `https:`) | 4 | 8 |
| object storage | 2 | 2 |
| sink denylist | 1 | 1 |
| other, mostly the vendor's own site | 7 | 22 |

Three readings of the 39%:

- **The default is doing the work.** Under the specification, the 93 packages that declare nothing get `connect-src 'none'` and `img-src 'self' data:`. Their interfaces cannot fetch anything. That is consistent with what the HTML shows: only 88 of 596 documents reference an external host, and those hosts are mostly fonts (28 documents) and script or asset CDNs (31), then map tiles (8) and an API host (2); the rest (32) are the vendor's own sites. A large share of today's MCP Apps are self-contained, and the restrictive default costs them nothing.
- **The pressure is on hosts to relax it.** An app that needs an API and forgot to declare it breaks on a compliant host and works on a lenient one. The census cannot see which hosts are lenient; the evil-mcp-app test suite in the roadmap will. Until then, "declares nothing" is safe only as long as hosts keep the default.
- **The declared lists are where the surface is.** Wildcards are rare, which is good news. The entries that allow every host are the ones to watch: a bare `*` in one package and a scheme-only `https:` in three others. `https:` is syntactically a valid CSP source and it allows every host on the web, including request catchers and tunnels. A host that expands declared entries into its CSP verbatim will honour it. Development leftovers also reach published packages: `frameDomains` with `blob:` and `http://127.0.0.1:*` appear in the data.

### What the interfaces do on their own

| | |
| --- | --- |
| HTML documents found | 596 (files and documents embedded in source) |
| with inline scripts | 373; 144 with a hand-written script, the rest bundles |
| hand-written scripts with a dynamic `innerHTML`-class sink | 24 of 144 (17%) |
| any script with such a sink, bundles included | 205 |
| `postMessage(…, '*')` in hand-written scripts | 32 (189 including bundles; the SDK bridge posts to `'*'` by design) |
| inline event handlers | 59 |
| `eval` or `new Function` in hand-written scripts | 0 (76 in bundles) |
| forms that post somewhere | 7 |
| a CSP meta tag of the document's own | 15 |
| referencing a sink host | 0 |

The `innerHTML` figure is the one that matters. An MCP App renders tool results: text that came from the model, from a web page the agent read, from a document a user uploaded. Seventeen percent of the hand-written scripts put such values into `innerHTML`. The specification's default CSP allows `script-src 'unsafe-inline'`, so the classic `<img onerror>` in a tool result runs inside the sandbox. The sandbox is on a different origin from the host, which stops the injection from reaching the host page; it does not stop it from calling the server's app-visible tools, reading whatever the app holds, or steering the user, and the same `'unsafe-inline'` default means a CSP will not catch it. This is the class of bug our render-policy corpus was built for, and it is not exotic here.

The `postMessage('*')` count in hand-written code is smaller than the bundle count suggests but not zero. Inside the sandbox design the app legitimately does not know the host's origin, which is why the SDK does it; the 32 hand-rolled instances are the ones that may also be sending data the SDK would not.

### Live policies, list versus read, tools as served

*Pending the protocol census. This section will report, for the reachable remote servers: the share that declares a CSP as served, wildcards and sink hosts in live policies, how often `resources/read` carries a different policy than `resources/list` and how often it is wider, and how many servers expose side-effecting tools (no `readOnlyHint`) to the app.*

## What follows

For hosts:

- Build the CSP from the `resources/read` metadata, every time; a policy reviewed at connection time is not the policy you enforce.
- Treat scheme-only entries (`https:`, `http:`) and bare `*` as errors, not as domains. Refuse `http:` origins. Check declared hosts against a sink denylist and ask the user before allowing a match.
- Keep the restrictive default. It is what most published apps already run under.
- Log the CSP you constructed, as the specification suggests; it is the only audit trail an app's network access has.
- Ask before letting an app call a tool without `readOnlyHint`. The specification only mandates rejecting calls to tools the app cannot see.

For servers:

- Declare the domains you use, exactly. An app that works only on lenient hosts will stop working.
- Do not build the interface with `innerHTML` from tool results. Render Markdown and HTML through a policy (that is what `@render-policy/core` is for), or use `textContent`.
- Leave development origins out of published metadata.

For the specification:

- `script-src 'unsafe-inline'` in the default policy makes every injection in an app a script. Apps could ship a hash or nonce; the sandbox could at least offer a strict variant.
- A validation rule for domain entries (scheme plus host, no scheme-only sources, no `*`) would remove the widest declarations at the source.

## Reproduce

```
git clone https://github.com/shteynu/render-policy && cd render-policy
npm ci && npm run build
npm run census:registry
npm run census:npm
npm run census:remote      # from a machine with ordinary outbound access
npm run census:report
```

The analyzer, the SARIF rules derived from it, and the evil-Markdown corpus are in the same repository.

## Definitions

- *Declares UI resources*: the package source registers an app resource, mentions the `text/html;profile=mcp-app` MIME type or a `ui://` URI.
- *Declares a CSP*: at least one of `connectDomains`, `resourceDomains`, `frameDomains`, `baseUriDomains` appears as a literal array in the source.
- *Wildcard*: a host entry containing `*`; *scheme-only*: an entry such as `https:` with no host.
- *Sink host*: a host on the render-policy denylist of services that exist to receive data (request catchers, tunnels, anonymous serverless endpoints, form builders, public object storage).
- *Hand-written script*: an inline script with no line over 2,000 characters, an average line under 200 and fewer than 3,000 lines.
- *Dynamic `innerHTML`-class sink*: an assignment to `innerHTML`/`outerHTML`, a call to `insertAdjacentHTML`, `setHTMLUnsafe`, `createContextualFragment` or `document.write`, whose value is not a static string.
