# @render-policy/core

Render Markdown or HTML that an agent wrote without ever assigning `innerHTML`: sanitize into a
`DocumentFragment`, apply a policy for images, links and hosts, insert with `replaceChildren()`.
Trusted Types compatible. Streaming aware.

```ts
import { createRenderer } from '@render-policy/core';

const renderer = createRenderer({ mode: 'balanced', policy: { imageHosts: ['cdn.example.com'] } });
renderer.renderMarkdownInto(element, message.content);

const stream = renderer.createStream(element);
stream.push(chunk);
stream.end();
```

`createContentBinding(renderer, element, { mode, schedule, onDecisions })` is the lifecycle a framework
adapter needs (`update(content, streaming)`); the building blocks the renderer is made of are in
`@render-policy/core/internal`, outside semver.

Full documentation, modes, policy reference and threat model: the
[repository README](https://github.com/shteynu/render-policy#readme).
