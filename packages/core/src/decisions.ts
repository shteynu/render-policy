export type DecisionKind = 'blocked' | 'rewritten' | 'flagged';

export type DecisionSubject = 'element' | 'attribute' | 'link' | 'image' | 'url' | 'class' | 'markdown' | 'transform';

/** Codes the core emits. A transform may add its own; prefix them with its name (`diagram-…`). */
export type CoreDecisionCode =
  | 'event-handler'
  | 'event-handler-survived'
  | 'class-not-allowed'
  | 'class-filtered'
  | 'target-not-allowed'
  | 'scheme-not-allowed'
  | 'url-unparsable'
  | 'relative-url-not-allowed'
  | 'sink-host'
  | 'url-denied'
  | 'url-rewritten'
  | 'url-rewrite-invalid'
  | 'url-decider-failed'
  | 'remote-images-disabled'
  | 'image-host-not-allowed'
  | 'image-query-denied'
  | 'image-query-stripped'
  | 'url-too-long'
  | 'url-encoded-payload'
  | 'image-rewrite-rejected'
  | 'image-rewrite-invalid'
  | 'image-rewrite-failed'
  | 'image-rewritten'
  | 'image-without-src'
  | 'element-not-allowed'
  | 'attribute-not-allowed'
  | 'markdown-failed'
  | 'transform-failed';

/** A known code, with room for codes a transform defines. */
export type DecisionCode = CoreDecisionCode | (string & {});

/**
 * One policy decision made while rendering. The journal is the audit trail of a render:
 * what was blocked, what was rewritten, and what was let through but is worth a look
 * (`flagged`: a sink host under `sinkDenylist: 'log'`, a transform that failed).
 * `code` is stable and meant for programs; `reason` is for people and may change.
 */
export interface RenderDecision {
  readonly kind: DecisionKind;
  readonly subject: DecisionSubject;
  readonly code: DecisionCode;
  readonly reason: string;
  readonly tag?: string;
  readonly attribute?: string;
  readonly value?: string;
}
