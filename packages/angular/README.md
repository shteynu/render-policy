# @render-policy/angular

Angular adapter for [`@render-policy/core`](../core): render agent content without `[innerHTML]`
or `bypassSecurityTrustHtml()`.

```ts
import { provideRenderPolicy, RpMarkdownComponent, RpRenderDirective } from '@render-policy/angular';

bootstrapApplication(AppComponent, {
  providers: [provideRenderPolicy({ mode: 'balanced', policy: { images: { hosts: ['cdn.example.com'] } } })],
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

## A2UI Text and Image

`@render-policy/angular/a2ui` is a secondary entry point with the basic catalog's `Text` and `Image`
for an A2UI v0.9 surface of your own. They take the values your renderer resolved (after data
binding and `formatString`) and run them through [`@render-policy/a2ui`](../a2ui), an optional peer
dependency you install for this entry.

```ts
import { provideA2uiGuard, RpA2uiImageComponent, RpA2uiTextComponent } from '@render-policy/angular/a2ui';

bootstrapApplication(AppComponent, {
  providers: [provideA2uiGuard({ policy: { images: { hosts: ['cdn.example.com'] } } })],
});
```

```html
<rp-a2ui-text [text]="text()" [variant]="props.variant" [componentId]="id" (decisions)="log($event)" />
<rp-a2ui-image [url]="url()" [description]="description()" [fit]="props.fit" [variant]="props.variant">image blocked</rp-a2ui-image>
```

- `<rp-a2ui-text>` holds `Text` to the catalog's contract (Markdown without HTML, images or links)
  and inserts a sanitized fragment into one element: `h1`–`h5` for headings, a `span` for
  `caption`, a `div` for `body`. A bound value swapped later is rendered again through the same check.
- `<rp-a2ui-image>` checks the URL before an `<img>` exists: a blocked URL never reaches the DOM, so
  the browser makes no request, and the projected content renders instead.
- `variant` and `fit` come from the agent: values outside the catalog's enums count as the defaults,
  so they never become a tag name or a class of the host page.
- `A2UI_GUARD` is the injectable guard; `A2UI_GUARD_CONFIG` holds the options.
- On the server `<rp-a2ui-text>` inserts plain text and `<rp-a2ui-image>` only its projected content.

Requires Angular 19 or later (signal inputs and `effect()`).

Build and publish:

```
npm run build -w packages/angular   # ng-packagr, partial compilation, output in packages/angular/dist
cd packages/angular/dist && npm publish
```
