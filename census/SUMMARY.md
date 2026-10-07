# MCP Apps UI census: summary

Generated 2026-10-07 by `census/report.mjs`. Aggregates only; see `census/README.md` for method and limits.

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

Candidates come from npm keyword searches and the npm packages named in the registry. Tarballs were downloaded and scanned only for packages that depend on a UI SDK (@modelcontextprotocol/ext-apps, @mcp-ui/server, @mcp-ui/client). "Mentioning UI resources" means the source mentions the `text/html;profile=mcp-app` MIME type or a `ui://` URI, which hosts, renderers and SDKs do too; "serving UI resources" means it registers an app resource, sets that MIME type or a `ui://` URI on a resource, or writes a CSP domain list.

| Measure | Count |
| --- | --- |
| candidate packages | 10419 |
| depending on a UI SDK | 174 (@modelcontextprotocol/ext-apps 165, @mcp-ui/server 13, @mcp-ui/client 1) |
| scanned (tarball downloaded) | 174 |
| mentioning UI resources | 158 |
| serving UI resources | 146 |
| of which declare a CSP (any domain list) | 74 (51%); 2 only through lists built at runtime |
| CSP with a wildcard domain | 10 (14% of declared) |
| CSP with a full wildcard (`*`) | 5 |
| CSP with an http: domain | 2 |
| CSP naming a sink host anyone can use (denylist) | 2 |
| CSP naming one account on a storage or serverless service from the denylist | 2 |
| requesting sandbox permissions | clipboardWrite 3, microphone 2, camera 1 |
| tools declared visible to the app | 47 packages |

### What the declared domains are

324 entries (133 distinct hosts) across the 74 packages that declare a list, by a heuristic category of the host (`categorizeDomain` in mcp-app-lint; a host fits the first category listed). A package counts once per category.

| Category | Packages | Entries | connect | resource | frame | base-uri |
| --- | --- | --- | --- | --- | --- | --- |
| every-host | 5 | 9 | 3 | 6 | 0 | 0 |
| development | 2 | 7 | 2 | 2 | 3 | 0 |
| local-scheme | 3 | 6 | 0 | 3 | 3 | 0 |
| sink | 2 | 3 | 1 | 2 | 0 | 0 |
| fonts | 4 | 16 | 4 | 12 | 0 | 0 |
| analytics | 3 | 8 | 7 | 1 | 0 | 0 |
| maps | 5 | 41 | 19 | 16 | 6 | 0 |
| storage | 3 | 4 | 0 | 4 | 0 | 0 |
| media | 10 | 46 | 0 | 46 | 0 | 0 |
| cdn | 14 | 46 | 16 | 29 | 1 | 0 |
| api | 6 | 41 | 40 | 0 | 1 | 0 |
| other | 13 | 97 | 24 | 71 | 2 | 0 |

### The HTML of the UI resources

| Measure | Count |
| --- | --- |
| HTML documents found (files and embedded) | 577 |
| with inline scripts | 358 (124 with a handwritten script, the rest bundles) |
| with a dynamic innerHTML/insertAdjacentHTML/document.write sink (render-policy lint) | 194 in any script; 12 in handwritten scripts (10% of those); 12 in handwritten scripts with a value not passed through an escaping helper |
| with postMessage(…, '*') | 192 in any script (the MCP Apps SDK bridge posts to '*' by design, so bundles count the SDK); 33 in handwritten scripts; 11 outside the app protocol (JSON-RPC or mcp-ui messages to parent) |
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
| MCPAPP001 csp-missing | warning | 15 | 15 |
| MCPAPP002 csp-allows-every-host | error | 5 | 9 |
| MCPAPP003 csp-wildcard-host | warning | 9 | 73 |
| MCPAPP005 csp-sink-host | error | 2 | 3 |
| MCPAPP006 csp-development-origin | note | 2 | 7 |
| MCPAPP007 permissions-sensitive | note | 3 | 3 |
| MCPAPP010 html-dynamic-innerhtml | warning | 9 | 22 |
| MCPAPP011 html-postmessage-wildcard | warning | 7 | 22 |
| MCPAPP012 html-inline-handlers | note | 24 | 59 |
| MCPAPP014 html-form-action | note | 7 | 7 |
| MCPAPP015 html-external-host | note | 29 | 88 |
| MCPAPP019 csp-sink-tenant-host | note | 2 | 2 |

## Protocol census over remote servers

Read-only: initialize, resources/list, resources/read of UI resources, tools/list. No tool was called. Servers that require authentication were not probed further.

| Measure | Count |
| --- | --- |
| servers probed | 24321 |
| reachable and speaking MCP | 15120 |
| failures | auth 6126, http 1148, network 989, not-mcp 869, protocol 48, timeout 21 |
| with UI resources | 654 |

### Declared policies and HTML, as served

Each measure counts UI resources and the servers with at least one such resource. A policy counts as declared when either `resources/list` or `resources/read` carries `ui.csp`.

| Measure | UI resources | Servers |
| --- | --- | --- |
| UI resources read | 1440 | 654 |
| with the MCP Apps MIME type | 1115 | 540 |
| resources/read failed (auth 38, protocol 18, http 4) | 60 | 22 |
| declaring a CSP | 1032 | 474 |
| of which every list is empty | 280 | 162 |
| CSP with a wildcard host | 87 | 35 |
| CSP allowing every host (`*` or scheme-only) | 2 | 1 |
| CSP with an http: origin | 1 | 1 |
| CSP naming a sink host anyone can use | 60 | 26 |
| CSP naming one account on a storage or serverless service from the denylist | 100 | 46 |
| `_meta.ui` comparable between list and read | 1074 | 503 |
| list and read differ | 496 | 227 |
| only read carries `_meta.ui` | 436 | 203 |
| only list carries `_meta.ui` | 32 | 17 |
| both carry it, with different values | 28 | 11 |
| read is wider than list | 6 | 2 |
| HTML documents | 1380 | 633 |
| with a handwritten inline script | 833 | 412 |
| with a dynamic innerHTML-class sink, any script | 810 | 336 |
| with a dynamic innerHTML-class sink, handwritten script | 466 | 211 |
| with postMessage(…, '*') in a handwritten script | 468 | 238 |
| with inline event handlers | 144 | 58 |
| with eval or new Function in a handwritten script | 0 | 0 |
| with a form that posts somewhere | 1 | 1 |
| with a CSP meta tag of its own | 153 | 75 |
| loading from external hosts | 389 | 180 |
| referencing a sink host | 1 | 1 |

### What the enforced policies allow

Hosts in the policy a host enforces (read when it carries `ui.csp`, otherwise list), by the heuristic category of `categorizeDomain` in mcp-app-lint. A resource or server counts once per category.

| Category | UI resources | Servers | Entries |
| --- | --- | --- | --- |
| every-host | 2 | 1 | 3 |
| development | 0 | 0 | 0 |
| local-scheme | 0 | 0 | 0 |
| sink | 60 | 26 | 78 |
| fonts | 57 | 23 | 112 |
| analytics | 13 | 2 | 13 |
| maps | 41 | 13 | 112 |
| storage | 83 | 41 | 95 |
| media | 150 | 59 | 227 |
| cdn | 276 | 91 | 451 |
| api | 94 | 30 | 217 |
| other | 624 | 266 | 1802 |

### Tools on servers with UI resources

Only tools that carry `_meta.ui` are classified; the others are counted in the total alone, so the app-visible figures are a lower bound.

| Measure | Count |
| --- | --- |
| tools | 10716 |
| with a UI resource (`_meta.ui.resourceUri`) | 2132 |
| with `_meta.ui` and visible to the app (explicitly or by default) | 2267 |
| of those, app-only | 110 |
| of those, without readOnlyHint | 603, on 194 servers |
