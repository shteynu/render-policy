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
| CSP with a full wildcard (`*`) | 1 |
| CSP with an http: domain | 2 |
| CSP naming a sink host (denylist) | 1 |
| requesting sandbox permissions | clipboardWrite 3, microphone 1 |
| tools declared visible to the app | 46 packages |

### The HTML of the UI resources

| Measure | Count |
| --- | --- |
| HTML documents found (files and embedded) | 596 |
| with inline scripts | 373 (144 with a handwritten script, the rest bundles) |
| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | 205 in any script; 24 in handwritten scripts (17% of those) |
| with postMessage(…, '*') | 189 in any script (the MCP Apps SDK bridge posts to '*' by design, so bundles count the SDK); 32 in handwritten scripts |
| with inline event handlers | 59 |
| with eval or new Function | 76 in any script; 0 in handwritten scripts |
| loading from external hosts | 88 |
| referencing a sink host | 0 |
| with a form that posts somewhere | 7 |
| with a CSP meta tag of its own | 15 |

Metadata errors: http-404 82.
