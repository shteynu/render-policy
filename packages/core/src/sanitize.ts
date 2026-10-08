import createDOMPurify, { type Config, type UponSanitizeAttributeHookEvent } from 'dompurify';
import type { TrustedHTML } from 'trusted-types/lib/index.js';
import type { CoreDecisionCode, DecisionSubject, RenderDecision } from './decisions.js';
import type { RenderPolicy, UrlSubject } from './policy.js';
import type { SinkDenylist } from './sinks.js';
import { createUrlPipeline } from './url-guard.js';
import type { RenderWindow } from './window.js';

export interface SanitizeOutcome<T> {
  readonly output: T;
  readonly decisions: readonly RenderDecision[];
}

export interface Sanitizer {
  /** Sanitize into an inert DocumentFragment. This is the only path the renderer uses. */
  toFragment(html: string): SanitizeOutcome<DocumentFragment>;
  /** Sanitize to a TrustedHTML when the Trusted Types API is present, else a string. */
  toTrustedHTML(html: string): SanitizeOutcome<TrustedHTML | string>;
}

/**
 * Attributes whose value is fetched or navigated to. Some are also on the always-forbidden
 * list below and are dropped before the URL check runs; they stay here on purpose, so that
 * the URL check does not depend on the forbid list staying as it is.
 */
const URL_ATTRIBUTES = new Set([
  'href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'background', 'cite',
  'longdesc', 'usemap', 'data', 'ping', 'codebase', 'archive', 'profile', 'manifest', 'icon',
]);

const FORM_TAGS = ['form', 'input', 'button', 'select', 'textarea', 'option', 'optgroup', 'fieldset', 'legend', 'label', 'datalist', 'output'];
const MEDIA_TAGS = ['audio', 'video', 'source', 'track', 'picture'];
/** Forbidden regardless of policy. Most are already outside DOMPurify's HTML profile; listing them is belt and braces. */
const ALWAYS_FORBIDDEN_TAGS = [
  'script', 'style', 'template', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet',
  'base', 'meta', 'link', 'noscript', 'dialog', 'marquee', 'blink', 'math',
];
/** Attributes that fetch, submit, or hook into host behaviour without a click. */
const ALWAYS_FORBIDDEN_ATTRIBUTES = [
  'srcset', 'sizes', 'ping', 'background', 'formaction', 'action', 'usemap', 'ismap',
  'is', 'slot', 'part', 'exportparts', 'popover', 'popovertarget', 'inert', 'contenteditable', 'autofocus',
];

function buildConfig(policy: RenderPolicy): Config {
  const { content } = policy;
  const forbidTags = new Set<string>([...ALWAYS_FORBIDDEN_TAGS, ...content.forbidTags]);
  if (!content.allowForms) for (const tag of FORM_TAGS) forbidTags.add(tag);
  if (!content.allowMedia) for (const tag of MEDIA_TAGS) forbidTags.add(tag);
  if (!content.allowImages) forbidTags.add('img');
  if (!content.allowSvg) forbidTags.add('svg');

  const forbidAttributes = new Set<string>([...ALWAYS_FORBIDDEN_ATTRIBUTES, ...content.forbidAttributes]);
  if (!content.allowInlineStyles) forbidAttributes.add('style');
  if (!content.allowTargetBlank) forbidAttributes.add('target');

  // DOMPurify's own URI check is kept as a second layer, aligned with the policy's scheme allowlist
  // (same shape as DOMPurify's default: listed schemes, or a relative URL).
  const schemes = policy.urls.allowedSchemes.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const allowedUri = new RegExp(`^(?:(?:${schemes}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i');

  return {
    USE_PROFILES: content.allowSvg ? { html: true, svg: true, svgFilters: true } : { html: true },
    ALLOWED_URI_REGEXP: allowedUri,
    FORBID_TAGS: [...forbidTags],
    FORBID_ATTR: [...forbidAttributes],
    ADD_ATTR: content.allowTargetBlank ? ['target'] : [],
    ALLOW_DATA_ATTR: content.allowDataAttributes,
    ALLOW_ARIA_ATTR: true,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    SANITIZE_DOM: true,
    SANITIZE_NAMED_PROPS: true,
    KEEP_CONTENT: true,
    WHOLE_DOCUMENT: false,
    FORCE_BODY: false,
  };
}

interface BlockedImage {
  readonly src: string;
  readonly reason: string;
}

/** Everything one sanitize call accumulates; the hooks read it through `state`. */
interface CallState {
  readonly decisions: RenderDecision[];
  readonly blockedImages: WeakMap<Element, BlockedImage>;
  readonly recorded: Set<string>;
}

/** One attribute as DOMPurify hands it to the hook. */
interface AttributeInput {
  readonly node: Element;
  readonly data: UponSanitizeAttributeHookEvent;
  /** Lower-cased attribute and tag names, and the value as the content wrote it. */
  readonly name: string;
  readonly tag: string;
  readonly original: string;
  /** Remove the attribute and journal why. */
  drop(subject: DecisionSubject, code: CoreDecisionCode, reason: string): void;
}

interface AttributeRule {
  readonly name: (name: string) => boolean;
  readonly apply: (attribute: AttributeInput, s: CallState) => void;
}

export function createSanitizer(win: RenderWindow, policy: RenderPolicy, denylist: SinkDenylist): Sanitizer {
  const purify = createDOMPurify(win);
  const config = buildConfig(policy);
  let state: CallState | null = null;

  const guardUrl = createUrlPipeline(win, policy, denylist);

  const record = (s: CallState, decision: RenderDecision): void => {
    s.decisions.push(decision);
    if (decision.attribute !== undefined) {
      s.recorded.add(`${decision.tag ?? ''}|${decision.attribute}|${decision.value ?? ''}`);
    }
  };

  // Attribute rules: the first rule whose `name` test holds owns the attribute; attributes no rule
  // claims are left to DOMPurify's allowlist.
  const attributeRules: readonly AttributeRule[] = [
    {
      name: (n) => n.startsWith('on'),
      apply: (a) => a.drop('attribute', 'event-handler', 'event handler attribute'),
    },
    {
      name: (n) => n === 'class',
      apply: (a, s) => {
        const tokens = a.original.split(/\s+/).filter(Boolean);
        const kept = tokens.filter((token) =>
          policy.content.allowedClassPatterns.some((pattern) => {
            pattern.lastIndex = 0;
            return pattern.test(token);
          }),
        );
        if (kept.length === 0) {
          if (tokens.length > 0) a.drop('class', 'class-not-allowed', 'class names are not in the allowlist');
          else a.data.keepAttr = false;
          return;
        }
        if (kept.length !== tokens.length) {
          a.data.attrValue = kept.join(' ');
          record(s, { kind: 'rewritten', subject: 'class', code: 'class-filtered', reason: 'class names outside the allowlist removed', tag: a.tag, attribute: a.name, value: a.original });
        }
      },
    },
    {
      name: (n) => n === 'target',
      apply: (a) => {
        if (!policy.content.allowTargetBlank || a.original.trim().toLowerCase() !== '_blank') {
          a.drop('attribute', 'target-not-allowed', 'only target="_blank" is allowed');
        }
      },
    },
    {
      name: (n) => URL_ATTRIBUTES.has(n),
      apply: (a, s) => {
        const isImage = a.tag === 'img' && a.name === 'src';
        const subject: UrlSubject = isImage ? 'image' : a.name === 'href' ? 'link' : 'url';
        // The URL steps (scheme, sink denylist, `urls.decide`, image policy) live in url-guard.ts.
        const result = guardUrl(a.original, { subject, tag: a.tag, attribute: a.name });
        for (const decision of result.decisions) record(s, decision);
        if (!result.allowed) {
          a.data.keepAttr = false;
          record(s, result.decision);
          if (isImage && result.href !== undefined && policy.images.blocked === 'placeholder') {
            s.blockedImages.set(a.node, { src: result.href, reason: result.decision.reason });
          }
          return;
        }
        if (result.value !== a.original) a.data.attrValue = result.value;
      },
    },
  ];

  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const s = state;
    if (!s) return;
    const name = data.attrName.toLowerCase();
    const tag = node.nodeName.toLowerCase();
    const original = data.attrValue;
    const rule = attributeRules.find((r) => r.name(name));
    if (!rule) return;
    rule.apply(
      {
        node, data, name, tag, original,
        drop: (subject, code, reason) => {
          data.keepAttr = false;
          record(s, { kind: 'blocked', subject, code, reason, tag, attribute: name, value: original });
        },
      },
      s,
    );
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    const s = state;
    if (!s) return;

    // Tripwire: DOMPurify never lets an event handler through; if one ever did, remove it and say so.
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) {
        node.removeAttribute(attr.name);
        record(s, { kind: 'blocked', subject: 'attribute', code: 'event-handler-survived', reason: 'event handler attribute survived sanitization', tag: node.nodeName.toLowerCase(), attribute: attr.name, value: attr.value });
      }
    }

    if (node.hasAttribute('target')) {
      node.setAttribute('rel', 'noopener noreferrer');
    }

    if (node.nodeName.toLowerCase() === 'img') {
      const blocked = s.blockedImages.get(node);
      if (blocked) {
        s.blockedImages.delete(node);
        // The placeholder goes back through the same sanitizer pass: its href and class obey the policy too.
        node.replaceWith(makePlaceholder(node, blocked));
        return;
      }
      if (!node.hasAttribute('src')) {
        node.remove();
        record(s, { kind: 'blocked', subject: 'element', code: 'image-without-src', reason: 'image without an allowed src removed', tag: 'img' });
      }
    }
  });

  const collectRemoved = (s: CallState): void => {
    for (const removed of purify.removed) {
      if ('element' in removed && removed.element) {
        const el = removed.element;
        record(s, { kind: 'blocked', subject: 'element', code: 'element-not-allowed', reason: 'element is not allowed', tag: (el.nodeName ?? '').toLowerCase() });
      } else if ('attribute' in removed && removed.attribute) {
        const attr = removed.attribute;
        const tag = (removed.from?.nodeName ?? '').toLowerCase();
        if (s.recorded.has(`${tag}|${attr.name}|${attr.value}`)) continue;
        record(s, { kind: 'blocked', subject: 'attribute', code: 'attribute-not-allowed', reason: 'attribute is not allowed', tag, attribute: attr.name, value: attr.value });
      }
    }
  };

  /** One sanitize call: fresh state for the hooks, the journal collected, the state cleared whatever happens. */
  const run = <T>(sanitize: () => T): SanitizeOutcome<T> => {
    if (state !== null) {
      throw new Error('@render-policy/core: the sanitizer was re-entered while a sanitize call was in progress');
    }
    const s: CallState = { decisions: [], blockedImages: new WeakMap(), recorded: new Set() };
    state = s;
    try {
      const output = sanitize();
      collectRemoved(s);
      return { output, decisions: s.decisions };
    } finally {
      state = null;
    }
  };

  return {
    toFragment: (html) => run(() => purify.sanitize(html, { ...config, RETURN_DOM_FRAGMENT: true })),
    toTrustedHTML: (html) => run(() => purify.sanitize(html, { ...config, RETURN_TRUSTED_TYPE: true })),
  };
}

function makePlaceholder(img: Element, blocked: BlockedImage): Element {
  const doc = img.ownerDocument;
  const link = doc.createElement('a');
  link.setAttribute('class', 'rp-blocked-image');
  link.setAttribute('href', blocked.src);
  link.setAttribute('target', '_blank');
  link.setAttribute('rel', 'noopener noreferrer');
  link.setAttribute('title', blocked.reason);
  const alt = img.getAttribute('alt')?.trim();
  link.textContent = alt ? `[image blocked: ${alt}]` : '[image blocked]';
  return link;
}
