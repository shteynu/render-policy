/** The basic catalog's `Text.variant`. */
export type A2uiTextVariant = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'caption' | 'body';
/** The basic catalog's `Image.fit` (CSS `object-fit`, `scaleDown` for `scale-down`). */
export type A2uiImageFit = 'contain' | 'cover' | 'fill' | 'none' | 'scaleDown';
/** The basic catalog's `Image.variant`. */
export type A2uiImageVariant = 'icon' | 'avatar' | 'smallFeature' | 'mediumFeature' | 'largeFeature' | 'header';

// Variants and fit come from the agent's message: only the catalog's values become a tag, a class or a style.
const TEXT_VARIANTS: readonly string[] = ['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body'];
const IMAGE_VARIANTS: readonly string[] = ['icon', 'avatar', 'smallFeature', 'mediumFeature', 'largeFeature', 'header'];
const IMAGE_FITS: readonly string[] = ['contain', 'cover', 'fill', 'none', 'scaleDown'];
const oneOf = <T extends string>(values: readonly string[], value: unknown, otherwise: T): T => (values.includes(value as string) ? (value as T) : otherwise);

export const textVariant = (value: unknown): A2uiTextVariant => oneOf(TEXT_VARIANTS, value, 'body');
export const imageVariant = (value: unknown): A2uiImageVariant => oneOf(IMAGE_VARIANTS, value, 'mediumFeature');
export const imageFit = (value: unknown): A2uiImageFit => oneOf(IMAGE_FITS, value, 'fill');
