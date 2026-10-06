# mcp-app-lint

SARIF findings about what an MCP App declares and what its HTML does. Meant to be run by MCP
scanners and CI, or by hand on a package, a directory, or the JSON a server returned.

```
npx mcp-app-lint --dir ./my-server                    # a package directory, built or source
npx mcp-app-lint --package @scope/name                # an npm package: downloaded, scanned, deleted
npx mcp-app-lint --read read.json --list list.json --tools tools.json
                                                      # results of resources/read, resources/list, tools/list
npx mcp-app-lint --html app.html                      # one UI document
```

Options: `--out file.sarif`, `--format sarif|text`, `--fail-on error|warning|note|none` (default
`error`; the exit code is 1 when a finding reaches the threshold, 2 on usage errors).

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
scanning maps them to the source.

Any CI can run the CLI directly and read the exit code (`0` clean, `1` findings at or above
`--fail-on`, `2` usage error):

```
npx mcp-app-lint --dir . --format sarif --out mcp-app-lint.sarif --fail-on error
```

## Rules

| Id | Name | Level | What it means |
| --- | --- | --- | --- |
| MCPAPP001 | csp-missing | warning | no `ui.csp`; a compliant host applies `default-src 'none'`, `connect-src 'none'` |
| MCPAPP002 | csp-allows-every-host | error | `*` or a scheme-only entry (`https:`) expands to every host |
| MCPAPP003 | csp-wildcard-host | warning | `*.example.com` allows every subdomain |
| MCPAPP004 | csp-insecure-scheme | warning | `http:` origin |
| MCPAPP005 | csp-sink-host | error | host on the sink denylist that reaches accounts anyone can create: request catchers, tunnels, form builders, a storage service host (`storage.googleapis.com`), a wildcard over its customers (`*.blob.core.windows.net`) |
| MCPAPP006 | csp-development-origin | note | localhost, 127.0.0.1, `blob:` in published metadata |
| MCPAPP007 | permissions-sensitive | note | camera, microphone or geolocation requested |
| MCPAPP008 | tool-side-effects-app-visible | warning | tool without `readOnlyHint` callable by the app |
| MCPAPP009 | tool-visibility-implicit | note | tool with UI metadata relies on the default `["model", "app"]` |
| MCPAPP010 | html-dynamic-innerhtml | warning | hand-written inline script assigns dynamic content to an HTML sink (with line and column) |
| MCPAPP011 | html-postmessage-wildcard | warning | hand-written `postMessage(…, '*')` |
| MCPAPP012 | html-inline-handlers | note | `on*` attributes |
| MCPAPP013 | html-eval | warning | `eval` or `new Function` in hand-written script |
| MCPAPP014 | html-form-action | note | a form that posts somewhere |
| MCPAPP015 | html-external-host | note | scripts, styles, images or media from external hosts |
| MCPAPP016 | html-sink-host | error | a URL in the document points at a sink host |
| MCPAPP017 | meta-list-read-mismatch | warning | `resources/read` declares a different policy than `resources/list` |
| MCPAPP018 | meta-read-wider-than-list | error | the read-time policy adds domains or wildcards the listing did not declare |
| MCPAPP019 | csp-sink-tenant-host | note | one bucket, worker or app on a storage or serverless service from the denylist (`acct.blob.core.windows.net`, `pub-<id>.r2.dev`); fine while the owner keeps the name |

Hand-written means an inline script with short lines and not too many of them; bundles carry
framework internals and the SDK bridge (which posts to `'*'` by design) and are not reported
for MCPAPP010, MCPAPP011 and MCPAPP013.

The rules come out of the [MCP Apps UI census](../../census) in this repository; the analyzer is
shared. The HTML sink detection is `eslint-plugin-render-policy`'s `no-unsafe-innerhtml`. The sink
denylist is `@render-policy/core`'s. The package also exports the analysis functions (`analyzeHtml`,
`analyzeUiMeta`, `compareListRead`, `scanPackageDir`, …) and `categorizeDomain`, the heuristic host
category (fonts, analytics, maps, storage, media, cdn, api, …) the census report tabulates; it is
data for aggregates, not a rule.
