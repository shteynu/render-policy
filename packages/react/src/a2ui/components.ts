import { Fragment, createElement, useEffect, useLayoutEffect, useMemo, useRef, type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';
import type { A2uiDecision } from '@render-policy/a2ui';
import { useA2uiGuard } from './context.js';

/** The basic catalog's `Text.variant`. */
export type A2uiTextVariant = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
/** The basic catalog's `Image.fit` (CSS `object-fit`, `scaleDown` for `scale-down`). */
export type A2uiImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';
/** The basic catalog's `Image.variant`. */
export type A2uiImageVariant = 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';

interface A2uiPlace {
  /** Copied into the journal entries. */
  readonly surfaceId?: string;
  /** Copied into the journal entries. */
  readonly componentId?: string;
  /** Receives the decisions of each check. */
  readonly onDecisions?: (decisions: readonly A2uiDecision[]) => void;
}

export interface RpA2uiTextProps extends A2uiPlace, Omit<ComponentPropsWithoutRef<'div'>, 'children' | 'dangerouslySetInnerHTML'> {
  /** The resolved `Text.text`: after data binding and function calls. Non-strings render as their string form. */
  readonly text: unknown;
  /** Default 'body'. Headings render as h1–h5 and, like 'caption', without block wrappers. Other values count as 'body'. */
  readonly variant?: A2uiTextVariant;
}

export interface RpA2uiImageProps extends A2uiPlace, Omit<ComponentPropsWithoutRef<'img'>, 'src' | 'srcSet' | 'alt' | 'children' | 'dangerouslySetInnerHTML'> {
  /** The resolved `Image.url`, checked on every change before an element exists. */
  readonly url: unknown;
  /** The resolved `Image.description`, used as `alt`. */
  readonly description?: unknown;
  /** Default 'fill', the catalog's default. Other values count as the default. */
  readonly fit?: A2uiImageFit;
  /** Default 'mediumFeature'. Other values count as the default. */
  readonly variant?: A2uiImageVariant;
  /** Rendered instead of the image when the URL is blocked, and on the server. Default nothing. */
  readonly fallback?: ReactNode;
}

// Variants and fit come from the agent's message: only the catalog's values become a tag, a class or a style.
const TEXT_VARIANTS: readonly string[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'];
const IMAGE_VARIANTS: readonly string[] = ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'];
const IMAGE_FITS: readonly string[] = ['contain', 'cover', 'fill', 'none', 'scaleDown'];
const oneOf = <T extends string>(values: readonly string[], value: unknown, otherwise: T): T => (values.includes(value as string) ? (value as T) : otherwise);

const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;
const classes = (...names: (string | undefined)[]): string => names.filter(Boolean).join(' ');

/**
 * The basic catalog's Text, held to its contract: Markdown without HTML, images or links, rendered
 * through @render-policy/a2ui into a fragment and inserted with replaceChildren().
 *
 *   <RpA2uiText text={resolve(props.text)} variant={props.variant} componentId={id} />
 */
export function RpA2uiText({ text, variant: requested, surfaceId, componentId, onDecisions, className, ...rest }: RpA2uiTextProps): ReactElement {
  const ref = useRef<HTMLElement | null>(null);
  const guard = useA2uiGuard();
  const report = useRef(onDecisions);
  const variant = oneOf<A2uiTextVariant>(TEXT_VARIANTS, requested, 'body');
  const tag = variant === 'body' ? 'div' : variant === 'caption' ? 'span' : variant;

  useIsomorphicLayoutEffect(() => {
    report.current = onDecisions;
  });

  useIsomorphicLayoutEffect(() => {
    const element = ref.current;
    if (!element || !guard) return;
    const { decisions } = guard.renderText(element, text, { inline: variant !== 'body', surfaceId, componentId });
    report.current?.(decisions);
  }, [guard, text, variant, surfaceId, componentId]);

  return createElement(tag, { ...rest, className: classes('a2ui-text', variant, className), ref });
}

/**
 * The basic catalog's Image. The resolved URL goes through @render-policy/a2ui (image hosts, sink
 * denylist, URL heuristics, `images.rewriteUrl`) before an <img> exists; a blocked URL never reaches
 * the DOM, so no request is made, and `fallback` renders instead.
 *
 *   <RpA2uiImage url={resolve(props.url)} description={resolve(props.description)} fit={props.fit} />
 */
export function RpA2uiImage({
  url,
  description,
  fit: requestedFit,
  variant: requestedVariant,
  surfaceId,
  componentId,
  onDecisions,
  fallback = null,
  className,
  style,
  ...rest
}: RpA2uiImageProps): ReactElement {
  const guard = useA2uiGuard();
  const fit = oneOf<A2uiImageFit>(IMAGE_FITS, requestedFit, 'fill');
  const variant = oneOf<A2uiImageVariant>(IMAGE_VARIANTS, requestedVariant, 'mediumFeature');
  const result = useMemo(() => (guard ? guard.url('image', url, { surfaceId, componentId }) : null), [guard, url, surfaceId, componentId]);
  const report = useRef(onDecisions);

  useIsomorphicLayoutEffect(() => {
    report.current = onDecisions;
  });

  useEffect(() => {
    if (result) report.current?.(result.allowed ? result.decisions : [...result.decisions, result.decision]);
  }, [result]);

  if (!result?.allowed) return createElement(Fragment, null, fallback);
  return createElement('img', {
    ...rest,
    src: result.value,
    alt: description === undefined || description === null ? '' : String(description),
    className: classes('a2ui-image', variant, className),
    style: { objectFit: fit === 'scaleDown' ? 'scale-down' : fit, ...style },
  });
}
