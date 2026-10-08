import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject, type Provider } from '@angular/core';
import { createA2uiGuard, type A2uiGuard, type A2uiGuardOptions } from '@render-policy/a2ui';

/** Everything createA2uiGuard() takes except the window, which comes from DOCUMENT. */
export type A2uiGuardConfig = Omit<A2uiGuardOptions, 'window'>;

export const A2UI_GUARD_CONFIG = new InjectionToken<A2uiGuardConfig>('render-policy.a2ui-guard.config', {
  providedIn: 'root',
  factory: () => ({}),
});

/**
 * The guard for A2UI surfaces. Built from A2UI_GUARD_CONFIG and the window behind DOCUMENT, so
 * tests and platform-server setups can swap either.
 */
export const A2UI_GUARD = new InjectionToken<A2uiGuard>('render-policy.a2ui-guard', {
  providedIn: 'root',
  factory: () => {
    const window = inject(DOCUMENT).defaultView;
    if (!window) {
      throw new Error('@render-policy/angular/a2ui: DOCUMENT has no window. On the server provide A2UI_GUARD yourself, or render text only.');
    }
    return createA2uiGuard({ ...inject(A2UI_GUARD_CONFIG), window });
  },
});

/**
 * Configure the A2UI guard once:
 *
 *   bootstrapApplication(App, { providers: [provideA2uiGuard({ policy: { images: { hosts: ['cdn.example'] } } })] })
 */
export function provideA2uiGuard(config: A2uiGuardConfig): Provider[] {
  return [{ provide: A2UI_GUARD_CONFIG, useValue: config }];
}
