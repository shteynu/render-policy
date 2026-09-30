import { describe, expect, it } from 'vitest';
import { patchChildren } from '../src/internal.js';

const fragmentOf = (html: string): DocumentFragment => {
  const template = document.createElement('template');
  template.innerHTML = html; // test helper only: builds the "next" fragment
  return template.content;
};

describe('patchChildren', () => {
  it('keeps the unchanged prefix and replaces the rest', () => {
    const target = document.createElement('div');
    target.append(...fragmentOf('<p>a</p><p>b</p><p>c</p>').childNodes);
    const [a, b] = Array.from(target.children);
    const result = patchChildren(target, fragmentOf('<p>a</p><p>b</p><p>changed</p><p>d</p>'));
    expect(result).toEqual({ kept: 2, replaced: 2 });
    expect(target.children[0]).toBe(a);
    expect(target.children[1]).toBe(b);
    expect(Array.from(target.children).map((n) => n.textContent)).toEqual(['a', 'b', 'changed', 'd']);
  });

  it('removes trailing nodes that disappeared', () => {
    const target = document.createElement('div');
    target.append(...fragmentOf('<p>a</p><p>b</p>').childNodes);
    patchChildren(target, fragmentOf('<p>a</p>'));
    expect(target.childNodes.length).toBe(1);
  });

  it('handles an empty target and an empty fragment', () => {
    const target = document.createElement('div');
    expect(patchChildren(target, fragmentOf('<p>a</p>'))).toEqual({ kept: 0, replaced: 1 });
    expect(patchChildren(target, fragmentOf(''))).toEqual({ kept: 0, replaced: 0 });
    expect(target.childNodes.length).toBe(0);
  });

  it('compares attributes and subtrees, not just tag names', () => {
    const target = document.createElement('div');
    target.append(...fragmentOf('<a href="/a">x</a>').childNodes);
    const link = target.firstElementChild;
    patchChildren(target, fragmentOf('<a href="/b">x</a>'));
    expect(target.firstElementChild).not.toBe(link);
    expect(target.firstElementChild?.getAttribute('href')).toBe('/b');
  });
});
