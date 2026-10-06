import type { Rule } from 'eslint';
import type * as ESTree from 'estree';

/**
 * Flags HTML injection sinks that receive anything other than a static string:
 *
 *   el.innerHTML = x            el.outerHTML = x          el.innerHTML += x
 *   el.insertAdjacentHTML(p, x) el.setHTMLUnsafe(x)       range.createContextualFragment(x)
 *   document.write(x)           document.writeln(x)
 *   sanitizer.bypassSecurityTrustHtml(x)                  (Angular)
 *   <div dangerouslySetInnerHTML={{ __html: x }} />       (React)
 *
 * A static string literal is allowed by default (`el.innerHTML = '<hr>'`): it cannot carry
 * agent content. Set `allowStatic: false` to forbid the sinks altogether.
 *
 * `escapeFunctions` (default none) names functions whose result counts as static, by identifier
 * (`esc`) or dotted path (`DOMPurify.sanitize`): `'<b>' + esc(name) + '</b>'` then passes. The
 * rule trusts the name, not the implementation, and HTML escaping does not make a value safe in
 * a URL attribute (`href="javascript:…"`); it is meant for auditing code you do not own.
 */

interface Options {
  readonly allowStatic?: boolean;
  readonly escapeFunctions?: readonly string[];
}

const SINK_PROPERTIES = new Set(['innerHTML', 'outerHTML']);

/** Method name to the index of its HTML argument. */
const SINK_METHODS = new Map<string, number>([
  ['insertAdjacentHTML', 1],
  ['setHTMLUnsafe', 0],
  ['createContextualFragment', 0],
]);

const DOCUMENT_METHODS = new Set(['write', 'writeln']);
const BYPASS_METHODS = new Set(['bypassSecurityTrustHtml']);

interface JsxAttributeNode {
  readonly type: 'JSXAttribute';
  readonly name: { readonly type: string; readonly name?: string };
  readonly value: { readonly type: string; readonly expression?: ESTree.Node } | null;
  readonly loc?: ESTree.SourceLocation | null;
}

function propertyName(node: ESTree.MemberExpression): string | null {
  if (!node.computed && node.property.type === 'Identifier') return node.property.name;
  if (node.computed && node.property.type === 'Literal' && typeof node.property.value === 'string') return node.property.value;
  return null;
}

/** `a.b.c` for a chain of identifiers, else null. */
function dottedName(node: ESTree.Node): string | null {
  if (node.type === 'Identifier') return node.name;
  if (node.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier') {
    const object = dottedName(node.object);
    return object === null ? null : `${object}.${node.property.name}`;
  }
  return null;
}

function isStatic(node: ESTree.Node | null | undefined, escapes: ReadonlySet<string> = new Set()): boolean {
  if (!node) return false;
  switch (node.type) {
    case 'Literal':
      return true;
    case 'TemplateLiteral':
      return node.expressions.every((expression) => isStatic(expression, escapes));
    case 'BinaryExpression':
      return node.operator === '+' && isStatic(node.left, escapes) && isStatic(node.right, escapes);
    case 'ConditionalExpression':
      return isStatic(node.consequent, escapes) && isStatic(node.alternate, escapes);
    case 'CallExpression': {
      const name = escapes.size > 0 && node.callee.type !== 'Super' ? dottedName(node.callee) : null;
      return name !== null && escapes.has(name);
    }
    default:
      return false;
  }
}

function isDocument(node: ESTree.Expression | ESTree.Super): boolean {
  if (node.type === 'Identifier') return node.name === 'document';
  if (node.type === 'MemberExpression') return propertyName(node) === 'document';
  return false;
}

const rule: Rule.RuleModule = {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow HTML injection sinks (innerHTML, outerHTML, insertAdjacentHTML, document.write, bypassSecurityTrustHtml, dangerouslySetInnerHTML) with non-static content.',
      recommended: true,
      url: 'https://github.com/shteynu/render-policy/tree/main/packages/eslint-plugin#no-unsafe-innerhtml',
    },
    schema: [
      {
        type: 'object',
        properties: {
          allowStatic: { type: 'boolean' },
          escapeFunctions: { type: 'array', items: { type: 'string' }, uniqueItems: true },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      assignment:
        'Assigning {{what}} to {{sink}} injects markup into the live DOM. Sanitize into a fragment and insert it with replaceChildren(), for example renderHtmlInto() from @render-policy/core.',
      method: '{{method}}() is an HTML injection sink. Pass sanitized markup only, or render through @render-policy/core.',
      bypass:
        'bypassSecurityTrustHtml() switches Angular\'s sanitizer off for this value. Render agent content with [rpRender] or <rp-markdown> from @render-policy/angular instead.',
      jsx: 'dangerouslySetInnerHTML injects markup into the DOM. Sanitize first (renderer.trustedHTML() from @render-policy/core) or render into a ref with renderHtmlInto().',
    },
  },

  create(context) {
    const options = (context.options[0] ?? {}) as Options;
    const allowStatic = options.allowStatic ?? true;
    const escapes = new Set(options.escapeFunctions ?? []);
    const allowed = (node: ESTree.Node | null | undefined): boolean => allowStatic && isStatic(node, escapes);

    const listeners: Rule.RuleListener = {
      AssignmentExpression(node) {
        if (node.left.type !== 'MemberExpression') return;
        const sink = propertyName(node.left);
        if (!sink || !SINK_PROPERTIES.has(sink)) return;
        if (node.operator === '=' && allowed(node.right)) return;
        context.report({
          node,
          messageId: 'assignment',
          data: { sink, what: node.operator === '=' ? 'dynamic content' : `content with ${node.operator}` },
        });
      },

      CallExpression(node) {
        if (node.callee.type !== 'MemberExpression') return;
        const method = propertyName(node.callee);
        if (!method) return;

        if (BYPASS_METHODS.has(method)) {
          if (allowed(node.arguments[0])) return;
          context.report({ node, messageId: 'bypass' });
          return;
        }

        let argumentIndex = SINK_METHODS.get(method);
        if (argumentIndex === undefined && DOCUMENT_METHODS.has(method) && isDocument(node.callee.object)) {
          argumentIndex = 0;
        }
        if (argumentIndex === undefined) return;
        const argument = node.arguments[argumentIndex];
        if (argument && argument.type !== 'SpreadElement' && allowed(argument)) return;
        if (!argument) return;
        context.report({ node, messageId: 'method', data: { method } });
      },
    };

    const jsx = (node: JsxAttributeNode): void => {
      if (node.name.name !== 'dangerouslySetInnerHTML') return;
      const expression = node.value?.type === 'JSXExpressionContainer' ? node.value.expression : undefined;
      if (expression?.type === 'ObjectExpression') {
        const html = expression.properties.find(
          (property): property is ESTree.Property =>
            property.type === 'Property' &&
            ((property.key.type === 'Identifier' && property.key.name === '__html') ||
              (property.key.type === 'Literal' && property.key.value === '__html')),
        );
        if (html && html.value.type !== 'AssignmentPattern' && html.value.type !== 'ArrayPattern' && html.value.type !== 'ObjectPattern' && allowed(html.value)) {
          return;
        }
      }
      context.report({ node: node as unknown as ESTree.Node, messageId: 'jsx' });
    };

    return { ...listeners, JSXAttribute: jsx } as unknown as Rule.RuleListener;
  },
};

export default rule;
