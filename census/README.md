# MCP Apps UI census

What public MCP servers declare about the interfaces they ask hosts to render: the
`_meta.ui` of their `ui://` resources (CSP domain lists, sandbox permissions), the visibility
of their tools to the app, and what the HTML of those resources does on its own. Nobody has
measured this; the MCP Apps specification leaves most of the enforcement to hosts, so the
declared policies are what a host has to work with.

Results: [`SUMMARY.md`](SUMMARY.md) (aggregates only) and `data/summary.json`.

## Method

Three collectors, one analyzer:

| Step | Script | Source | What it records |
| --- | --- | --- | --- |
| registry snapshot | `collect-registry.mjs` | registry.modelcontextprotocol.io, `GET /v0/servers` | every server: remotes, packages, status; latest version per name |
| static census | `collect-npm.mjs` | npm: keyword searches plus the npm packages the registry names | package metadata; for packages depending on a UI SDK (`@modelcontextprotocol/ext-apps`, `@mcp-ui/*`) the tarball is downloaded (25 MB cap), and the sources are scanned for app resource registrations, CSP domain lists, permissions, tool visibility and the HTML of the UI resources |
| protocol census | `collect-remote.mjs` | the registry's streamable-http remotes | `initialize`, `resources/list`, `resources/read` of UI resources (10 per server), `tools/list`; the `_meta.ui` of list and read compared; the HTML analyzed |
| report | `report.mjs` | `data/*.json[l]` | `SUMMARY.md` and `data/summary.json`; domain lists are re-classified from the raw entries kept in each scan, so a classifier change needs no rescan |

The analyzer lives in [`packages/mcp-app-lint`](../packages/mcp-app-lint) (`analyze.mjs`,
`domains.mjs`, `npm.mjs`); the same code is the `mcp-app-lint` scanner. It classifies domain
patterns (wildcards, a full `*` or a scheme-only `https:`, `http:` schemes, hosts on the
render-policy sink denylist, and a heuristic category per host: fonts, analytics, maps, storage,
media, CDN, API, development leftovers), compares the policy a host sees
in `resources/list` with the one in `resources/read` (the read result wins in the specification,
so a server can present a stricter policy at connection time and a wider one at render time),
and inspects HTML: inline scripts are linted with `eslint-plugin-render-policy`'s
`no-unsafe-innerhtml`, and the page is searched for `postMessage(…, '*')`, inline handlers,
`eval`, forms that post, external hosts and sink hosts.

## Rules

- Read-only and protocol-level. The protocol census sends `initialize`, list and read requests
  and nothing else; no tool is ever called; no credentials are sent; servers that answer 401 or
  403 are counted and left alone. The static census reads public npm tarballs.
- Aggregates only. `SUMMARY.md` never names a server or package. Raw data stays in `data/`,
  which is not committed except for `summary.json`.
- A dangerous finding about a specific server goes to its owner privately before anything is
  published, following `SECURITY.md`.

## Running

```
npm ci && npm run build
npm run census:registry     # snapshot, a few minutes
npm run census:npm          # static census; resumable, writes data/npm-packages.jsonl
npm run census:remote       # protocol census; needs outbound access to arbitrary hosts
npm run census:report
npm run test:census
```

The collectors are resumable: a package or server already in the JSONL is skipped. Options:
`--limit N`, `--concurrency N`, `--only <name>`, and for the protocol census `--max-resources N` and
`--retry network,timeout`: probe again the servers whose latest probe failed with those kinds, for
example after the local network dropped during a run. Records are only appended; the report uses
the latest record per server.

## Limits

- The static scan is regex-based: it finds domain lists and permissions written as literals in
  source. Policies built at runtime are counted as "no CSP declared" unless the HTML or the MIME
  type shows a UI resource.
- The protocol census reaches only servers that accept unauthenticated `initialize`; the share
  that requires authentication is reported, not probed.
- Servers distributed only as packages (stdio) are not started. Starting third-party servers
  locally is a different exercise, to be done in a container if at all.
- A sandboxed runner whose outbound access is restricted (this repository's CI, some cloud
  environments) records `egress-blocked` for the protocol census; run it from a machine with
  ordinary internet access.
