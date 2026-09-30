import type { RenderDecision } from './decisions.js';
import type { Renderer, RenderTarget } from './render.js';
import type { RenderStream, Scheduler, StreamOptions } from './stream.js';

export interface ContentBindingOptions {
  /** Interpret the content as Markdown (default) or HTML. */
  readonly mode?: 'markdown' | 'html';
  /** Coalesces streaming renders, for example `frameScheduler(window)`. Default: render on every update. */
  readonly schedule?: Scheduler;
  /** Stream behaviour while streaming (withheld URLs, fence closing, tail patching). */
  readonly stream?: Pick<StreamOptions, 'holdIncompleteUrls' | 'closeFences' | 'patch'>;
  /** Receives the decision journal of every one-shot render and of the final render of a stream. */
  readonly onDecisions?: (decisions: readonly RenderDecision[]) => void;
}

/**
 * One piece of agent content bound to one target: the lifecycle every framework adapter
 * needs, written once. `update(content, streaming)` starts a stream on the first streaming
 * update, feeds it while streaming stays true, ends it with a final render when streaming
 * turns false, and otherwise renders in one shot.
 */
export interface ContentBinding {
  update(content: string, streaming?: boolean): void;
  /** True while a stream is open. */
  readonly streaming: boolean;
  /** Forget the open stream, if any. The target is left as it is. */
  dispose(): void;
}

export function createContentBinding(renderer: Renderer, target: RenderTarget, options: ContentBindingOptions = {}): ContentBinding {
  const mode = options.mode ?? 'markdown';
  let stream: RenderStream | null = null;

  const report = (decisions: readonly RenderDecision[]): void => {
    options.onDecisions?.(decisions);
  };

  return {
    update(content, streaming = false) {
      if (streaming) {
        stream ??= renderer.createStream(target, { ...options.stream, mode, schedule: options.schedule });
        stream.set(content);
        return;
      }
      if (stream) {
        const open = stream;
        stream = null;
        open.set(content);
        report(open.end().decisions);
        return;
      }
      const result = mode === 'html' ? renderer.renderHtmlInto(target, content) : renderer.renderMarkdownInto(target, content);
      report(result.decisions);
    },
    get streaming() {
      return stream !== null;
    },
    dispose() {
      stream = null;
    },
  };
}
