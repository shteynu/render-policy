# @render-policy/react

React adapter for [`@render-policy/core`](../core): render agent Markdown or HTML without
`dangerouslySetInnerHTML`, with a streaming mode.

```tsx
import { RenderPolicyProvider, RpMarkdown, RpHtml, useRenderPolicy } from '@render-policy/react';

const config = { mode: 'balanced', policy: { imageHosts: ['cdn.example.com'] } };

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
  of your own. The element must have no React-managed children.
- `useRenderer()` returns the renderer from the nearest provider, or a default balanced one.
- Without a provider the components still work with the balanced defaults.
- On the server the components render an empty container; content appears on the client.

Requires React 18 or later.
