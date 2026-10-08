import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, PLATFORM_ID, computed, effect, inject, input, output } from '@angular/core';
import type { A2uiDecision } from '@render-policy/a2ui';
import { A2UI_GUARD } from './providers.js';
import { imageFit, imageVariant, type A2uiImageFit, type A2uiImageVariant } from './variants.js';

/**
 * The basic catalog's Image. The resolved URL goes through @render-policy/a2ui (image hosts, sink
 * denylist, URL heuristics, `images.rewriteUrl`) before an <img> exists; a blocked URL never reaches
 * the DOM, so no request is made, and the projected content renders instead.
 *
 *   <rp-a2ui-image [url]="resolved.url" [description]="resolved.description" [fit]="props.fit">image blocked</rp-a2ui-image>
 *
 * Variants and fit outside the catalog's values count as the defaults ('mediumFeature', 'fill').
 * On the server (no window) only the projected content renders.
 */
@Component({
  selector: 'rp-a2ui-image',
  standalone: true,
  template: `
    @if (src(); as src) {
      <img [src]="src" [alt]="alt()" [class]="'a2ui-image ' + variantClass()" [style.object-fit]="objectFit()" />
    } @else {
      <ng-content />
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RpA2uiImageComponent {
  /** The resolved `Image.url`, checked on every change. */
  readonly url = input.required<unknown>();
  /** The resolved `Image.description`, used as `alt`. */
  readonly description = input<unknown>(undefined);
  /** Default 'fill', the catalog's default. */
  readonly fit = input<A2uiImageFit | string | undefined>('fill');
  /** Default 'mediumFeature'. */
  readonly variant = input<A2uiImageVariant | string | undefined>('mediumFeature');
  /** Copied into the journal entries. */
  readonly surfaceId = input<string | undefined>(undefined);
  /** Copied into the journal entries. */
  readonly componentId = input<string | undefined>(undefined);
  /** The decisions of each check. */
  readonly decisions = output<readonly A2uiDecision[]>();

  private readonly guard = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(A2UI_GUARD) : null;
  private readonly result = computed(() => (this.guard ? this.guard.url('image', this.url(), { surfaceId: this.surfaceId(), componentId: this.componentId() }) : null));

  protected readonly src = computed(() => {
    const result = this.result();
    return result?.allowed ? result.value : null;
  });
  protected readonly alt = computed(() => {
    const description = this.description();
    return description === undefined || description === null ? '' : String(description);
  });
  protected readonly variantClass = computed(() => imageVariant(this.variant()));
  protected readonly objectFit = computed(() => {
    const fit = imageFit(this.fit());
    return fit === 'scaleDown' ? 'scale-down' : fit;
  });

  constructor() {
    effect(() => {
      const result = this.result();
      if (result) this.decisions.emit(result.allowed ? result.decisions : [...result.decisions, result.decision]);
    });
  }
}
