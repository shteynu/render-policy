import { createContext, createElement, useContext, useMemo, type ReactElement, type ReactNode } from 'react';
import { createA2uiGuard, type A2uiGuard, type A2uiGuardOptions } from '@render-policy/a2ui';

/** Everything createA2uiGuard() takes except the window. */
export type A2uiGuardConfig = Omit<A2uiGuardOptions, 'window'>;

const GuardContext = createContext<A2uiGuard | null | undefined>(undefined);

export interface A2uiGuardProviderProps {
  readonly children?: ReactNode;
  /** A guard created once with createA2uiGuard(). Takes precedence over `config`. */
  readonly guard?: A2uiGuard;
  /** Options for createA2uiGuard(). Keep the object identity stable (module scope or useMemo). */
  readonly config?: A2uiGuardConfig;
}

/**
 * Provides one A2UI guard to a surface:
 *
 *   <A2uiGuardProvider config={{ policy: { images: { hosts: ['cdn.example'] } }, onDecision: log }}>
 *
 * On the server (no window) the provided value is null: Text renders an empty element, Image its fallback.
 */
export function A2uiGuardProvider({ children, guard, config }: A2uiGuardProviderProps): ReactElement {
  const value = useMemo(() => guard ?? (canRender() ? createA2uiGuard(config ?? {}) : null), [guard, config]);
  return createElement(GuardContext.Provider, { value }, children);
}

let fallback: A2uiGuard | null | undefined;

/** The guard from the nearest provider, or a default balanced guard without one. Null on the server. */
export function useA2uiGuard(): A2uiGuard | null {
  const provided = useContext(GuardContext);
  if (provided !== undefined) return provided;
  if (fallback === undefined) fallback = canRender() ? createA2uiGuard() : null;
  return fallback;
}

function canRender(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
