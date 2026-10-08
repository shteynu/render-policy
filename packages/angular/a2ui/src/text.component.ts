import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, input, output } from '@angular/core';
import type { A2uiDecision } from '@render-policy/a2ui';
import { A2UI_GUARD } from './providers.js';
import { textVariant, type A2uiTextVariant } from './variants.js';

/**
 * The basic catalog's Text, held to its contract: Markdown without HTML, images or links, rendered
 * through @render-policy/a2ui into a fragment and inserted with replaceChildren().
 *
 *   <rp-a2ui-text [text]="resolved.text" [variant]="props.variant" [componentId]="id" />
 *
 * The host holds one element: h1–h5 for headings, a span for 'caption', a div for 'body', with the
 * classes `a2ui-text <variant>`. Headings and captions render without block wrappers. Any other
 * variant counts as 'body'. On the server (no window) the text is inserted as plain text.
 */
@Component({
  selector: 'rp-a2ui-text',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RpA2uiTextComponent {
  /** The resolved `Text.text`: after data binding and function calls. Non-strings render as their string form. */
  readonly text = input.required<unknown>();
  /** Default 'body'. */
  readonly variant = input<A2uiTextVariant | string | undefined>('body');
  /** Copied into the journal entries. */
  readonly surfaceId = input<string | undefined>(undefined);
  /** Copied into the journal entries. */
  readonly componentId = input<string | undefined>(undefined);
  /** The decisions of each render. */
  readonly decisions = output<readonly A2uiDecision[]>();

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly guard = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(A2UI_GUARD) : null;

  constructor() {
    effect(() => {
      const text = this.text();
      const variant = textVariant(this.variant());
      const element = this.document.createElement(variant === 'body' ? 'div' : variant === 'caption' ? 'span' : variant);
      element.className = `a2ui-text ${variant}`;
      if (!this.guard) {
        element.textContent = text === undefined || text === null ? '' : String(text); // server: plain text, never markup
        this.host.nativeElement.replaceChildren(element);
        return;
      }
      const { decisions } = this.guard.renderText(element, text, { inline: variant !== 'body', surfaceId: this.surfaceId(), componentId: this.componentId() });
      this.host.nativeElement.replaceChildren(element);
      this.decisions.emit(decisions);
    });
  }
}
