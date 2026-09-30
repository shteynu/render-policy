import type { ESLint, Linter } from 'eslint';
import noInnerhtmlBinding from './rules/no-innerhtml-binding.js';
import noUnsafeInnerhtml from './rules/no-unsafe-innerhtml.js';

const rules = {
  'no-unsafe-innerhtml': noUnsafeInnerhtml,
  'no-innerhtml-binding': noInnerhtmlBinding,
};

interface RenderPolicyPlugin extends ESLint.Plugin {
  readonly meta: { readonly name: string; readonly version: string };
  readonly rules: typeof rules;
  configs: {
    /** JS/TS/JSX sources. */
    recommended: Linter.Config;
    /** Angular templates. Pair it with `@angular-eslint/template-parser` for `*.html`. */
    'angular-templates': Linter.Config;
  };
}

const plugin: RenderPolicyPlugin = {
  meta: { name: 'eslint-plugin-render-policy', version: '0.1.0' },
  rules,
  configs: {
    recommended: {},
    'angular-templates': {},
  },
};

plugin.configs.recommended = {
  name: 'render-policy/recommended',
  plugins: { 'render-policy': plugin },
  rules: { 'render-policy/no-unsafe-innerhtml': 'error' },
};

plugin.configs['angular-templates'] = {
  name: 'render-policy/angular-templates',
  files: ['**/*.html'],
  plugins: { 'render-policy': plugin },
  rules: { 'render-policy/no-innerhtml-binding': 'error' },
};

export { noInnerhtmlBinding, noUnsafeInnerhtml, rules };
export default plugin;
