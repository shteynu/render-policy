import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { frameScheduler, type RenderDecision, type RenderStream, type Scheduler } from '@render-policy/core';
import { useRenderer } from './context.js';

export interface UseRenderPolicyOptions {
  /** Interpret the content as Markdown (default) or HTML. */
  readonly mode?: 'markdown' | 'html';
  /** While true, the content is treated as a growing stream: incomplete URLs are withheld, fences closed, settled blocks kept. */
  readonly streaming?: boolean;
  /** Coalesces streaming renders. Default: one per animation frame. */
  readonly scheduler?: Scheduler;
  /** Receives the decision journal of each one-shot render. Memoize it (useCallback) to avoid re-renders. */
  readonly onDecisions?: (decisions: readonly RenderDecision[]) => void;
}

interface ActiveStream {
  readonly stream: RenderStream;
  readonly element: Element;
  readonly mode: 'markdown' | 'html';
}

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/**
 * Renders agent content into the element the returned ref is attached to.
 * The element must have no React-managed children: React owns the element,
 * the render policy owns what is inside it.
 *
 *   const ref = useRenderPolicy<HTMLDivElement>(message.content, { streaming: message.pending });
 *   return <div ref={ref} />;
 */
export function useRenderPolicy<T extends Element = HTMLDivElement>(content: string, options: UseRenderPolicyOptions = {}): RefObject<T | null> {
  const ref = useRef<T | null>(null);
  const renderer = useRenderer();
  const active = useRef<ActiveStream | null>(null);
  const { mode = 'markdown', streaming = false, scheduler, onDecisions } = options;

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || !renderer) return;

    let current = active.current;
    if (current && (current.element !== element || current.mode !== mode)) {
      active.current = null;
      current = null;
    }

    if (streaming) {
      if (!current) {
        current = { stream: renderer.createStream(element, { mode, schedule: scheduler ?? defaultScheduler() }), element, mode };
        active.current = current;
      }
      current.stream.set(content);
      return;
    }

    if (current) {
      active.current = null;
      current.stream.set(content);
      current.stream.end();
      return;
    }

    const result = mode === 'html' ? renderer.renderHtmlInto(element, content) : renderer.renderMarkdownInto(element, content);
    onDecisions?.(result.decisions);
  }, [renderer, content, mode, streaming, scheduler, onDecisions]);

  useEffect(
    () => () => {
      active.current = null;
    },
    [],
  );

  return ref;
}

function defaultScheduler(): Scheduler {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return frameScheduler(window);
  }
  return (render) => render();
}
