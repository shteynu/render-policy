import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, input } from '@angular/core';
import { createContentBinding, defaultScheduler, type ContentBinding } from '@render-policy/core';
import { RENDERER } from './providers.js';

/**
 * Markdown from the model, rendered through the policy, with a streaming mode.
 *
 *   <rp-markdown [content]="message.content" [streaming]="message.pending" />
 *
 * While `streaming` is true the growing text is re-rendered at most once per
 * animation frame; links, images and tags whose URL is not complete are
 * withheld, and an unfinished code fence is closed. When `streaming` turns
 * false the final text is rendered once, with nothing withheld.
 */
@Component({
  selector: 'rp-markdown',
  standalone: true,
  template: '',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'rp-markdown' },
})
export class RpMarkdownComponent {
  readonly content = input.required<string>();
  readonly streaming = input(false);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly binding: ContentBinding | null = isPlatformBrowser(inject(PLATFORM_ID))
    ? createContentBinding(inject(RENDERER), this.host.nativeElement, { mode: 'markdown', schedule: defaultScheduler(this.document.defaultView) })
    : null;

  constructor() {
    effect(() => {
      const content = this.content();
      const streaming = this.streaming();
      if (!this.binding) {
        this.host.nativeElement.textContent = content; // server: plain text, never markup
        return;
      }
      this.binding.update(content, streaming);
    });
  }
}
