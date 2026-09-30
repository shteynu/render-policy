export type DecisionKind = 'blocked' | 'rewritten' | 'flagged';

export type DecisionSubject = 'element' | 'attribute' | 'link' | 'image' | 'url' | 'class' | 'markdown';

/**
 * One policy decision made while rendering. The journal is the audit trail of
 * a render: what was blocked, what was rewritten, and what a permissive policy
 * let through but would have blocked in balanced mode.
 */
export interface RenderDecision {
  readonly kind: DecisionKind;
  readonly subject: DecisionSubject;
  readonly reason: string;
  readonly tag?: string;
  readonly attribute?: string;
  readonly value?: string;
}
