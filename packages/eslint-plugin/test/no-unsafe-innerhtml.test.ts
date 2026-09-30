import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../src/rules/no-unsafe-innerhtml.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    ecmaVersion: 2022,
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

tester.run('no-unsafe-innerhtml', rule, {
  valid: [
    "el.innerHTML = '<hr>';",
    'el.innerHTML = `<p>static</p>`;',
    "el.innerHTML = '';",
    "el.innerHTML = cond ? '<a>' : '<b>';",
    "el.innerHTML = '<p>' + '</p>';",
    'el.textContent = userInput;',
    'const html = el.innerHTML;',
    'if (el.innerHTML === x) {}',
    "el.insertAdjacentHTML('beforeend', '<hr>');",
    "sanitizer.bypassSecurityTrustHtml('<b>static</b>');",
    "const node = <div dangerouslySetInnerHTML={{ __html: '<b>static</b>' }} />;",
    'el.setHTML(userInput);',
    'stream.write(chunk);',
    'res.writeln(line);',
    'renderer.renderHtmlInto(el, html);',
  ],
  invalid: [
    { code: 'el.innerHTML = userInput;', errors: [{ messageId: 'assignment', data: { sink: 'innerHTML', what: 'dynamic content' } }] },
    { code: 'el.outerHTML = tpl;', errors: [{ messageId: 'assignment' }] },
    { code: 'el.innerHTML += chunk;', errors: [{ messageId: 'assignment', data: { sink: 'innerHTML', what: 'content with +=' } }] },
    { code: 'el.innerHTML = `<p>${x}</p>`;', errors: [{ messageId: 'assignment' }] },
    { code: "el['innerHTML'] = x;", errors: [{ messageId: 'assignment' }] },
    { code: "el.innerHTML = '<p>' + x;", errors: [{ messageId: 'assignment' }] },
    { code: 'el.innerHTML = String(x);', errors: [{ messageId: 'assignment' }] },
    { code: 'this.host.nativeElement.innerHTML = marked.parse(md);', errors: [{ messageId: 'assignment' }] },
    { code: "el.insertAdjacentHTML('beforeend', html);", errors: [{ messageId: 'method', data: { method: 'insertAdjacentHTML' } }] },
    { code: 'document.write(html);', errors: [{ messageId: 'method', data: { method: 'write' } }] },
    { code: 'window.document.writeln(html);', errors: [{ messageId: 'method' }] },
    { code: 'range.createContextualFragment(html);', errors: [{ messageId: 'method' }] },
    { code: 'el.setHTMLUnsafe(html);', errors: [{ messageId: 'method' }] },
    { code: 'this.sanitizer.bypassSecurityTrustHtml(html);', errors: [{ messageId: 'bypass' }] },
    { code: 'const node = <div dangerouslySetInnerHTML={{ __html: html }} />;', errors: [{ messageId: 'jsx' }] },
    { code: 'const node = <div dangerouslySetInnerHTML={props.raw} />;', errors: [{ messageId: 'jsx' }] },
    { code: "el.innerHTML = '<hr>';", options: [{ allowStatic: false }], errors: [{ messageId: 'assignment' }] },
    { code: "sanitizer.bypassSecurityTrustHtml('<b>static</b>');", options: [{ allowStatic: false }], errors: [{ messageId: 'bypass' }] },
  ],
});
