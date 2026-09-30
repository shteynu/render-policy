import createDOMPurify, { type Config, type WindowLike } from 'dompurify';
import type { TrustedHTML } from 'trusted-types/lib/index.js';
import type { RenderDecision, DecisionSubject } from './decisions.js';
import type { RenderPolicy } from './policy.js';
import { matchSink, type SinkDenylist } from './sinks.js';
import { checkUrl, checkUrlHeuristics, hostMatches, type ParsedUrl } from './url.js';

export interface SanitizeOutcome<T> {
  readonly output: T;
  readonly decisions: readonly RenderDecision[];
}

export interface Sanitizer {
  /** Sanitize into an inert DocumentFragment. This is the only path the renderer uses. */
  toFragment(html: string): SanitizeOutcome<DocumentFragment>;
  /** Sanitize to a string. Only for sinks you cannot avoid; prefer toFragment. */
  toHtml(html: string): SanitizeOutcome<string>;
  /** Sanitize to a TrustedHTML when the Trusted Types API is present, else a string. */
  toTrustedHTML(html: string): SanitizeOutcome<TrustedHTML | string>;
}

/** Attributes whose value is fetched or navigated to. */
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
  const forbidTags = new Set<string>([...ALWAYS_FORBIDDEN_TAGS, ...policy.forbidTags]);
  if (!policy.allowForms) for (const tag of FORM_TAGS) forbidTags.add(tag);
  if (!policy.allowMedia) for (const tag of MEDIA_TAGS) forbidTags.add(tag);
  if (!policy.allowImages) forbidTags.add('img');
  if (!policy.allowSvg) forbidTags.add('svg');

  const forbidAttributes = new Set<string>([...ALWAYS_FORBIDDEN_ATTRIBUTES, ...policy.forbidAttributes]);
  if (!policy.allowInlineStyles) forbidAttributes.add('style');
  if (!policy.allowTargetBlank) forbidAttributes.add('target');

  // DOMPurify's own URI check is kept as a second layer, aligned with the policy's scheme allowlist
  // (same shape as DOMPurify's default: listed schemes, or a relative URL).
  const schemes = policy.allowedSchemes.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const allowedUri = new RegExp(`^(?:(?:${schemes}):|[^a-z]|[a-z+.\\-]+(?:[^a-z+.\\-:]|$))`, 'i');

  return {
    USE_PROFILES: policy.allowSvg ? { html: true, svg: true, svgFilters: true } : { html: true },
    ALLOWED_URI_REGEXP: allowedUri,
    FORBID_TAGS: [...forbidTags],
    FORBID_ATTR: [...forbidAttributes],
    ADD_ATTR: policy.allowTargetBlank ? ['target'] : [],
    ALLOW_DATA_ATTR: policy.allowDataAttributes,
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

interface CallState {
  readonly decisions: RenderDecision[];
  readonly blockedImages: WeakMap<Element, BlockedImage>;
  readonly recorded: Set<string>;
}

type ImageOutcome =
  | { readonly ok: true; readonly value: string; readonly rewritten: string | null }
  | { readonly ok: false; readonly reason: string };

export function createSanitizer(win: WindowLike, policy: RenderPolicy, denylist: SinkDenylist): Sanitizer {
  const purify = createDOMPurify(win);
  const config = buildConfig(policy);
  let state: CallState | null = null;

  const pageOrigin = (): string | null => {
    const origin = win.document?.location?.origin;
    return origin && origin !== 'null' ? origin : null;
  };

  const record = (s: CallState, decision: RenderDecision): void => {
    s.decisions.push(decision);
    if (decision.attribute !== undefined) {
      s.recorded.add(`${decision.tag ?? ''}|${decision.attribute}|${decision.value ?? ''}`);
    }
  };

  const applyImagePolicy = (parsed: ParsedUrl): ImageOutcome => {
    if (!parsed.url) {
      // Relative: resolves against the host page, so it is same-origin by construction.
      return { ok: true, value: parsed.normalized, rewritten: null };
    }
    const origin = pageOrigin();
    const url = new URL(parsed.url.href);
    if (origin !== null && url.origin === origin) {
      return { ok: true, value: parsed.normalized, rewritten: null };
    }
    if (policy.imageHosts === 'none') {
      return { ok: false, reason: 'remote images are disabled by the policy' };
    }
    if (policy.imageHosts !== 'any' && !hostMatches(url.host, policy.imageHosts, policy.allowWildcardHosts)) {
      return { ok: false, reason: `image host "${url.host}" is not in the allowlist` };
    }
    let rewritten: string | null = null;
    const hasQuery = url.search !== '' || url.hash !== '';
    if (hasQuery && policy.imageQuery === 'deny') {
      return { ok: false, reason: 'image URL carries a query string or fragment' };
    }
    if (hasQuery && policy.imageQuery === 'strip') {
      url.search = '';
      url.hash = '';
      rewritten = 'query string removed';
    }
    if (policy.urlHeuristics) {
      const why = checkUrlHeuristics(url, policy.urlHeuristics);
      if (why) return { ok: false, reason: why };
    }
    let value = rewritten ? url.href : parsed.normalized;
    if (policy.rewriteImageUrl) {
      const out = policy.rewriteImageUrl(url);
      if (out === null) return { ok: false, reason: 'rejected by rewriteImageUrl' };
      const check = checkUrl(out, policy);
      if (!check.ok) return { ok: false, reason: `rewriteImageUrl returned an invalid URL: ${check.reason}` };
      value = out;
      rewritten = 'rewritten by rewriteImageUrl';
    }
    return { ok: true, value, rewritten };
  };

  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const s = state;
    if (!s) return;
    const name = data.attrName.toLowerCase();
    const tag = node.nodeName.toLowerCase();
    const original = data.attrValue;
    const drop = (subject: DecisionSubject, reason: string): void => {
      data.keepAttr = false;
      record(s, { kind: 'blocked', subject, reason, tag, attribute: name, value: original });
    };

    if (name.startsWith('on')) {
      drop('attribute', 'event handler attribute');
      return;
    }

    if (name === 'class') {
      const tokens = original.split(/\s+/).filter(Boolean);
      const kept = tokens.filter((token) =>
        policy.allowedClassPatterns.some((pattern) => {
          pattern.lastIndex = 0;
          return pattern.test(token);
        }),
      );
      if (kept.length === 0) {
        if (tokens.length > 0) drop('class', 'class names are not in the allowlist');
        else data.keepAttr = false;
        return;
      }
      if (kept.length !== tokens.length) {
        data.attrValue = kept.join(' ');
        record(s, { kind: 'rewritten', subject: 'class', reason: 'class names outside the allowlist removed', tag, attribute: name, value: original });
      }
      return;
    }

    if (name === 'target') {
      if (!policy.allowTargetBlank || original.trim().toLowerCase() !== '_blank') {
        drop('attribute', 'only target="_blank" is allowed');
      }
      return;
    }

    if (!URL_ATTRIBUTES.has(name)) return;

    const isImage = tag === 'img' && name === 'src';
    const subject: DecisionSubject = isImage ? 'image' : name === 'href' ? 'link' : 'url';
    const verdict = checkUrl(original, policy);
    if (!verdict.ok) {
      drop(subject, verdict.reason);
      return;
    }
    const parsed = verdict.parsed;

    if (parsed.url && policy.sinkDenylist !== 'off') {
      const explicitlyAllowed =
        isImage && Array.isArray(policy.imageHosts) && hostMatches(parsed.url.host, policy.imageHosts, policy.allowWildcardHosts);
      const hit = explicitlyAllowed ? null : matchSink(parsed.url, denylist);
      if (hit) {
        const reason = `host matches the sink denylist (${hit.category}: ${hit.pattern}, list ${denylist.version})`;
        if (policy.sinkDenylist === 'block') {
          drop(subject, reason);
          if (isImage && policy.blockedImage === 'placeholder') s.blockedImages.set(node, { src: parsed.url.href, reason });
          return;
        }
        record(s, { kind: 'flagged', subject, reason, tag, attribute: name, value: parsed.normalized });
      }
    }

    if (!isImage) return;

    const outcome = applyImagePolicy(parsed);
    if (!outcome.ok) {
      drop('image', outcome.reason);
      if (policy.blockedImage === 'placeholder') s.blockedImages.set(node, { src: parsed.url?.href ?? parsed.normalized, reason: outcome.reason });
      return;
    }
    if (outcome.value !== original) {
      data.attrValue = outcome.value;
      if (outcome.rewritten) {
        record(s, { kind: 'rewritten', subject: 'image', reason: outcome.rewritten, tag, attribute: name, value: original });
      }
    }
  });

  purify.addHook('afterSanitizeAttributes', (node) => {
    const s = state;
    if (!s) return;

    // Tripwire: DOMPurify never lets an event handler through; if one ever did, remove it and say so.
    for (const attr of Array.from(node.attributes)) {
      if (/^on/i.test(attr.name)) {
        node.removeAttribute(attr.name);
        record(s, { kind: 'blocked', subject: 'attribute', reason: 'event handler attribute survived sanitization', tag: node.nodeName.toLowerCase(), attribute: attr.name, value: attr.value });
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
        record(s, { kind: 'blocked', subject: 'element', reason: 'image without an allowed src removed', tag: 'img' });
      }
    }
  });

  const collectRemoved = (s: CallState): void => {
    for (const removed of purify.removed) {
      if ('element' in removed && removed.element) {
        const el = removed.element;
        record(s, { kind: 'blocked', subject: 'element', reason: 'element is not allowed', tag: (el.nodeName ?? '').toLowerCase() });
      } else if ('attribute' in removed && removed.attribute) {
        const attr = removed.attribute;
        const tag = (removed.from?.nodeName ?? '').toLowerCase();
        if (s.recorded.has(`${tag}|${attr.name}|${attr.value}`)) continue;
        record(s, { kind: 'blocked', subject: 'attribute', reason: 'attribute is not allowed', tag, attribute: attr.name, value: attr.value });
      }
    }
  };

  const begin = (): CallState => {
    const s: CallState = { decisions: [], blockedImages: new WeakMap(), recorded: new Set() };
    state = s;
    return s;
  };

  return {
    toFragment(html) {
      const s = begin();
      try {
        const output = purify.sanitize(html, { ...config, RETURN_DOM_FRAGMENT: true });
        collectRemoved(s);
        return { output, decisions: s.decisions };
      } finally {
        state = null;
      }
    },
    toHtml(html) {
      const s = begin();
      try {
        const output = purify.sanitize(html, { ...config });
        collectRemoved(s);
        return { output, decisions: s.decisions };
      } finally {
        state = null;
      }
    },
    toTrustedHTML(html) {
      const s = begin();
      try {
        const output = purify.sanitize(html, { ...config, RETURN_TRUSTED_TYPE: true });
        collectRemoved(s);
        return { output, decisions: s.decisions };
      } finally {
        state = null;
      }
    },
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
