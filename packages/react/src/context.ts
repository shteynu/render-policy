import { createContext, createElement, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { createRenderer, type Renderer, type RendererOptions } from '@render-policy/core';

/** Everything createRenderer() takes except the window. */
export type RenderPolicyConfig = Omit<RendererOptions, 'window'>;

const RendererContext = createContext<Renderer | null | undefined>(undefined);

export interface RenderPolicyProviderProps {
  readonly children?: ReactNode;
  /** A renderer created once with createRenderer(). Takes precedence over `config`. */
  readonly renderer?: Renderer;
  /** Options for createRenderer(). Keep the object identity stable (module scope or useMemo). */
  readonly config?: RenderPolicyConfig;
}

/**
 * Provides one renderer to the tree:
 *
 *   <RenderPolicyProvider config={{ mode: 'balanced', policy: { imageHosts: ['cdn.example'] } }}>
 *
 * On the server (no window) the provided value is null and components render empty containers.
 */
export function RenderPolicyProvider({ children, renderer, config }: RenderPolicyProviderProps): ReactElement {
  const value = useMemo(() => renderer ?? (canRender() ? createRenderer(config ?? {}) : null), [renderer, config]);
  return createElement(RendererContext.Provider, { value }, children);
}

let fallback: Renderer | null | undefined;

/** The renderer from the nearest provider, or a default balanced renderer without one. Null on the server. */
export function useRenderer(): Renderer | null {
  const provided = useContext(RendererContext);
  if (provided !== undefined) return provided;
  if (fallback === undefined) fallback = canRender() ? createRenderer() : null;
  return fallback;
}

function canRender(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
