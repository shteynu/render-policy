# MCP Apps UI census: summary

Generated 2026-09-30 by `census/report.mjs`. Aggregates only; see `census/README.md` for method and limits.

## Registry composition

Snapshot 2026-09-30 of registry.modelcontextprotocol.io.

| Measure | Count |
| --- | --- |
| servers (latest version of each) | 37759 |
| with a remote endpoint | 23358 (62%) |
| remote: streamable-http | 22618 |
| remote: sse (legacy) | 1077 |
| with a package (stdio) | 15795 (42%) |
| package registries | npm 10462, oci 1027, pypi 4101, mcpb 1377, cargo 64, nuget 135 |

## Static census over npm packages

Candidates come from npm keyword searches and the npm packages named in the registry. Tarballs were downloaded and scanned only for packages that depend on a UI SDK (@modelcontextprotocol/ext-apps, @mcp-ui/server, @mcp-ui/client). "Declaring UI resources" means the source registers an app resource, mentions the `text/html;profile=mcp-app` MIME type or a `ui://` URI.

| Measure | Count |
| --- | --- |
| candidate packages | 10077 |
| depending on a UI SDK | 168 (@modelcontextprotocol/ext-apps 159, @mcp-ui/server 13, @mcp-ui/client 1) |
| scanned (tarball downloaded) | 168 |
| declaring UI resources | 153 |
| of which declare a CSP (any domain list) | 60 (39%) |
| CSP with a wildcard domain | 6 (10% of declared) |
| CSP with a full wildcard (`*`) | 4 |
| CSP with an http: domain | 2 |
| CSP naming a sink host (denylist) | 1 |
| requesting sandbox permissions | clipboardWrite 3, microphone 1 |
| tools declared visible to the app | 46 packages |

### What the declared domains are

211 entries (93 distinct hosts) across the 60 packages that declare a list, by a heuristic category of the host (`categorizeDomain` in mcp-app-lint; a host fits the first category listed). A package counts once per category.

| Category | Packages | Entries | connect | resource | frame | base-uri |
| --- | --- | --- | --- | --- | --- | --- |
| every-host | 4 | 8 | 3 | 5 | 0 | 0 |
| development | 2 | 12 | 2 | 4 | 6 | 0 |
| sink | 1 | 1 | 0 | 1 | 0 | 0 |
| fonts | 3 | 12 | 4 | 8 | 0 | 0 |
| analytics | 3 | 8 | 7 | 1 | 0 | 0 |
| maps | 5 | 41 | 19 | 16 | 6 | 0 |
| storage | 2 | 2 | 0 | 2 | 0 | 0 |
| media | 7 | 33 | 0 | 33 | 0 | 0 |
| cdn | 10 | 34 | 14 | 20 | 0 | 0 |
| api | 4 | 38 | 38 | 0 | 0 | 0 |
| other | 7 | 22 | 9 | 13 | 0 | 0 |

### The HTML of the UI resources

| Measure | Count |
| --- | --- |
| HTML documents found (files and embedded) | 596 |
| with inline scripts | 373 (144 with a handwritten script, the rest bundles) |
| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | 205 in any script; 24 in handwritten scripts (17% of those) |
| with postMessage(…, '*') | 189 in any script (the MCP Apps SDK bridge posts to '*' by design, so bundles count the SDK); 32 in handwritten scripts |
| with inline event handlers | 59 |
| with eval or new Function | 76 in any script; 0 in handwritten scripts |
| loading from external hosts | 88 (fonts 28, maps 8, cdn 31, api 2, other 32) |
| referencing a sink host | 0 |
| with a form that posts somewhere | 7 |
| with a CSP meta tag of its own | 15 |

Metadata errors: http-404 82.
