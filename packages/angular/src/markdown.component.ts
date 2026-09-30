import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, ElementRef, PLATFORM_ID, effect, inject, input } from '@angular/core';
import { frameScheduler, type RenderStream, type Scheduler } from '@render-policy/core';
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
  private readonly renderer = isPlatformBrowser(inject(PLATFORM_ID)) ? inject(RENDERER) : null;
  private stream: RenderStream | null = null;

  constructor() {
    effect(() => {
      const content = this.content();
      const streaming = this.streaming();
      const element = this.host.nativeElement;
      const renderer = this.renderer;
      if (!renderer) {
        element.textContent = content;
        return;
      }
      if (streaming) {
        this.stream ??= renderer.createStream(element, { mode: 'markdown', schedule: this.scheduler() });
        this.stream.set(content);
        return;
      }
      if (this.stream) {
        this.stream.set(content);
        this.stream.end();
        this.stream = null;
        return;
      }
      renderer.renderMarkdownInto(element, content);
    });
  }

  private scheduler(): Scheduler {
    const window = this.document.defaultView;
    if (window && typeof window.requestAnimationFrame === 'function') {
      return frameScheduler(window);
    }
    return (render) => render();
  }
}
