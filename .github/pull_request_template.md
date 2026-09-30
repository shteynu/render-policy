## What

## Why

## Checks

- [ ] `npm run check` passes locally (or the relevant package tests plus the browser proof it touches)
- [ ] a test shows the new behaviour
- [ ] no `innerHTML`, `outerHTML`, `insertAdjacentHTML` or `document.write` in library code
- [ ] corpus: `corpus/RESULTS.md` regenerated if `corpus/evil-markdown.json` changed
- [ ] docs updated (README, package README, CHANGELOG)
