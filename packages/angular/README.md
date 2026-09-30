# @render-policy/angular

Angular adapter for [`@render-policy/core`](../core): render agent content without `[innerHTML]`
or `bypassSecurityTrustHtml()`.

```ts
import { provideRenderPolicy, RpMarkdownComponent, RpRenderDirective } from '@render-policy/angular';

bootstrapApplication(AppComponent, {
  providers: [provideRenderPolicy({ mode: 'balanced', policy: { imageHosts: ['cdn.example.com'] } })],
});
```

```html
<div [rpRender]="message.content"></div>
<div [rpRender]="html" rpRenderMode="html"></div>
<div [rpRender]="message.content" [rpRenderStreaming]="message.pending"></div>
<rp-markdown [content]="message.content" [streaming]="message.pending" />
```

- `RpRenderDirective` renders into its host element on every change of `rpRender`; with
  `rpRenderStreaming` true the growing text is rendered at most once per animation frame with
  incomplete URLs withheld, and when it turns false the final text is rendered once.
- `RpMarkdownComponent` is the same for Markdown, as an element with `content` and `streaming` inputs.
- Both are wrappers over `createContentBinding()` from the core, so they behave exactly alike.
- `RENDERER` is the injectable renderer; `RENDER_POLICY_CONFIG` holds the options.
- On the server (no `window`) both insert plain text.

Requires Angular 19 or later (signal inputs and `effect()`).

Build and publish:

```
npm run build -w packages/angular   # ng-packagr, partial compilation, output in packages/angular/dist
cd packages/angular/dist && npm publish
```
