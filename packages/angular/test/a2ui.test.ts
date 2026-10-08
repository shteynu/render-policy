import { DOCUMENT } from '@angular/common';
import { Component, PLATFORM_ID, provideZonelessChangeDetection, signal, type Provider, type Type } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { A2UI_GUARD, RpA2uiImageComponent, RpA2uiTextComponent, provideA2uiGuard } from '@render-policy/angular/a2ui';
import { createA2uiGuard, type A2uiDecision } from '@render-policy/a2ui';
import { afterEach, describe, expect, it, vi } from 'vitest';

@Component({
  selector: 'test-text-host',
  standalone: true,
  imports: [RpA2uiTextComponent],
  template: `<rp-a2ui-text id="target" [text]="text()" [variant]="variant()" componentId="t" (decisions)="seen.push($event)" />`,
})
class TextHost {
  readonly text = signal<unknown>('');
  readonly variant = signal<string>('body');
  readonly seen: (readonly A2uiDecision[])[] = [];
}

@Component({
  selector: 'test-image-host',
  standalone: true,
  imports: [RpA2uiImageComponent],
  template: `<rp-a2ui-image id="target" [url]="url()" [description]="description()" [fit]="fit()" [variant]="variant()" componentId="hero" (decisions)="seen.push($event)"
    ><em>image blocked</em></rp-a2ui-image
  >`,
})
class ImageHost {
  readonly url = signal<unknown>('');
  readonly description = signal<unknown>(undefined);
  readonly fit = signal<string>('fill');
  readonly variant = signal<string>('mediumFeature');
  readonly seen: (readonly A2uiDecision[])[] = [];
}

function mount<T>(host: Type<T>, setup: (h: T) => void, providers: Provider[] = []): { fixture: ComponentFixture<T>; target: HTMLElement; set: (change: (h: T) => void) => void } {
  TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), ...providers] });
  const fixture = TestBed.createComponent(host);
  setup(fixture.componentInstance);
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

const hosts = provideA2uiGuard({ policy: { images: { hosts: ['cdn.example'] } } });

afterEach(() => {
  // Angular resets TestBed through global hooks; vitest runs without globals, so reset here.
  TestBed.resetTestingModule();
  vi.restoreAllMocks();
});

describe('<rp-a2ui-text>', () => {
  it('renders the catalog contract: Markdown without HTML, images or links', () => {
    const { fixture, target } = mount(TextHost, (h) =>
      h.text.set('**Done.** <img src="https://evil.example/p.png"> ![chart](https://evil.example/c.png) [sign in](https://evil.example/login)'),
    );
    const element = target.firstElementChild as HTMLElement;
    expect([element.tagName, element.className]).toEqual(['DIV', 'a2ui-text body']);
    expect(element.querySelector('strong')?.textContent).toBe('Done.');
    expect(element.querySelector('img, a')).toBeNull();
    expect(element.textContent).toContain('sign in');
    const seen = fixture.componentInstance.seen.flat();
    expect(seen.map((d) => d.code)).toEqual(['a2ui-text-html', 'a2ui-text-image', 'a2ui-text-link']);
    expect(seen[0]?.a2ui).toEqual({ kind: 'text', componentId: 't' });
  });

  it('renders headings inline in their own element and re-renders a swapped value without innerHTML', () => {
    const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!descriptor?.set) throw new Error('jsdom innerHTML accessor missing');
    const setter = vi.fn(descriptor.set);
    Object.defineProperty(Element.prototype, 'innerHTML', { ...descriptor, set: setter });
    try {
      const { target, set } = mount(TextHost, (h) => {
        h.text.set('A *title*');
        h.variant.set('h2');
      });
      const heading = target.firstElementChild as HTMLElement;
      expect([heading.tagName, heading.className]).toEqual(['H2', 'a2ui-text h2']);
      expect(heading.querySelector('p')).toBeNull();
      expect(heading.querySelector('em')?.textContent).toBe('title');
      set((h) => h.text.set('Done. <img src=x onerror="alert(1)">'));
      expect(target.textContent).toContain('Done.');
      expect(target.querySelector('img')).toBeNull();
      expect(setter).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(Element.prototype, 'innerHTML', descriptor);
    }
  });

  it('takes only the catalog variants: an unknown one is body, never a tag or a class', () => {
    const { target } = mount(TextHost, (h) => {
      h.text.set('hi');
      h.variant.set('script');
    });
    const element = target.firstElementChild as HTMLElement;
    expect([element.tagName, element.className]).toEqual(['DIV', 'a2ui-text body']);
    expect(target.querySelector('script')).toBeNull();
  });

  it('renders plain text on the server and never builds a guard there', () => {
    const { target } = mount(TextHost, (h) => h.text.set('<b>not markup</b>'), [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: A2UI_GUARD, useFactory: () => { throw new Error('A2UI_GUARD injected on the server'); } },
    ]);
    expect(target.textContent).toBe('<b>not markup</b>');
    expect(target.querySelector('b')).toBeNull();
  });
});

describe('<rp-a2ui-image>', () => {
  it('renders an allowed URL with the value the guard returns', () => {
    const { fixture, target } = mount(
      ImageHost,
      (h) => {
        h.url.set('https://cdn.example/a.png?track=1');
        h.description.set('A chart');
        h.fit.set('scaleDown');
        h.variant.set('avatar');
      },
      [hosts],
    );
    const img = target.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://cdn.example/a.png');
    expect(img?.getAttribute('alt')).toBe('A chart');
    expect(img?.className).toBe('a2ui-image avatar');
    expect(img?.style.objectFit).toBe('scale-down');
    expect(target.querySelector('em')).toBeNull();
    expect(fixture.componentInstance.seen.flat()).toMatchObject([{ code: 'image-query-stripped', a2ui: { kind: 'image', componentId: 'hero' } }]);
  });

  it('creates no element for a blocked URL, projects the fallback, and checks a swapped value', () => {
    const { fixture, target, set } = mount(ImageHost, (h) => h.url.set('https://cdn.example/a.png'), [hosts]);
    expect(target.querySelector('img')).not.toBeNull();
    set((h) => h.url.set('https://evil.example/late.png?d=secret'));
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('em')?.textContent).toBe('image blocked');
    expect(fixture.componentInstance.seen.flat().map((d) => d.code)).toEqual(['image-host-not-allowed']);
  });

  it('refuses a binding that resolved to something other than a URL', () => {
    const { fixture, target } = mount(ImageHost, (h) => h.url.set(undefined));
    expect(target.querySelector('img')).toBeNull();
    expect(fixture.componentInstance.seen.flat().map((d) => d.code)).toEqual(['a2ui-not-a-url']);
  });

  it('takes only the catalog variants and fits; same-origin URLs need no configuration', () => {
    const { target } = mount(ImageHost, (h) => {
      h.url.set('/static/a.png');
      h.variant.set('rp-blocked-image');
      h.fit.set('url(x)');
    });
    const img = target.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/static/a.png');
    expect(img?.className).toBe('a2ui-image mediumFeature');
    expect(img?.style.objectFit).toBe('fill');
  });

  it('renders only the projected content on the server', () => {
    const { target } = mount(ImageHost, (h) => h.url.set('/static/a.png'), [
      { provide: PLATFORM_ID, useValue: 'server' },
      { provide: A2UI_GUARD, useFactory: () => { throw new Error('A2UI_GUARD injected on the server'); } },
    ]);
    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('em')?.textContent).toBe('image blocked');
  });
});

describe('A2UI guard providers', () => {
  it('A2UI_GUARD can be replaced by a prebuilt guard', () => {
    const codes: string[] = [];
    const guard = createA2uiGuard({ onDecision: (d) => codes.push(d.code) });
    mount(ImageHost, (h) => h.url.set('https://evil.example/p.png'), [{ provide: A2UI_GUARD, useValue: guard }]);
    expect(codes).toEqual(['image-host-not-allowed']);
  });

  it('the default A2UI_GUARD refuses a DOCUMENT without a window', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection(), { provide: DOCUMENT, useValue: { defaultView: null } }] });
    expect(() => TestBed.inject(A2UI_GUARD)).toThrow(/no window/);
  });
});
