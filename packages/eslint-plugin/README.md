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

Option `escapeFunctions` (default `[]`): names of functions whose result counts as static, as an
identifier (`esc`) or a dotted path (`DOMPurify.sanitize`), so `'<b>' + esc(name) + '</b>'` passes.
The rule trusts the name, not the implementation, and HTML escaping does not make a value safe
inside a URL attribute (`href`, `src`). Meant for auditing code you do not own (`mcp-app-lint` uses
it to separate escaped templates from unescaped ones); in your own code, render through a policy.

## no-innerhtml-binding

Angular templates (needs `@angular-eslint/template-parser`): flags `[innerHTML]`, `[(innerHTML)]`,
`bind-innerHTML`, `[innerHtml]` and `[outerHTML]`. A static `innerHTML="…"` attribute is allowed.
