import { createElement, type ComponentPropsWithoutRef, type ReactElement } from 'react';
import type { RenderDecision, Scheduler } from '@render-policy/core';
import { useRenderPolicy } from './use-render-policy.js';

export type ContainerTag = 'div' | 'span' | 'section' | 'article' | 'p' | 'li' | 'td' | 'blockquote';

interface ContainerProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'dangerouslySetInnerHTML' | 'content'> {
  /** The element to render into. Default 'div'. */
  readonly as?: ContainerTag;
  /** Treat the content as a growing stream. */
  readonly streaming?: boolean;
  /** Coalesces streaming renders. Default: one per animation frame. */
  readonly scheduler?: Scheduler;
  /** Receives the decision journal of each one-shot render. */
  readonly onDecisions?: (decisions: readonly RenderDecision[]) => void;
}

export interface RpMarkdownProps extends ContainerProps {
  /** Markdown from the model or a tool. */
  readonly content: string;
}

export interface RpHtmlProps extends ContainerProps {
  /** HTML from the model or a tool. */
  readonly html: string;
}

/**
 * Markdown from the model, rendered through the policy:
 *
 *   <RpMarkdown content={message.content} streaming={message.pending} className="message" />
 */
export function RpMarkdown({ content, as = 'div', streaming, scheduler, onDecisions, ...rest }: RpMarkdownProps): ReactElement {
  const ref = useRenderPolicy<HTMLElement>(content, { mode: 'markdown', streaming, scheduler, onDecisions });
  return createElement(as, { ...rest, ref });
}

/** HTML from the model, rendered through the policy. */
export function RpHtml({ html, as = 'div', streaming, scheduler, onDecisions, ...rest }: RpHtmlProps): ReactElement {
  const ref = useRenderPolicy<HTMLElement>(html, { mode: 'html', streaming, scheduler, onDecisions });
  return createElement(as, { ...rest, ref });
}
