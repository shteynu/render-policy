export interface PatchOptions {
  /** Leave the first `from` child nodes of the target alone; the fragment describes what follows them. */
  readonly from?: number;
}

/**
 * Replace the children of `target` from index `from` on with the children of `fragment`,
 * keeping the leading nodes that are unchanged. During streaming the settled blocks keep
 * their DOM nodes (no flicker, no lost selection, no re-layout above the cursor) and only
 * the block being typed is replaced.
 *
 * Both inputs are trusted here: the fragment comes out of the sanitizer.
 */
export function patchChildren(target: ParentNode, fragment: DocumentFragment, options: PatchOptions = {}): { readonly kept: number; readonly replaced: number } {
  const from = Math.min(Math.max(options.from ?? 0, 0), target.childNodes.length);
  const current = Array.from(target.childNodes).slice(from);
  const next = Array.from(fragment.childNodes);
  let kept = 0;
  while (kept < current.length && kept < next.length && current[kept]!.isEqualNode(next[kept]!)) {
    kept += 1;
  }
  for (let i = current.length - 1; i >= kept; i -= 1) {
    current[i]!.remove();
  }
  const tail = next.slice(kept);
  if (tail.length > 0) {
    target.append(...tail);
  }
  return { kept: from + kept, replaced: tail.length };
}
