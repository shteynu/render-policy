import { isPlatformBrowser } from '@angular/common';
import { Directive, ElementRef, PLATFORM_ID, effect, inject, input } from '@angular/core';
import { RENDERER } from './providers.js';

/**
 * Renders agent content into the host element through the render policy.
 *
 *   <div [rpRender]="message.content"></div>
 *   <div [rpRender]="html" rpRenderMode="html"></div>
 *
 * The content is sanitized into a fragment and inserted with replaceChildren():
 * no [innerHTML], no DomSanitizer bypass, nothing for Trusted Types to reject.
 * On the server (no window) the content is inserted as plain text.
 */
@Directive({
  selector: '[rpRender]',
  standalone: true,
})
export class RpRenderDirective {
  /** Markdown or HTML produced by the model or a tool. */
  readonly content = input.required<string>({ alias: 'rpRender' });
  /** How to interpret the content. Default 'markdown'. */
  readonly mode = input<'markdown' | 'html'>('markdown', { alias: 'rpRenderMode' });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(RENDERER) : null;

  constructor() {
    effect(() => {
      const content = this.content();
      const mode = this.mode();
      const element = this.host.nativeElement;
      if (!this.renderer) {
        element.textContent = content;
        return;
      }
      if (mode === 'html') {
        this.renderer.renderHtmlInto(element, content);
      } else {
        this.renderer.renderMarkdownInto(element, content);
      }
    });
  }
}
