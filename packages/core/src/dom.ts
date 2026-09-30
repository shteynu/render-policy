/**
 * Replace the children of `target` with the children of `fragment`, keeping the
 * leading child nodes that are unchanged. During streaming the settled blocks
 * keep their DOM nodes (no flicker, no lost selection, no re-layout above the
 * cursor) and only the block being typed is replaced.
 *
 * Both inputs are trusted here: the fragment comes out of the sanitizer.
 */
export function patchChildren(target: ParentNode, fragment: DocumentFragment): { readonly kept: number; readonly replaced: number } {
  const current = Array.from(target.childNodes);
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
  return { kept, replaced: tail.length };
}
