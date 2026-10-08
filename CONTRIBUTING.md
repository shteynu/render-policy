# Contributing

## Setup

```
npm ci
npm run check
```

`npm run check` is the CI gate: typecheck, unit tests, build, browser proofs (needs Chromium;
`npx playwright install chromium` or `RP_CHROMIUM=/path/to/chrome`) and the corpus.

## What goes where

- A sanitizer or policy change: `packages/core` with a jsdom test in `packages/core/test`. If the
  change concerns execution, network or Trusted Types, add a check to `e2e/run.mjs` too.
- A new hostile input: a case in `corpus/evil-markdown.json`, or in `corpus/evil-a2ui.json` for
  A2UI messages (see `corpus/README.md`), then `npm run corpus:results` and commit the updated
  `corpus/RESULTS.md`.
- A framework adapter change: its package's tests, and its browser proof for Angular or Mermaid.
- A lint rule change: `packages/eslint-plugin/test` with RuleTester cases, valid and invalid.

## Pull requests

- One topic per PR, with the test that shows the behaviour.
- No `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in library code; tests that need
  to build DOM from a string use a `<template>` in the test file and say so.
- Keep third-party projects out of the discussion unless the issue is public or fixed; see
  `SECURITY.md` for how findings in other projects are handled.
- Documentation is in English.

## Reporting a bypass

Do not open an issue. Use private vulnerability reporting as described in `SECURITY.md`.
