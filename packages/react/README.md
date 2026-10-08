# @render-policy/react

React adapter for [`@render-policy/core`](../core): render agent Markdown or HTML without
`dangerouslySetInnerHTML`, with a streaming mode.

```tsx
import { RenderPolicyProvider, RpMarkdown, RpHtml, useRenderPolicy } from '@render-policy/react';

const config = { mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } };

function App() {
  return (
    <RenderPolicyProvider config={config}>
      <RpMarkdown content={message.content} streaming={message.pending} className="message" />
    </RenderPolicyProvider>
  );
}
```

- `RenderPolicyProvider` builds one renderer for the tree from `config`, or takes a prebuilt `renderer`.
  Keep `config` referentially stable (module scope or `useMemo`).
- `RpMarkdown` / `RpHtml` render into an element (`as`, default `div`) that React owns but never fills.
  While `streaming` is true the growing text is rendered at most once per animation frame, with
  incomplete URLs withheld, unfinished code fences closed and settled blocks kept in place; when it
  turns false the final text is rendered once.
- `useRenderPolicy(content, { mode, streaming, scheduler, onDecisions })` returns a ref for an element
  of your own. The element must have no React-managed children. `onDecisions` receives the journal of
  every one-shot render and of the final render of a stream.
- `useRenderer()` returns the renderer from the nearest provider, or a default balanced one.
- Without a provider the components still work with the balanced defaults.
- On the server the components render an empty container; content appears on the client.

## A2UI Text and Image

`@render-policy/react/a2ui` has the basic catalog's `Text` and `Image` for an A2UI v0.9 surface of your
own. They take the values your renderer resolved (after data binding and `formatString`) and run
them through [`@render-policy/a2ui`](../a2ui), an optional peer dependency you install for this entry.

```tsx
import { A2uiGuardProvider, RpA2uiImage, RpA2uiText } from '@render-policy/react/a2ui';

const guard = { policy: { images: { hosts: ['cdn.example.com'] } }, onDecision: log };

<A2uiGuardProvider config={guard}>
  <RpA2uiText text={resolve(props.text)} variant={props.variant} componentId={id} />
  <RpA2uiImage url={resolve(props.url)} description={resolve(props.description)} fit={props.fit} variant={props.variant} fallback={<span>image blocked</span>} />
</A2uiGuardProvider>
```

- `RpA2uiText` holds `Text` to the catalog's contract (Markdown without HTML, images or links) and
  inserts a sanitized fragment; `h1`–`h5` render as headings and, like `caption`, without block
  wrappers. A bound value swapped later is rendered again through the same check.
- `RpA2uiImage` checks the URL before an `<img>` exists: a blocked URL never reaches the DOM, so the
  browser makes no request, and `fallback` renders instead. The `src` is the value the guard returns
  (for example with the query string stripped).
- `variant` and `fit` come from the agent: values outside the catalog's enums count as the defaults,
  so they never become a tag name or a class of the host page.
- Classes follow the A2UI renderers' (`a2ui-text h2`, `a2ui-image avatar`), so their styles apply.
- `onDecisions` receives the journal of each check; `useA2uiGuard()` returns the guard in use.
- On the server `RpA2uiText` renders an empty element and `RpA2uiImage` only its `fallback`.

Requires React 18 or later.
