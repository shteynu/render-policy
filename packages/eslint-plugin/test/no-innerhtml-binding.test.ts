import * as templateParser from '@angular-eslint/template-parser';
import { RuleTester } from 'eslint';
import { describe, it } from 'vitest';
import rule from '../src/rules/no-innerhtml-binding.js';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const tester = new RuleTester({
  languageOptions: {
    parser: templateParser,
  },
});

tester.run('no-innerhtml-binding', rule, {
  valid: [
    { code: '<div [rpRender]="message.content"></div>', filename: 'a.component.html' },
    { code: '<rp-markdown [content]="message.content" [streaming]="true"></rp-markdown>', filename: 'a.component.html' },
    { code: '<div innerHTML="<b>static</b>"></div>', filename: 'a.component.html' },
    { code: '<div [textContent]="message.content"></div>', filename: 'a.component.html' },
    { code: '<div [title]="message.content" (click)="open()"></div>', filename: 'a.component.html' },
  ],
  invalid: [
    { code: '<div [innerHTML]="message.content"></div>', filename: 'a.component.html', errors: [{ messageId: 'binding', data: { name: 'innerHTML' } }] },
    { code: '<div [(innerHTML)]="draft"></div>', filename: 'a.component.html', errors: [{ messageId: 'binding' }] },
    { code: '<div bind-innerHTML="draft"></div>', filename: 'a.component.html', errors: [{ messageId: 'binding' }] },
    { code: '<div [innerHtml]="html"></div>', filename: 'a.component.html', errors: [{ messageId: 'binding' }] },
    { code: '<span [outerHTML]="html"></span>', filename: 'a.component.html', errors: [{ messageId: 'binding' }] },
    { code: '<div [innerHTML]="sanitizer.bypassSecurityTrustHtml(html)"></div>', filename: 'a.component.html', errors: [{ messageId: 'binding' }] },
    {
      code: '<section><p [innerHTML]="a"></p><p [innerHTML]="b"></p></section>',
      filename: 'a.component.html',
      errors: [{ messageId: 'binding' }, { messageId: 'binding' }],
    },
  ],
});
