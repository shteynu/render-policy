# Migrating to render-policy

## From `innerHTML`

Before:

```ts
element.innerHTML = DOMPurify.sanitize(marked.parse(message));
```

After:

```ts
const renderer = createRenderer({ policy: { imageHosts: ['cdn.example.com'] } });
renderer.renderMarkdownInto(element, message);
```

What changes: Markdown is converted first and sanitized last; images load only from listed hosts;
sink hosts and encoded payloads are blocked; `target="_blank"` gets `rel="noopener noreferrer"`;
`style`, `class` outside the allowlist, `data-*`, forms and SVG are gone; and the assignment is
`replaceChildren(fragment)`, so the code keeps working when you turn on
`require-trusted-types-for 'script'`.

If you rendered HTML rather than Markdown, use `renderHtmlInto()`. If you streamed by
re-assigning `innerHTML` on every token, use `createStream()` and `push()`.

Run `eslint-plugin-render-policy` to find the remaining sinks.

## From Angular `[innerHTML]`

Before:

```html
<div [innerHTML]="message.content"></div>
```

```ts
this.safeHtml = this.sanitizer.bypassSecurityTrustHtml(marked.parse(md));
```

After:

```html
<div [rpRender]="message.content"></div>
```

```ts
bootstrapApplication(AppComponent, { providers: [provideRenderPolicy({ mode: 'balanced', policy: { imageHosts: ['cdn.example.com'] } })] });
```

Angular's built-in sanitizer keeps every `https:` image and every `https:` link; it has no notion of
a host policy, and `bypassSecurityTrustHtml()` turns it off entirely. `[rpRender]` never binds a string
into the DOM, so nothing needs bypassing. `no-innerhtml-binding` flags the bindings you missed.

## From ngx-markdown

Before:

```html
<markdown [data]="message.content"></markdown>
```

After:

```html
<rp-markdown [content]="message.content" [streaming]="message.pending" />
```

ngx-markdown renders through `innerHTML` and, when configured, Angular's sanitizer. There is no host
policy for images and no streaming mode. A provider that routes ngx-markdown through render-policy
is on the roadmap; until then, replace the component where agent content is shown and keep
ngx-markdown for content you author.

Styling: `<rp-markdown>` has the host class `rp-markdown`; a blocked image is
`a.rp-blocked-image`. Code blocks keep `language-*` classes for highlighters.

## From React `dangerouslySetInnerHTML`

Until the React adapter ships, render into a ref:

```tsx
const ref = useRef<HTMLDivElement>(null);
useEffect(() => {
  if (ref.current) renderer.renderMarkdownInto(ref.current, message.content);
}, [message.content]);
return <div ref={ref} />;
```

For streaming, keep one `createStream(ref.current)` per message and call `set(text)` on every update.
