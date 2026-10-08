---
name: safe-agent-html
description: Render Markdown or HTML that an LLM, agent or tool produced without innerHTML, dangerouslySetInnerHTML or [innerHTML]. Use when writing or reviewing frontend code that displays model output, chat messages, tool results or other agent-generated content in the DOM (plain DOM, React, Angular), including streaming replies and Mermaid diagrams, or when such code assigns to an HTML sink. Also use when building an A2UI client or component that renders agent-supplied Text, Image, Video, AudioPlayer or openUrl values.
---

# Safe rendering of agent output

Agent output is untrusted input that arrives with the page's privileges. A prompt injection
upstream turns it into an attacker's markup. Sanitizing and then assigning `innerHTML` still leaves
data paths open: a remote image leaks data in its URL with no click, a link can carry a
`javascript:` URL, and content can imitate the host UI. render-policy sanitizes into a
`DocumentFragment` (DOMPurify), applies a policy for images, links and hosts, and inserts with
`replaceChildren()`.

## When the code has an HTML sink

Look for any of these receiving agent, model or tool text:

- `el.innerHTML = …`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `setHTMLUnsafe`,
  `createContextualFragment`
- React `dangerouslySetInnerHTML`
- Angular `[innerHTML]`, `bypassSecurityTrustHtml()`
- a Markdown library's HTML string piped into one of the above

Replace the sink with the adapter for the framework in use. Do not wrap the existing string sink
in a hand-written sanitizer.

## Pick the package

| Code | Package | Use |
| --- | --- | --- |
| Plain DOM, Vue, Svelte, Web Components | `@render-policy/core` | `createRenderer(config).renderMarkdownInto(el, text)` |
| React 18+ | `@render-policy/react` | `<RpMarkdown content={text} streaming={pending} />` inside `<RenderPolicyProvider config={config}>` |
| Angular 19+ | `@render-policy/angular` | `provideRenderPolicy(config)`, then `<div [rpRender]="text" [rpRenderStreaming]="pending"></div>` |
| Mermaid blocks in agent output | `@render-policy/mermaid` | `transforms: [createMermaidTransform({ mermaid })]` in the renderer config |
| A2UI v0.9 surface (agent sends components, not HTML) | `@render-policy/a2ui` | `createA2uiGuard(config)`; components in `@render-policy/react/a2ui` and `@render-policy/angular/a2ui` |

The packages are ESM only. Install with the project's package manager, for example
`npm install @render-policy/core`.

## Core

```ts
import { createRenderer } from '@render-policy/core';

const renderer = createRenderer({
  mode: 'balanced',
  policy: { images: { hosts: ['cdn.example.com'] } },
  onDecision: (d) => console.debug('[render-policy]', d.code, d.reason),
});

renderer.renderMarkdownInto(element, message.content); // one shot
renderer.renderHtmlInto(element, html);                 // agent HTML
renderer.renderTextInto(element, text);                 // plain text

const stream = renderer.createStream(element);          // streaming tokens
for await (const chunk of tokens) stream.push(chunk);
stream.end();
```

For another framework, wrap `createContentBinding(renderer, element, { mode, schedule, onDecisions })`
and call `update(content, streaming)` on every change, as the React and Angular adapters do. Do not
build a separate streaming lifecycle.

## React

```tsx
import { RenderPolicyProvider, RpMarkdown, RpHtml } from '@render-policy/react';

const config = { mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } }; // module scope or useMemo

<RenderPolicyProvider config={config}>
  <RpMarkdown content={message.content} streaming={message.pending} className="message" />
</RenderPolicyProvider>
```

`useRenderPolicy(content, { streaming })` returns a ref for an element of your own. That element
must have no React-managed children.

## Angular

```ts
providers: [provideRenderPolicy({ mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } })]
```

```html
<div [rpRender]="message.content" [rpRenderStreaming]="message.pending"></div>
<div [rpRender]="html" rpRenderMode="html"></div>
<rp-markdown [content]="message.content" [streaming]="message.pending" />
```

## A2UI

An A2UI agent sends no HTML, so there is no sink to replace. The data path is in the values:
`Image.url`, `Video.url`, `AudioPlayer.url` and `theme.iconUrl` are fetched as soon as they render,
`openUrl` navigates, and `Text` carries Markdown that the catalog says has no HTML, images or links
(guidance to the agent, not a guarantee). Most of these values are bound to the data model or built
with `formatString`, so check the resolved value where the renderer uses it, not the message JSON.

```ts
import { createA2uiGuard, createA2uiMarkdownRenderer } from '@render-policy/a2ui';

const guard = createA2uiGuard({ policy: { images: { hosts: ['cdn.example.com'] } } });

const r = guard.url('image', resolvedUrl, { surfaceId, componentId }); // also 'video', 'audio', 'icon'
if (r.allowed) img.src = r.value;              // use r.value, not the input
guard.openUrl(resolvedArgs.url);               // http/https only, noopener,noreferrer
guard.renderText(element, resolvedText);       // Text without HTML, images or links

const markdown = createA2uiMarkdownRenderer({ guard }); // the A2UI renderers' Markdown plug-in
```

In React use `<A2uiGuardProvider config={…}>` with `<RpA2uiText>` and `<RpA2uiImage>` from
`@render-policy/react/a2ui`; in Angular `provideA2uiGuard(config)` with `<rp-a2ui-text>` and
`<rp-a2ui-image>` from `@render-policy/angular/a2ui`. Both need `@render-policy/a2ui` installed.
Prefer them, or `guard.renderText()`, over the Markdown plug-in: the plug-in returns a string that
the renderer parses again.

## Choose the mode and the policy

- `balanced` (default): remote images only from the hosts you list, exact match, query string
  stripped; hosts that accept data from anyone (request catchers, tunnels, shared storage) are
  blocked.
- `strict`: no remote images. Use for content from untrusted sources: web browsing agents, inbound
  email, retrieved documents.
- `permissive`: keeps the sanitizer and only logs what the stricter modes would block. Use it to
  measure before switching, not as the end state.

List image hosts in `policy.images.hosts`. Ask the user for the hosts their content really uses
rather than allowing a wildcard. Every decision in the journal (`onDecision`) has a stable `code`
such as `image-host-not-allowed`, `scheme-not-allowed`, `sink-host`, `transform-failed`.

## Keep it enforced

Add the ESLint plugin so new sinks do not come back:

```js
// eslint.config.js
import renderPolicy from 'eslint-plugin-render-policy';
export default [renderPolicy.configs.recommended];
```

For Angular templates add `renderPolicy.configs['angular-templates']` with
`@angular-eslint/template-parser`.

If a string sink cannot be removed (a third-party API that takes HTML), use `trustedHTML()` from
the core: it returns sanitized `TrustedHTML` where Trusted Types exist.

Documentation, policy reference and threat model: https://github.com/shteynu/render-policy#readme
