import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { createContentBinding, defaultScheduler, type ContentBinding, type RenderDecision, type Renderer, type Scheduler } from '@render-policy/core';
import { useRenderer } from './context.js';

export interface UseRenderPolicyOptions {
  /** Interpret the content as Markdown (default) or HTML. */
  readonly mode?: 'markdown' | 'html';
  /** While true, the content is treated as a growing stream: incomplete URLs are withheld, fences closed, settled blocks kept. */
  readonly streaming?: boolean;
  /** Coalesces streaming renders. Default: one per animation frame. Read when a stream starts. */
  readonly scheduler?: Scheduler;
  /** Receives the decision journal of each one-shot render and of the final render of a stream. */
  readonly onDecisions?: (decisions: readonly RenderDecision[]) => void;
}

interface Active {
  readonly binding: ContentBinding;
  readonly renderer: Renderer;
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
  const active = useRef<Active | null>(null);
  const onDecisions = useRef(options.onDecisions);
  const { mode = 'markdown', streaming = false, scheduler } = options;

  useIsomorphicLayoutEffect(() => {
    onDecisions.current = options.onDecisions;
  });

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || !renderer) return;

    let current = active.current;
    if (!current || current.element !== element || current.renderer !== renderer || current.mode !== mode) {
      current?.binding.dispose();
      current = {
        binding: createContentBinding(renderer, element, {
          mode,
          schedule: scheduler ?? defaultScheduler(),
          onDecisions: (decisions) => onDecisions.current?.(decisions),
        }),
        renderer,
        element,
        mode,
      };
      active.current = current;
    }
    current.binding.update(content, streaming);
  }, [renderer, content, mode, streaming]);

  useEffect(
    () => () => {
      active.current?.binding.dispose();
      active.current = null;
    },
    [],
  );

  return ref;
}
