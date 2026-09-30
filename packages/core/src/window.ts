import type { TrustedTypePolicyFactory } from 'trusted-types/lib/index.js';

/**
 * The part of a window the renderer needs: the document to create nodes in and the DOM
 * constructors the HTML parser runs with. A browser window and a JSDOM window both fit.
 * This is the library's own type on purpose: the sanitizer's dependency is an implementation
 * detail, and its types never appear in the public API.
 */
export type RenderWindow = Pick<
  typeof globalThis,
  'DocumentFragment' | 'HTMLTemplateElement' | 'Node' | 'Element' | 'NodeFilter' | 'NamedNodeMap' | 'HTMLFormElement' | 'DOMParser'
> & {
  readonly document: Document;
  readonly trustedTypes?: TrustedTypePolicyFactory;
  readonly requestAnimationFrame?: (callback: () => void) => number;
};

/** The given window, else the global one, else a clear error naming the package that needs it. */
export function resolveWindow(win: RenderWindow | undefined, packageName = '@render-policy/core'): RenderWindow {
  if (win) return win;
  if (typeof window !== 'undefined') return window as unknown as RenderWindow;
  throw new Error(`${packageName}: no global window. Pass { window } (for example a JSDOM window) outside a browser.`);
}
