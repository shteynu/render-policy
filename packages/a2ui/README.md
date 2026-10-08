# @render-policy/a2ui

The render policy for [A2UI](https://a2ui.org) surfaces (specification v0.9 and v0.9.1). An A2UI
agent sends no HTML: it describes components from a catalog, and your client renders them with its
own widgets. Sanitization is no longer the question. Where the agent's data may flow still is.

In the basic catalog these places matter:

| Place | What happens without a policy |
| --- | --- |
| `Image.url`, `Video.url`, `AudioPlayer.url`, `theme.iconUrl` | the browser requests the URL as soon as it renders, without a click: whatever the agent put in the URL leaves |
| `openUrl` (button actions) | navigation; the catalog requires http and https only and `noopener,noreferrer` |
| `Text.text` | Markdown; the catalog says "without HTML, images, or links", but that is guidance to the agent, not a guarantee |

Nearly every property is dynamic: a literal, a `{ "path": "/…" }` binding into the data model, or a
function call such as `formatString` (`"https://cdn.example/${/user/token}.png"`). The value that
matters exists only after binding and changes with every `updateDataModel`. Checking the message JSON
is not enough: the check has to run on the resolved value, when the renderer uses it.

```ts
import { createA2uiGuard } from '@render-policy/a2ui';

const guard = createA2uiGuard({
  policy: { images: { hosts: ['cdn.example.com'] } },
  onDecision: (d) => audit.push(d),
});

// In your Image component, after the binding resolved:
const result = guard.url('image', resolvedUrl, { surfaceId, componentId });
if (result.allowed) img.src = result.value; // use result.value: the query string may be stripped, a proxy applied
else showPlaceholder(result.decision.reason);

// The basic catalog's openUrl function:
guard.openUrl(resolvedArgs.url); // opens with noopener,noreferrer only when allowed

// Text: inert fragment, no HTML, images or links
guard.renderText(element, resolvedText, { componentId });
```

What the guard does:

- `url(kind, value)` for `image`, `video`, `audio`, `icon` and `openUrl` runs the URL policy of
  [`@render-policy/core`](../core) on the resolved value: scheme allowlist, sink denylist,
  `urls.decide`, and for everything fetched without a click the image policy (host allowlist, query
  string handling, length and entropy heuristics, `images.rewriteUrl`). Video and audio players
  request on their own, so they follow the image rules. A value that is not a non-empty string (an
  unresolved binding, a number, an object) is refused with `a2ui-not-a-url`.
- `openUrl(value)` allows only http and https (the catalog's requirement, on top of the policy),
  resolves relative targets against the page and opens with `noopener,noreferrer`. Pass `open` to
  route it through your own navigation.
- `text(value)` / `renderText(target, value)` hold `Text` to the catalog contract: raw HTML is shown
  as text (`a2ui-text-html`), an image becomes its alt text (`a2ui-text-image`), a link its text
  (`a2ui-text-link`). Nothing the agent wrote disappears silently, and nothing is fetched or opened.
  The result is sanitized and inserted with `replaceChildren()`. `text: 'policy'` renders `Text` as
  ordinary Markdown under the policy instead, for a catalog of your own that allows more.
- Every decision is a journal entry with the core's codes plus the A2UI place (`a2ui.kind`,
  `surfaceId`, `componentId`). Application hooks that throw become entries; the guard never throws.

## The A2UI renderers' Markdown plug-in

The A2UI web renderers (React, Lit, Angular) take Markdown through a plug-in,
`(markdown, options) => Promise<string>`, and insert the returned string themselves.
`createA2uiMarkdownRenderer()` fits that contract with the strict `Text` mode, `tagClassMap` and
`renderMode: 'inline'`:

```ts
import { createA2uiMarkdownRenderer } from '@render-policy/a2ui';

const markdown = createA2uiMarkdownRenderer({ guard }); // share the guard with the rest of the surface
// React: <MarkdownContext.Provider value={markdown}>; Angular: provideMarkdownRenderer(markdown)
```

This is the compatibility path, and it is weaker than a fragment: the HTML is serialized here and
parsed again by the renderer. Where you render `Text` yourself, use `guard.renderText()`.

## Proofs

`test/` checks the guard in jsdom. `e2e/run.mjs` runs an A2UI v0.9 surface in Chromium: image,
video and icon URLs arrive literally, through `updateDataModel` and through `formatString`; `Text`
carries Markdown images, raw HTML and links; a button calls `openUrl('javascript:…')`. With the guard,
no request reaches a host outside the allowlist, the token assembled by `formatString` never leaves,
and nothing opens. The same messages without the guard are the control: they make those requests.

For CI, [`mcp-app-lint --a2ui`](../mcp-app-lint#a2ui-rules) scans recorded A2UI message streams
for the same hazards before anything renders. Not covered yet: A2UI cases in the evil-Markdown
corpus. A2UI v1.0 follows when that version is stable.
