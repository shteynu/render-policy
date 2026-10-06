import createDOMPurify, { type Config, type UponSanitizeAttributeHookEvent } from 'dompurify';
import type { TrustedHTML } from 'trusted-types/lib/index.js';
import type { CoreDecisionCode, DecisionSubject, RenderDecision } from './decisions.js';
import { messageOf } from './errors.js';
import type { RenderPolicy } from './policy.js';
import { matchSink, type SinkDenylist } from './sinks.js';
import { checkUrl, checkUrlHeuristics, hostMatches, usableBase, type ParsedUrl } from './url.js';
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

interface Problem {
  readonly code: CoreDecisionCode;
  readonly reason: string;
}

type ImageOutcome =
  | { readonly ok: true; readonly value: string; readonly rewritten: Problem | null }
  | ({ readonly ok: false } & Problem);

type ImageScreen =
  | { readonly ok: true; readonly url: URL | null; readonly stripped: Problem | null }
  | ({ readonly ok: false } & Problem);

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

/** A URL attribute on its way through the URL steps. */
interface UrlTarget {
  readonly tag: string;
  readonly attribute: string;
  readonly original: string;
  readonly subject: DecisionSubject;
  readonly isImage: boolean;
  /** The URL as it now stands; a step that rewrites it replaces this, and later steps check the new one. */
  parsed: ParsedUrl;
  /** The attribute value to write back when every step passes. */
  value: string;
}

/** A URL step returns the reason to block, or null to pass the URL on. */
type UrlStep = (target: UrlTarget, s: CallState) => Problem | null;

export function createSanitizer(win: RenderWindow, policy: RenderPolicy, denylist: SinkDenylist): Sanitizer {
  const purify = createDOMPurify(win);
  const config = buildConfig(policy);
  let state: CallState | null = null;

  const pageOrigin = (): string | null => {
    const origin = win.document.location?.origin;
    return origin && origin !== 'null' ? origin : null;
  };
  const pageBase = (): string | undefined => usableBase(win.document.location?.href);

  const record = (s: CallState, decision: RenderDecision): void => {
    s.decisions.push(decision);
    if (decision.attribute !== undefined) {
      s.recorded.add(`${decision.tag ?? ''}|${decision.attribute}|${decision.value ?? ''}`);
    }
  };

  // Host, query and heuristic checks on an image URL. `url` is null when the URL is local
  // (relative or same-origin) and needs no checks; otherwise it is the URL after query handling.
  const screenImage = (parsed: ParsedUrl): ImageScreen => {
    if (parsed.relative) {
      // Resolves within the host page's own origin.
      return { ok: true, url: null, stripped: null };
    }
    const origin = pageOrigin();
    const url = new URL(parsed.url.href);
    if (origin !== null && url.origin === origin) {
      return { ok: true, url: null, stripped: null };
    }
    const images = policy.images;
    if (images.hosts === 'none') {
      return { ok: false, code: 'remote-images-disabled', reason: 'remote images are disabled by the policy' };
    }
    if (images.hosts !== 'any' && !hostMatches(url.host, images.hosts, images.allowWildcardHosts)) {
      return { ok: false, code: 'image-host-not-allowed', reason: `image host "${url.host}" is not in the allowlist` };
    }
    let stripped: Problem | null = null;
    const hasQuery = url.search !== '' || url.hash !== '';
    if (hasQuery && images.query === 'deny') {
      return { ok: false, code: 'image-query-denied', reason: 'image URL carries a query string or fragment' };
    }
    if (hasQuery && images.query === 'strip') {
      url.search = '';
      url.hash = '';
      stripped = { code: 'image-query-stripped', reason: 'query string removed' };
    }
    if (policy.urls.heuristics) {
      const problem = checkUrlHeuristics(url, policy.urls.heuristics);
      if (problem) return { ok: false, ...problem };
    }
    return { ok: true, url, stripped };
  };

  const applyImagePolicy = (parsed: ParsedUrl): ImageOutcome => {
    const screen = screenImage(parsed);
    if (!screen.ok) return screen;
    if (screen.url === null) return { ok: true, value: parsed.normalized, rewritten: null };
    const { url } = screen;
    const images = policy.images;
    let rewritten = screen.stripped;
    let value = rewritten ? url.href : parsed.normalized;
    if (images.rewriteUrl) {
      let out: string | null;
      try {
        out = images.rewriteUrl(url);
      } catch (error) {
        // Application code failed: the image is blocked and the render goes on.
        return { ok: false, code: 'image-rewrite-failed', reason: `images.rewriteUrl threw: ${messageOf(error)}` };
      }
      if (out === null) return { ok: false, code: 'image-rewrite-rejected', reason: 'rejected by images.rewriteUrl' };
      const check = checkUrl(out, policy.urls, pageBase());
      if (!check.ok) return { ok: false, code: 'image-rewrite-invalid', reason: `images.rewriteUrl returned an invalid URL: ${check.reason}` };
      value = out;
      rewritten = { code: 'image-rewritten', reason: 'rewritten by images.rewriteUrl' };
    }
    return { ok: true, value, rewritten };
  };

  // URL steps, in order. Each one may block the URL, change it (`target.parsed` and `target.value`),
  // or pass it on; the first block ends the chain. The order is the security argument: the scheme
  // check runs before anything sees the URL (in the hook below), the sink denylist before
  // application code, and the image policy last, so that a `urls.decide` rewrite is checked too.
  const urlSteps: readonly UrlStep[] = [
    // Known exfiltration sinks. `log` mode flags the URL and lets it through.
    (target, s) => {
      if (target.parsed.relative || policy.urls.sinkDenylist === 'off') return null;
      const { isImage, parsed } = target;
      const explicitlyAllowed =
        isImage && Array.isArray(policy.images.hosts) && hostMatches(parsed.url.host, policy.images.hosts, policy.images.allowWildcardHosts);
      const hit = explicitlyAllowed ? null : matchSink(parsed.url, denylist);
      if (!hit) return null;
      const reason = `host matches the sink denylist (${hit.category}: ${hit.pattern}, list ${denylist.version})`;
      if (policy.urls.sinkDenylist === 'block') return { code: 'sink-host', reason };
      record(s, { kind: 'flagged', subject: target.subject, code: 'sink-host', reason, tag: target.tag, attribute: target.attribute, value: parsed.normalized });
      return null;
    },

    // Application URL hook: the place a link policy lives (deny or redirect off-site links). If it
    // throws, that one URL is dropped. An image is screened as the content wrote it before the hook
    // sees it, and the hook gets the URL after query handling: a rewrite to a same-origin proxy must
    // not carry through a host, query or payload the image policy would have blocked.
    (target, s) => {
      if (!policy.urls.decide) return null;
      const { subject, tag, attribute, original } = target;
      let screened: URL | null = null;
      let stripped: Problem | null = null;
      if (target.isImage) {
        const screen = screenImage(target.parsed);
        if (!screen.ok) return screen;
        screened = screen.url;
        stripped = screen.stripped;
      }
      let decision;
      try {
        decision = policy.urls.decide(new URL((screened ?? target.parsed.url).href), { subject: subject as 'link' | 'image' | 'url', tag, attribute, relative: target.parsed.relative });
      } catch (error) {
        return { code: 'url-decider-failed', reason: `urls.decide threw: ${messageOf(error)}` };
      }
      if (!decision) return null;
      if (decision.allow === false) return { code: 'url-denied', reason: decision.reason ?? 'denied by urls.decide' };
      if (typeof decision.rewrite === 'string' && decision.rewrite !== target.parsed.normalized) {
        const check = checkUrl(decision.rewrite, policy.urls, pageBase());
        if (!check.ok) return { code: 'url-rewrite-invalid', reason: `urls.decide returned an invalid URL: ${check.reason}` };
        target.parsed = check.parsed;
        target.value = decision.rewrite;
        if (stripped) record(s, { kind: 'rewritten', subject: 'image', code: stripped.code, reason: stripped.reason, tag, attribute, value: original });
        record(s, { kind: 'rewritten', subject, code: 'url-rewritten', reason: decision.reason ?? 'rewritten by urls.decide', tag, attribute, value: original });
      }
      return null;
    },

    // Image hosts, query handling, heuristics and `images.rewriteUrl`, on the URL as it now stands.
    (target, s) => {
      if (!target.isImage) return null;
      const outcome = applyImagePolicy(target.parsed);
      if (!outcome.ok) return outcome;
      if (outcome.value !== target.original) {
        target.value = outcome.value;
        if (outcome.rewritten) {
          record(s, { kind: 'rewritten', subject: 'image', code: outcome.rewritten.code, reason: outcome.rewritten.reason, tag: target.tag, attribute: target.attribute, value: target.original });
        }
      }
      return null;
    },
  ];

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
        const subject: DecisionSubject = isImage ? 'image' : a.name === 'href' ? 'link' : 'url';
        const verdict = checkUrl(a.original, policy.urls, pageBase());
        if (!verdict.ok) {
          // Nothing parseable to show, so a refused image gets no placeholder.
          a.drop(subject, verdict.code, verdict.reason);
          return;
        }
        const target: UrlTarget = { tag: a.tag, attribute: a.name, original: a.original, subject, isImage, parsed: verdict.parsed, value: a.original };
        for (const step of urlSteps) {
          const problem = step(target, s);
          if (problem) {
            a.drop(subject, problem.code, problem.reason);
            if (isImage && policy.images.blocked === 'placeholder') {
              s.blockedImages.set(a.node, { src: target.parsed.url.href, reason: problem.reason });
            }
            return;
          }
        }
        if (target.value !== a.original) a.data.attrValue = target.value;
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
