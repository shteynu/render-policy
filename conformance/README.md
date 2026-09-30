# MCP Apps host conformance

A check of the host-side security requirements the [MCP Apps specification](https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx)
states a host MUST enforce when it renders a UI resource from an MCP server. It is a conformance
test, not an attack tool: each probe is the minimal operation a CSP directive governs, and the
assertion is that a compliant host's policy stops it. A host that fails a check is not enforcing
the policy that [the census](../census) measured servers declaring and that
[`mcp-app-lint`](../packages/mcp-app-lint) flags.

## What it checks

`host.mjs` is a reference for the two things the spec makes the host compute from `_meta.ui`:

- **`buildCsp(meta)`** — the Content-Security-Policy, including the restrictive default
  (`connect-src 'none'`, no network) the host MUST apply when `ui.csp` is omitted. `host.test.mjs`
  checks it against the spec's formula: declared `connectDomains`/`resourceDomains` widen only the
  directives the spec assigns them, `frame-src` and `base-uri` stay locked down unless declared,
  `object-src 'none'` and `default-src 'none'` always hold.
- **`buildAllowAttribute(permissions)`** — the iframe `allow` attribute for the sensitive
  Permissions-Policy features (camera, microphone, geolocation).
- **`toolNeedsConsent(tool)`** — whether a tool is app-callable (visibility defaults to
  `["model", "app"]`) and side-effecting (no `readOnlyHint`), so the host must gate it behind
  consent. This is the metadata-level rule; `mcp-app-lint`'s MCPAPP008/009 report it on a corpus.

`run.mjs` serves a UI view in a real Chromium under the CSP `buildCsp` produces and asserts the
browser's own enforcement:

| Requirement (spec) | Probe | Assertion |
| --- | --- | --- |
| Host and sandbox have different origins | two server origins | the view is served from an origin distinct from the host page |
| CSP built from declared domains | a view declaring one connect host | the declared host is reachable, an undeclared host raises a `connect-src` violation |
| Restrictive default with no `ui.csp` | a view with no metadata | every connection is blocked (`connect-src 'none'`) |
| `frame-src 'none'` without `frameDomains` | a nested iframe | blocked; a frame host outside a declared `frameDomains` is still blocked |
| `object-src 'none'` | an `<object>` | blocked |

The runner fulfils whatever the CSP lets reach the network with a 200, so a directive that allows
a request produces a real load and one that blocks it produces a `securitypolicyviolation` — a
crisp pass/fail per directive, with no external network.

## Running

```
npm run conformance      # needs Chromium (Playwright's own, or RP_CHROMIUM=/path/to/chrome)
node --test conformance/host.test.mjs
```

## Scope

This covers what a browser enforces from the resource's declared policy. It does not exercise the
full double-iframe sandbox-proxy message relay, tool-call consent flows, or `ui/message`
spoofing; those are host-behaviour requirements that need a host to drive and are tracked in the
roadmap's Stage 4. The pieces here are the ones that connect directly to this repository's
measurement (the census) and its scanner (`mcp-app-lint`).
