# Security policy

## Reporting a vulnerability in render-policy

Use GitHub's private vulnerability reporting on this repository
("Security" tab, "Report a vulnerability"). Do not open a public issue for a bypass.

Please include the input (Markdown or HTML), the mode and policy overrides, the browser, and
what the rendered DOM or network did. A failing test in `packages/core/test` is the best report.

You will get an acknowledgement within 48 hours and a fix or a decision within 30 days.
Credit goes to the reporter in the advisory and the changelog unless you prefer otherwise.

## Scope

- A payload that executes script, or reaches an `on*` attribute, `<script>`, `<style>`, a form
  control or a forbidden element in any mode.
- A URL that reaches the DOM with a scheme outside `allowedSchemes`, or an image request to a
  host outside `imageHosts` in strict or balanced mode.
- A request made from a streamed buffer to a URL that was not yet complete.
- A Trusted Types violation raised by the core under `require-trusted-types-for 'script'`.

Heuristics (`urlHeuristics`) and the sink denylist are best-effort layers behind the host
allowlist; a bypass of them alone is a bug report, not an advisory.

## Supported versions

The latest minor release on npm.

## Disclosure of findings in other projects

Findings in other renderers or frameworks discovered while building this library are reported to
those projects privately and are published here only after a fix or the agreed disclosure date.
