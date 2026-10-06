# MCP Apps UI census: summary

Generated 2026-10-06 by `census/report.mjs`. Aggregates only; see `census/README.md` for method and limits.

## Registry composition

Snapshot 2026-10-06 of registry.modelcontextprotocol.io.

| Measure | Count |
| --- | --- |
| servers (latest version of each) | 39919 |
| with a remote endpoint | 25060 (63%) |
| remote: streamable-http | 24321 |
| remote: sse (legacy) | 1078 |
| with a package (stdio) | 16349 (41%) |
| package registries | npm 10811, oci 1069, pypi 4235, mcpb 1461, cargo 70, nuget 138 |

## Static census over npm packages

Candidates come from npm keyword searches and the npm packages named in the registry. Tarballs were downloaded and scanned only for packages that depend on a UI SDK (@modelcontextprotocol/ext-apps, @mcp-ui/server, @mcp-ui/client). "Declaring UI resources" means the source registers an app resource, mentions the `text/html;profile=mcp-app` MIME type or a `ui://` URI.

| Measure | Count |
| --- | --- |
| candidate packages | 10419 |
| depending on a UI SDK | 174 (@modelcontextprotocol/ext-apps 165, @mcp-ui/server 13, @mcp-ui/client 1) |
| scanned (tarball downloaded) | 174 |
| declaring UI resources | 158 |
| of which declare a CSP (any domain list) | 63 (40%) |
| CSP with a wildcard domain | 6 (10% of declared) |
| CSP with a full wildcard (`*`) | 5 |
| CSP with an http: domain | 2 |
| CSP naming a sink host (denylist) | 1 |
| requesting sandbox permissions | clipboardWrite 3, microphone 2, camera 1 |
| tools declared visible to the app | 48 packages |

### What the declared domains are

218 entries (96 distinct hosts) across the 63 packages that declare a list, by a heuristic category of the host (`categorizeDomain` in mcp-app-lint; a host fits the first category listed). A package counts once per category.

| Category | Packages | Entries | connect | resource | frame | base-uri |
| --- | --- | --- | --- | --- | --- | --- |
| every-host | 5 | 9 | 3 | 6 | 0 | 0 |
| development | 2 | 12 | 2 | 4 | 6 | 0 |
| sink | 1 | 1 | 0 | 1 | 0 | 0 |
| fonts | 3 | 12 | 4 | 8 | 0 | 0 |
| analytics | 3 | 8 | 7 | 1 | 0 | 0 |
| maps | 5 | 41 | 19 | 16 | 6 | 0 |
| storage | 2 | 2 | 0 | 2 | 0 | 0 |
| media | 7 | 33 | 0 | 33 | 0 | 0 |
| cdn | 11 | 38 | 14 | 24 | 0 | 0 |
| api | 5 | 39 | 39 | 0 | 0 | 0 |
| other | 7 | 23 | 10 | 13 | 0 | 0 |

### The HTML of the UI resources

| Measure | Count |
| --- | --- |
| HTML documents found (files and embedded) | 576 |
| with inline scripts | 357 (124 with a handwritten script, the rest bundles) |
| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | 193 in any script; 12 in handwritten scripts (10% of those) |
| with postMessage(…, '*') | 191 in any script (the MCP Apps SDK bridge posts to '*' by design, so bundles count the SDK); 33 in handwritten scripts |
| with inline event handlers | 59 |
| with eval or new Function | 76 in any script; 0 in handwritten scripts |
| loading from external hosts | 88 (fonts 28, maps 8, cdn 31, api 2, other 32) |
| referencing a sink host | 0 |
| with a form that posts somewhere | 7 |
| with a CSP meta tag of its own | 15 |

Metadata errors: http-404 83.

### What mcp-app-lint reports over the same packages

The scanner's rules run over the 174 scanned packages from the stored scans (static data, so MCPAPP008/009 on tools and MCPAPP017/018 on list/read differences, which need a live server, do not occur here). "Packages" is packages with at least one finding of the rule.

| Rule | Level | Packages | Findings |
| --- | --- | --- | --- |
| MCPAPP001 csp-missing | warning | 95 | 95 |
| MCPAPP002 csp-allows-every-host | error | 5 | 9 |
| MCPAPP003 csp-wildcard-host | warning | 5 | 35 |
| MCPAPP004 csp-insecure-scheme | warning | 2 | 7 |
| MCPAPP005 csp-sink-host | error | 1 | 1 |
| MCPAPP006 csp-development-origin | note | 2 | 10 |
| MCPAPP007 permissions-sensitive | note | 3 | 3 |
| MCPAPP010 html-dynamic-innerhtml | warning | 9 | 26 |
| MCPAPP011 html-postmessage-wildcard | warning | 19 | 33 |
| MCPAPP012 html-inline-handlers | note | 24 | 59 |
| MCPAPP014 html-form-action | note | 7 | 7 |
| MCPAPP015 html-external-host | note | 29 | 88 |

## Protocol census over remote servers

Read-only: initialize, resources/list, resources/read of UI resources, tools/list. No tool was called. Servers that require authentication were not probed further.

| Measure | Count |
| --- | --- |
| servers probed | 24321 |
| reachable and speaking MCP | 15120 |
| failures | auth 6126, http 1148, network 989, not-mcp 869, protocol 48, timeout 21 |
| with UI resources | 654 |
| UI resources read | 1440 (1115 with the MCP Apps MIME type) |
| declaring a CSP | 1032 (72%) |
| CSP with a wildcard | 87 |
| CSP with a full wildcard | 2 |
| CSP naming a sink host | 84 |
| list vs read policy differs | 496 of 1074 comparable (6 where read is wider) |
| HTML with a dynamic innerHTML sink | 810 |
| HTML with postMessage(…, '*') | 813 |
| servers with side-effect tools visible to the app | 194 |
