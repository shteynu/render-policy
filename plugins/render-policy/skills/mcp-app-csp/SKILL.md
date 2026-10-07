---
name: mcp-app-csp
description: Check and fix the security metadata of an MCP App (MCP Apps / SEP-1865 UI resources) with mcp-app-lint. Use when building, reviewing or publishing an MCP server that serves ui:// resources with MIME type text/html;profile=mcp-app, declares _meta.ui.csp (connectDomains, resourceDomains, frameDomains, baseUriDomains) or _meta.ui.permissions, sets tool _meta.ui.visibility, or when asked to audit an MCP App's CSP.
---

# MCP App CSP check

An MCP App's HTML runs in a sandboxed iframe. The host builds that iframe's Content Security Policy
from what the server declares in `_meta.ui.csp`. A declaration that is too wide lets the App's
script send whatever it shows to a server someone else controls. A declaration that is too narrow
silently breaks the App.

## 1. Run the linter

From the server's package directory (source or build output):

```bash
npx mcp-app-lint@0.1.4 --dir . --format text
```

`mcp-app-lint` is an MIT CLI from the render-policy project. It reads the files in that directory
and prints findings. It sends nothing anywhere. Other inputs:

- `--read read.json --list list.json --tools tools.json`: saved results of `resources/read`,
  `resources/list` and `tools/list` from a running server
- `--html app.html`: one UI document
- `--format sarif --out mcp-app-lint.sarif`: SARIF 2.1.0 for CI and GitHub code scanning
- `--fail-on error|warning|note|none`: exit code 1 when a finding reaches the level

## 2. Fix the findings

| Rule | Level | Fix |
| --- | --- | --- |
| MCPAPP001 csp-missing | warning | The UI references an external host but declares no `ui.csp`, so the host blocks it. Declare each origin it loads from or calls. A self-contained UI needs no CSP. |
| MCPAPP002 csp-allows-every-host | error | Replace `*` or a scheme-only entry (`https:`) with the exact origins. |
| MCPAPP003 csp-wildcard-host | warning | Replace `*.example.com` with the subdomains in use. |
| MCPAPP004 csp-insecure-scheme | warning | Use `https:`; `http:` is fine only for loopback during development. |
| MCPAPP005 csp-sink-host | error | The host accepts data from accounts anyone can create (request catchers, tunnels, form builders, shared storage hosts, a wildcard over a storage or serverless provider's customers such as `*.supabase.co` or `*.r2.cloudflarestorage.com`). Declare your own project host, bucket host or CDN domain instead. |
| MCPAPP006 csp-development-origin | note | Remove `localhost` / `127.0.0.1` from published metadata; tie it to the same setting as the runtime URL. |
| MCPAPP007 permissions-sensitive | note | Keep camera, microphone or geolocation only if the App uses them. |
| MCPAPP008 tool-side-effects-app-visible | warning | A tool the App can call has no `readOnlyHint`. Mark read-only tools, or set `_meta.ui.visibility: ["model"]` on tools the App must not call. |
| MCPAPP009 tool-visibility-implicit | note | State `_meta.ui.visibility` explicitly. |
| MCPAPP010 html-dynamic-innerhtml | warning | Hand-written script assigns dynamic content to an HTML sink. Use `textContent`, or render through `@render-policy/core` (see the `safe-agent-html` skill). |
| MCPAPP011 html-postmessage-wildcard | warning | Give `postMessage` an explicit target origin. |
| MCPAPP013 html-eval | warning | Remove `eval` / `new Function`. |
| MCPAPP016 html-sink-host | error | A URL in the document points at a sink host (same list as MCPAPP005). Serve that asset or endpoint from a host you own. |
| MCPAPP017 meta-list-read-mismatch | warning | `resources/read` and `resources/list` declare the same field with different values. Declare one `_meta.ui` and use it in both. A listing with no CSP is fine. |
| MCPAPP018 meta-read-wider-than-list | error | The read-time CSP adds entries the listing did not declare. Declare the same CSP in both. |
| MCPAPP019 csp-sink-tenant-host | note | One named bucket or app on a storage or serverless service. Fine while you own that name; confirm it is yours. |

Other notes (inline `on*` handlers, forms that post elsewhere, external hosts the document loads)
are informational. The tool prints a
message for each rule it reports; the full rule list is in the package README:
https://www.npmjs.com/package/mcp-app-lint

## 3. Re-run until clean

Re-run the command after each change. Report what remains and why, for example a wildcard the
user confirmed they need.

## Checklist without the tool

- Every origin the App uses is declared; nothing else is.
- No `*`, no scheme-only entries, no wildcard over a service where anyone can create a subdomain or
  bucket.
- Development origins are not in published metadata.
- Tools with side effects are not callable by the App unless that is the intent.

For CI, the repository ships a composite GitHub Action (`shteynu/render-policy@v1`) that runs the
CLI and uploads the SARIF to code scanning.
