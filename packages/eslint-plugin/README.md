# eslint-plugin-render-policy

Two rules that make HTML injection sinks visible.

```js
// eslint.config.js
import renderPolicy from 'eslint-plugin-render-policy';
import templateParser from '@angular-eslint/template-parser';

export default [
  renderPolicy.configs.recommended,
  { ...renderPolicy.configs['angular-templates'], languageOptions: { parser: templateParser } },
];
```

## no-unsafe-innerhtml

Flags, unless the value is a static string:

- `el.innerHTML = x`, `el.outerHTML = x`, `el.innerHTML += x`, `el['innerHTML'] = x`
- `el.insertAdjacentHTML(position, x)`, `el.setHTMLUnsafe(x)`, `range.createContextualFragment(x)`
- `document.write(x)`, `document.writeln(x)`
- `sanitizer.bypassSecurityTrustHtml(x)` (Angular)
- `<div dangerouslySetInnerHTML={{ __html: x }} />` (React)

Option `allowStatic` (default `true`): set to `false` to flag the sinks even with static strings.

## no-innerhtml-binding

Angular templates (needs `@angular-eslint/template-parser`): flags `[innerHTML]`, `[(innerHTML)]`,
`bind-innerHTML`, `[innerHtml]` and `[outerHTML]`. A static `innerHTML="…"` attribute is allowed.
