import { DOCUMENT } from '@angular/common';
import { InjectionToken, inject, type Provider } from '@angular/core';
import { createRenderer, type Renderer, type RendererOptions } from '@render-policy/core';

/** Everything createRenderer() takes except the window, which comes from DOCUMENT. */
export type RenderPolicyConfig = Omit<RendererOptions, 'window'>;

export const RENDER_POLICY_CONFIG = new InjectionToken<RenderPolicyConfig>('render-policy.config', {
  providedIn: 'root',
  factory: () => ({}),
});

/**
 * The application-wide renderer. Built from RENDER_POLICY_CONFIG and the window
 * behind DOCUMENT, so tests and platform-server setups can swap either.
 */
export const RENDERER = new InjectionToken<Renderer>('render-policy.renderer', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    const config = inject(RENDER_POLICY_CONFIG);
    const window = document.defaultView;
    if (!window) {
      throw new Error('@render-policy/angular: DOCUMENT has no window. On the server provide RENDERER yourself, or render text only.');
    }
    return createRenderer({ ...config, window });
  },
});

/**
 * Configure the policy once, for the whole application:
 *
 *   bootstrapApplication(App, { providers: [provideRenderPolicy({ mode: 'balanced', policy: { images: { hosts: ['cdn.example'] } } })] })
 */
export function provideRenderPolicy(config: RenderPolicyConfig): Provider[] {
  return [{ provide: RENDER_POLICY_CONFIG, useValue: config }];
}
