# mcp-app-lint

SARIF findings about what an MCP App declares and what its HTML does. Meant to be run by MCP
scanners and CI, or by hand on a package, a directory, or the JSON a server returned.

```
npx mcp-app-lint --url https://example.com/mcp        # a running server over Streamable HTTP
npx mcp-app-lint --stdio "node dist/server.js"        # a local server, started as a process
npx mcp-app-lint --dir ./my-server                    # a package directory, built or source
npx mcp-app-lint --package @scope/name                # an npm package: downloaded, scanned, deleted
npx mcp-app-lint --read read.json --list list.json --tools tools.json
                                                      # saved results of resources/read, resources/list, tools/list
npx mcp-app-lint --html app.html                      # one UI document
npx mcp-app-lint --a2ui stream.jsonl                  # A2UI v0.9 messages: one, a JSON array, { messages } or JSONL
npx mcp-app-lint --html dist/app.html --suggest-csp   # the _meta.ui.csp the document needs
npx mcp-app-lint --mcp                                # run as an MCP server over stdio (see below)
```

Options: `--out file.sarif`, `--format sarif|text`, `--fail-on error|warning|note|none` (default
`error`; the exit code is 1 when a finding reaches the threshold, 2 on usage errors and on a
server that cannot be reached), `--header "Name: value"` (repeatable, for `--url`), `--timeout ms`
(per request to a live server, default 20000), `--suggest-csp`.

## A running server

`--url` and `--stdio` ask the server what it publishes, the same way a host does: `initialize`,
`resources/list`, `resources/read` for every UI resource (`text/html` or `ui://`), `tools/list`.
They never call a tool. Findings point at the resource (`ui://…`) or at `tools/list`, and a summary
of what was read goes to stderr, so stdout stays a clean SARIF log.

```
npx mcp-app-lint --url https://example.com/mcp --header "Authorization: Bearer $TOKEN" --format text
npx mcp-app-lint --stdio "node dist/index.js --stdio" --format text
```

`--url` speaks Streamable HTTP (JSON or SSE answers, session header, a `DELETE` to end the session).
A 401 or 403 means the server wants credentials: pass them with `--header`. `--stdio` runs the
command through the shell in the current directory, keeps the server's stderr out of the output
(its last lines go into the error if it exits), answers its `ping`, and closes stdin when done. The
SARIF log records the command line with header values, URL credentials and query values, and
`NAME=value` assignments in the `--stdio` command masked, since code scanning stores it.

## Suggested CSP

`--suggest-csp` prints, instead of findings, the `_meta.ui.csp` each UI document needs, as JSON
keyed by document (or one block per document with `--format text`):

```json
{
  "ui://weather/view": {
    "connectDomains": ["https://api.weather.example", "wss://live.weather.example"],
    "resourceDomains": ["https://fonts.googleapis.com", "https://fonts.gstatic.com", "https://img.weather.example"]
  }
}
```

The keys follow the host formula in the specification: `connectDomains` for `fetch`, `WebSocket`,
`EventSource`, XHR and `sendBeacon`; `resourceDomains` for scripts (including module imports from a
URL), stylesheets and CSS `url()`/`@import`, images (`src`, `srcset`, `poster`) and media;
`frameDomains` for iframes. Links (`<a href>`, `rel="canonical"`, `preconnect`) need nothing. A
Google Fonts stylesheet brings `fonts.gstatic.com` with it. It is static: a URL the script assembles
at run time is not seen, so run it on the built document and add such hosts by hand. `null` means
the document references no external origin and the restrictive default fits it. MCPAPP001 carries
the same suggestion in its message and in `properties.suggestedCsp`.

## Use in CI (GitHub code scanning)

This repository ships a composite action that runs the scanner and uploads the SARIF to code
scanning, so findings appear in the Security tab and on pull requests:

```yaml
# .github/workflows/mcp-app-lint.yml
name: mcp-app-lint
on: [push, pull_request]
permissions:
  contents: read
  security-events: write   # required for the SARIF upload
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: shteynu/render-policy@v1
        with:
          directory: .
          fail-on: error     # error | warning | note | none
```

Inputs: `directory` (default `.`), `fail-on` (default `error`), `upload-sarif` (default `true`),
`sarif-file` (default `mcp-app-lint.sarif`), `version` (npm dist-tag or version, default `latest`),
`args` (passed through), `node-version` (default `22`, empty to use the runner's Node). The SARIF
is written even when findings fail the job, so it still uploads; paths are repo-relative so code
scanning maps them to the source. Recorded A2UI streams go through `args`, for example
`args: --a2ui test/fixtures/surface.jsonl`.

Any CI can run the CLI directly and read the exit code (`0` clean, `1` findings at or above
`--fail-on`, `2` usage error):

```
npx mcp-app-lint --dir . --format sarif --out mcp-app-lint.sarif --fail-on error
```

## Rules

| Id | Name | Level | What it means |
| --- | --- | --- | --- |
| MCPAPP001 | csp-missing | warning | no `ui.csp`, but the UI loads from or calls an external host (an attribute such as `src`/`href`, or an absolute URL in `fetch`, `WebSocket`, `EventSource`, XHR, `sendBeacon`, `import()`); a compliant host applies `default-src 'none'`, `connect-src 'none'` and blocks it. A self-contained UI needs no CSP and is not reported. For a package: it serves a UI resource, no domain list is found (literal or built at runtime), and one of its HTML documents references a host |
| MCPAPP002 | csp-allows-every-host | error | `*` or a scheme-only entry (`https:`) expands to every host |
| MCPAPP003 | csp-wildcard-host | warning | `*.example.com` allows every subdomain |
| MCPAPP004 | csp-insecure-scheme | warning | `http:` origin other than loopback |
| MCPAPP005 | csp-sink-host | error | host on the sink denylist that reaches accounts anyone can create: request catchers, tunnels, form builders, a storage service host (`storage.googleapis.com`), a wildcard over its customers (`*.blob.core.windows.net`) |
| MCPAPP006 | csp-development-origin | note | localhost, 127.0.0.1, 0.0.0.0 in published metadata |
| MCPAPP007 | permissions-sensitive | note | camera, microphone or geolocation requested |
| MCPAPP008 | tool-side-effects-app-visible | warning | tool without `readOnlyHint` callable by the app |
| MCPAPP009 | tool-visibility-implicit | note | tool with UI metadata relies on the default `["model", "app"]` |
| MCPAPP010 | html-dynamic-innerhtml | warning | hand-written inline script assigns dynamic content to an HTML sink (with line and column); values whose every dynamic part goes through an escaping helper are left out |
| MCPAPP011 | html-postmessage-wildcard | warning | hand-written `postMessage(…, '*')` outside the app protocol (JSON-RPC or mcp-ui messages to `parent`/`top`), with line |
| MCPAPP012 | html-inline-handlers | note | `on*` attributes |
| MCPAPP013 | html-eval | warning | `eval` or `new Function` in hand-written script |
| MCPAPP014 | html-form-action | note | a form that posts somewhere |
| MCPAPP015 | html-external-host | note | scripts, styles, images or media from external hosts |
| MCPAPP016 | html-sink-host | error | a URL in the document points at a sink host |
| MCPAPP017 | meta-list-read-mismatch | warning | `resources/read` and `resources/list` both declare a field (`csp`, `permissions`, `domain`) with different values; a listing with no CSP is not a mismatch, since the SDK puts the CSP in the read result |
| MCPAPP018 | meta-read-wider-than-list | error | both declare a CSP and the read-time one adds an entry (domain or wildcard) the listing did not declare under the same key |
| MCPAPP019 | csp-sink-tenant-host | note | one bucket, worker or app on a storage or serverless service from the denylist (`acct.blob.core.windows.net`, `pub-<id>.r2.dev`); fine while the owner keeps the name |
| MCPAPP020 | csp-unused-domain | note | a declared entry whose host the document never mentions: the policy is wider than the UI needs. Only where the exact document is known (a read result, a live server); a host the script assembles from parts at run time is reported too |
| MCPAPP021 | csp-host-undeclared | warning | the UI declares a CSP, but the document loads from or calls an origin under a key that does not allow it (see Suggested CSP); the host blocks the request and the UI breaks |

### A2UI rules

`--a2ui` reads A2UI v0.9 server-to-client messages (`createSurface`, `updateComponents`,
`updateDataModel`, `deleteSurface`). A2UI sends no HTML; what matters is where the agent's data may
flow. Absolute `{ "path": … }` bindings and `formatString` interpolations are resolved against the
`updateDataModel` messages of the same stream after every message, so a value swapped after the
first render is checked too, at the line of the update that brought it. Relative paths in list
templates and client function calls are left to the runtime check
([`@render-policy/a2ui`](../a2ui)); this scan is a CI aid, not a substitute for it.

| Id | Name | Level | What it means |
| --- | --- | --- | --- |
| A2UI001 | a2ui-openurl-scheme | error | `openUrl` target that does not resolve to http or https (`javascript:`, `data:`, `mailto:`), as the basic catalog requires |
| A2UI002 | a2ui-sink-host | error | `Image`, `Video` or `AudioPlayer` url, `theme.iconUrl` or an `openUrl` target on a sink host anyone can use |
| A2UI003 | a2ui-url-encoded-payload | warning | media or icon URL, fetched without a click, that is too long or carries a long high-entropy token |
| A2UI004 | a2ui-url-template-host | warning | `formatString` takes the scheme or host of a media URL or `openUrl` target from data |
| A2UI005 | a2ui-url-template-data | note | `formatString` puts data into the path or query of a media URL |
| A2UI006 | a2ui-text-markup | warning | `Text` contains raw HTML, a Markdown image or a link (bare URLs count; code spans and fences do not), which the basic catalog excludes |
| A2UI007 | a2ui-remote-media-hosts | note | the hosts media and icons load from, for the client's allowlist |

On the 44 examples of the v0.9 basic catalog the scan reports A2UI007 notes and one A2UI006: the
Markdown example puts a link in `Text`.

Hand-written means an inline script with short lines and not too many of them; bundles carry
framework internals and the SDK bridge (which posts to `'*'` by design) and are not reported
for MCPAPP010, MCPAPP011 and MCPAPP013.

In a package scan, domain lists are read where they are written: as a literal array, or through a
constant or shorthand defined in the same file (`resourceDomains: DOMAINS`, `{ connectDomains }`).
Each CSP finding points at that file and line. A list built at runtime counts as declared, so it
does not raise MCPAPP001, but its entries cannot be checked. Packages that only mention the MCP
Apps MIME type or `ui://` (hosts, renderers, SDKs) are not treated as serving a UI resource. Hosts are
looked for in the package's HTML documents only: a `fetch` in server code is not bound by the CSP,
so it does not count.

## As an MCP server

`mcp-app-lint --mcp` serves the checks over stdio, so an agent that builds an MCP App can run them
while it works. Install the package, then register it with the client, for example in Claude Code:

```
npm install --global mcp-app-lint
claude mcp add mcp-app-lint -- mcp-app-lint --mcp
```

| Tool | Input | Output |
| --- | --- | --- |
| `lint_ui_resource` | `html`, `meta` (the read result's `_meta`), `list_meta`, `uri` | findings for the document and its `_meta.ui` |
| `suggest_csp` | `html` | the `_meta.ui.csp` the document needs, or `null` |
| `lint_tools` | `tools` (a `tools/list` array) | findings |
| `lint_a2ui` | `messages` (array, JSON or JSONL text) | findings |
| `lint_directory` | `path` of a package directory | findings, with file and line |
| `lint_server` | `url` of a Streamable HTTP endpoint, `headers` | findings for what the server publishes |

Every tool is marked read-only. Findings come as text (one line each) and as `structuredContent`
(`counts` by level and the findings). No tool starts a process: a local stdio server is linted from
the command line with `--stdio`, where the user sees the command.

The MCP Apps rules come out of the [MCP Apps UI census](../../census) in this repository; the analyzer is
shared. The HTML sink detection is `eslint-plugin-render-policy`'s `no-unsafe-innerhtml`. The sink
denylist is `@render-policy/core`'s. The package also exports the analysis functions (`analyzeHtml`,
`analyzeUiMeta`, `compareListRead`, `scanPackageDir`, `lintA2uiMessages`, `parseA2uiMessages`,
`cspNeeds`, `suggestCsp`, `lintSnapshot`, …), the read-only clients (`McpHttpClient`,
`McpStdioClient`, `snapshotServer`), the MCP server (`serveMcp`, `handleMessage`) and `categorizeDomain`, the heuristic host
category (fonts, analytics, maps, storage, media, cdn, api, …) the census report tabulates; it is
data for aggregates, not a rule.

The sources are plain JavaScript with JSDoc types; the package ships TypeScript declarations for
the functions and the shapes they take and return (`Finding`, `Rule`, `DomainPattern`,
`HtmlAnalysis`, `PackageScan`, …), so `import { lintResource, type Finding } from 'mcp-app-lint'`
is typed.
