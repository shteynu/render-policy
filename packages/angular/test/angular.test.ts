import { DOCUMENT } from '@angular/common';
import { Component, PLATFORM_ID, provideZonelessChangeDetection, signal, type Provider, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { RENDERER, RpMarkdownComponent, RpRenderDirective, provideRenderPolicy } from '@render-policy/angular';
import { createRenderer } from '@render-policy/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

@Component({
  selector: 'test-directive-host',
  standalone: true,
  imports: [RpRenderDirective],
  template: `<div id="target" [rpRender]="content()" [rpRenderMode]="mode()" [rpRenderStreaming]="streaming()"></div>`,
})
class DirectiveHost {
  readonly content = signal('');
  readonly mode = signal<'markdown' | 'html'>('markdown');
  readonly streaming = signal(false);
}

@Component({
  selector: 'test-component-host',
  standalone: true,
  imports: [RpMarkdownComponent],
  template: `<rp-markdown id="target" [content]="content()" [streaming]="streaming()" />`,
})
class ComponentHost {
  readonly content = signal('');
  readonly streaming = signal(false);
}

type Host = DirectiveHost | ComponentHost;

function mount<T extends Host>(host: Type<T>, content: string, providers: Provider[] = []): { fixture: ComponentFixture<T>; target: HTMLElement; set: (change: (h: T) => void) => void } {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...providers] });
  const fixture = TestBed.createComponent(host);
  fixture.componentInstance.content.set(content);
  fixture.detectChanges();
  const target = (fixture.nativeElement as HTMLElement).querySelector<HTMLElement>('#target');
  if (!target) throw new Error('no #target');
  return {
    fixture,
    target,
    set: (change) => {
      change(fixture.componentInstance);
      fixture.detectChanges();
    },
  };
}

/**
 * Animation frames under the test's control; the binding takes requestAnimationFrame when it is
 * created. Angular's zoneless scheduler queues frames here too, so tests check what a frame
 * renders, not how many frames were queued.
 */
function manualFrames(): { flush: () => void } {
  const queue: (() => void)[] = [];
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
    queue.push(() => callback(0));
    return queue.length;
  });
  return {
    flush: () => {
      for (const run of queue.splice(0)) run();
    },
  };
}

const HOSTILE = '# Hello\n\n<img src="/a.png" onerror="window.__pwned = 1">\n\n![remote](https://evil.example/p.png)\n\n<form action="https://evil.example/"><input name="p"></form>';

// Every innerHTML write inside a fixture. DOMPurify parses in its own inert document, so a
// write that lands in the application's tree can only come from the adapter.
let innerHtmlWrites: string[] = [];
beforeEach(() => {
  innerHtmlWrites = [];
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
  const originalSet = descriptor?.set;
  if (!descriptor || !originalSet) throw new Error('no innerHTML setter');
  vi.spyOn(Element.prototype, 'innerHTML', 'set').mockImplementation(function (this: Element, value: string) {
    if (this.isConnected && this.closest('[ng-version]')) innerHtmlWrites.push(this.tagName.toLowerCase());
    originalSet.call(this, value);
  });
});

afterEach(() => {
  // Angular resets TestBed through global hooks; vitest runs without globals, so reset here.
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
  delete (window as { __pwned?: unknown }).__pwned;
});

describe('[rpRender]', () => {
  it('renders Markdown through the policy', () => {
    const { target } = mount(DirectiveHost, HOSTILE);
    expect(target.querySelector('h1')?.textContent).toBe('Hello');
    expect(target.querySelector('img')?.getAttribute('src')).toBe('/a.png');
    expect(target.querySelector('img[onerror]')).toBeNull();
    expect(target.querySelector('a.rp-blocked-image')?.getAttribute('href')).toBe('https://evil.example/p.png');
    expect(target.querySelector('form, input')).toBeNull();
    expect(innerHtmlWrites).toEqual([]);
  });

  it('re-renders when the input changes', () => {
    const { target, set } = mount(DirectiveHost, 'one');
    set((h) => h.content.set('## Two\n\n[bad](javascript:alert(1)) [ok](https://example.com/)'));
    expect(target.querySelector('h2')?.textContent).toBe('Two');
    expect([...target.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual([null, 'https://example.com/']);
  });

  it('interprets the content as HTML in html mode and switches back', () => {
    const { target, set } = mount(DirectiveHost, '# not a heading');
    expect(target.querySelector('h1')).not.toBeNull();
    set((h) => h.mode.set('html'));
    expect(target.querySelector('h1')).toBeNull();
    expect(target.textContent).toBe('# not a heading');
    set((h) => {
      h.mode.set('markdown');
      h.content.set('<b onclick="x()">bold</b>');
    });
    expect(target.querySelector('b')?.hasAttribute('onclick')).toBe(false);
  });

  it('streams: renders on the next frame with the latest text, withholds incomplete URLs, renders the final text at once', () => {
    const frames = manualFrames();
    const { target, set } = mount(DirectiveHost, '');
    set((h) => {
      h.streaming.set(true);
      h.content.set('# Chart\n\nSee ![c](https://app.example/c');
    });
    set((h) => h.content.set('# Chart\n\nSee ![c](https://app.example/chart'));
    expect(target.querySelector('h1')).toBeNull(); // waits for the frame
    frames.flush();
    expect(target.querySelector('h1')?.textContent).toBe('Chart');
    expect(target.querySelector('img')).toBeNull(); // the URL is still being typed
    set((h) => {
      h.content.set('# Chart\n\nSee ![c](https://app.example/chart.png)');
      h.streaming.set(false);
    });
    expect(target.querySelector('img')?.getAttribute('src')).toBe('https://app.example/chart.png');
  });

  it('renders plain text on the server and never builds a renderer there', () => {
    const { target } = mount(DirectiveHost, '# <b>not markup</b>', [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: RENDERER, useFactory: () => { throw new Error('RENDERER injected on the server'); } },
    ]);
    expect(target.children.length).toBe(0);
    expect(target.textContent).toBe('# <b>not markup</b>');
  });
});

describe('<rp-markdown>', () => {
  it('renders Markdown through the policy into its host', () => {
    const { target } = mount(ComponentHost, HOSTILE);
    expect(target.classList.contains('rp-markdown')).toBe(true);
    expect(target.querySelector('h1')?.textContent).toBe('Hello');
    expect(target.querySelector('img[onerror]')).toBeNull();
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
    expect(innerHtmlWrites).toEqual([]);
  });

  it('keeps finished blocks in place while streaming and renders the final text once', () => {
    const frames = manualFrames();
    const { target, set } = mount(ComponentHost, '');
    set((h) => {
      h.streaming.set(true);
      h.content.set('# Title\n\nfirst');
    });
    frames.flush();
    const heading = target.querySelector('h1');
    expect(heading?.textContent).toBe('Title');
    set((h) => h.content.set('# Title\n\nfirst and more'));
    frames.flush();
    expect(target.querySelector('h1')).toBe(heading); // patched, not rebuilt
    set((h) => h.streaming.set(false));
    expect(target.querySelector('p')?.textContent).toBe('first and more'); // the final render does not wait for a frame
  });

  it('renders plain text on the server', () => {
    const { target } = mount(ComponentHost, '**not markup**', [{ provide: PLATFORM_ID, useValue: 'server' }]);
    expect(target.children.length).toBe(0);
    expect(target.textContent).toBe('**not markup**');
  });
});

describe('providers', () => {
  it('provideRenderPolicy configures the application renderer', () => {
    const { target } = mount(DirectiveHost, '![a](https://cdn.example/a.png) ![b](https://evil.example/b.png)', [
      provideRenderPolicy({ policy: { images: { hosts: ['cdn.example'] } } }),
    ]);
    expect([...target.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual(['https://cdn.example/a.png']);
    expect(target.querySelectorAll('a.rp-blocked-image').length).toBe(1);
  });

  it('RENDERER can be replaced, for example by a strict renderer', () => {
    const { target } = mount(ComponentHost, '![a](https://cdn.example/a.png)', [
      provideRenderPolicy({ policy: { images: { hosts: ['cdn.example'] } } }), // ignored: RENDERER is provided directly
      { provide: RENDERER, useFactory: () => createRenderer({ mode: 'strict', window }) },
    ]);
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('a.rp-blocked-image')).not.toBeNull();
  });

  it('the default RENDERER refuses a DOCUMENT without a window', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: DOCUMENT, useValue: { defaultView: null } }] });
    expect(() => TestBed.inject(RENDERER)).toThrow(/DOCUMENT has no window/);
  });
});
