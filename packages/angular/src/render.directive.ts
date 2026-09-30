import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, PLATFORM_ID, effect, inject, input } from '@angular/core';
import { createContentBinding, defaultScheduler, type ContentBinding } from '@render-policy/core';
import { RENDERER } from './providers.js';

type Mode = 'markdown' | 'html';

/**
 * Renders agent content into the host element through the render policy.
 *
 *   <div [rpRender]="message.content"></div>
 *   <div [rpRender]="html" rpRenderMode="html"></div>
 *   <div [rpRender]="message.content" [rpRenderStreaming]="message.pending"></div>
 *
 * The content is sanitized into a fragment and inserted with replaceChildren():
 * no [innerHTML], no DomSanitizer bypass, nothing for Trusted Types to reject.
 * While `rpRenderStreaming` is true the growing text is re-rendered at most once
 * per animation frame with incomplete URLs withheld; when it turns false the final
 * text is rendered once. On the server (no window) the content is inserted as plain text.
 */
@Directive({
  selector: '[rpRender]',
  standalone: true,
})
export class RpRenderDirective {
  /** Markdown or HTML produced by the model or a tool. */
  readonly content = input.required<string>({ alias: 'rpRender' });
  /** How to interpret the content. Default 'markdown'. */
  readonly mode = input<Mode>('markdown', { alias: 'rpRenderMode' });
  /** Treat the content as a growing stream. Default false. */
  readonly streaming = input(false, { alias: 'rpRenderStreaming' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly document = inject(DOCUMENT);
  private readonly renderer = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(RENDERER) : null;
  private binding: { readonly mode: Mode; readonly binding: ContentBinding } | null = null;

  constructor() {
    effect(() => {
      const content = this.content();
      const mode = this.mode();
      const streaming = this.streaming();
      const element = this.host.nativeElement;
      if (!this.renderer) {
        element.textContent = content; // server: plain text, never markup
        return;
      }
      if (!this.binding || this.binding.mode !== mode) {
        this.binding?.binding.dispose();
        this.binding = {
          mode,
          binding: createContentBinding(this.renderer, element, { mode, schedule: defaultScheduler(this.document.defaultView) }),
        };
      }
      this.binding.binding.update(content, streaming);
    });
  }
}
