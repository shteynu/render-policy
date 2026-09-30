import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

/**
 * Angular templates: flags `[innerHTML]`, `[(innerHTML)]`, `bind-innerHTML`, `[outerHTML]`
 * and the `innerHtml` spelling Angular maps to the same property.
 *
 * Angular sanitizes `[innerHTML]` unless the value went through bypassSecurityTrustHtml(),
 * but it cannot apply an image-host or link policy, and it is a string sink under
 * Trusted Types. A static `innerHTML="..."` attribute is not flagged.
 *
 * Requires `@angular-eslint/template-parser` for `*.html` files.
 */

const SINKS = new Set(['innerhtml', 'outerhtml']);

interface BoundAttributeNode {
  readonly type: 'BoundAttribute';
  readonly name: string;
  readonly loc?: ESTree.SourceLocation;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow [innerHTML], [(innerHTML)] and [outerHTML] bindings in Angular templates.',
      recommended: true,
      url: 'https://github.com/shteynu/render-policy/tree/main/packages/eslint-plugin#no-innerhtml-binding',
    },
    schema: [],
    messages: {
      binding:
        '[{{name}}] binds markup into the live DOM: no image or link policy applies, and it is a string sink under Trusted Types. Render agent content with [rpRender] or <rp-markdown> from @render-policy/angular.',
    },
  },

  create(context) {
    return {
      BoundAttribute(node: BoundAttributeNode) {
        if (!SINKS.has(node.name.toLowerCase())) return;
        context.report({ node: node as unknown as ESTree.Node, messageId: 'binding', data: { name: node.name } });
      },
    } as unknown as Rule.RuleListener;
  },
};

export default rule;
