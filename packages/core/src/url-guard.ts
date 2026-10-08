import { SINK_DENYLIST } from './data/sink-domains.js';
import type { CoreDecisionCode, RenderDecision } from './decisions.js';
import { messageOf } from './errors.js';
import { resolvePolicy, type RenderMode, type RenderPolicy, type RenderPolicyOverrides, type UrlSubject } from './policy.js';
import { matchSink, type SinkDenylist } from './sinks.js';
import { checkUrl, checkUrlHeuristics, hostMatches, usableBase, type ParsedUrl } from './url.js';
import { resolveWindow, type RenderWindow } from './window.js';

/** Where a URL is about to be used: what it is for, and the element and attribute (or property) it goes into. */
export interface UrlRequest {
  /** `image` URLs go through the image policy (they are fetched without a click); `link` and `url` do not. */
  readonly subject: UrlSubject;
  /** The element's tag, lower-case. A caller outside HTML names the element it will create (`img`, `video`, `a`). */
  readonly tag: string;
  /** The attribute or property the URL goes into, lower-case. */
  readonly attribute: string;
}

/**
 * The outcome of one URL check. `decisions` is what the check journaled along the way (a sink
 * logged under `sinkDenylist: 'log'`, a query string stripped, a rewrite); a refused URL also
 * carries the `decision` that refused it, which is not in `decisions`.
 */
export type UrlGuardResult =
  | { readonly allowed: true; readonly value: string; readonly decisions: readonly RenderDecision[] }
  | {
      readonly allowed: false;
      readonly decision: RenderDecision;
      readonly decisions: readonly RenderDecision[];
      /** The URL as it stood when it was refused, for a "click to open" placeholder. Absent when it never parsed or its scheme was refused. */
      readonly href?: string;
    };

/** Checks one URL against a policy. Never throws: application hooks that throw refuse the URL with a journal entry. */
export type UrlGuard = (raw: string, request: UrlRequest) => UrlGuardResult;

export interface UrlGuardOptions {
  /** The window whose location relative URLs resolve against. Defaults to the global window. */
  readonly window?: RenderWindow;
  /** Policy preset. Default 'balanced'. */
  readonly mode?: RenderMode;
  /** Overrides applied on top of the preset. Only the `urls` and `images` groups matter here. */
  readonly policy?: RenderPolicyOverrides;
  /** Replace the bundled sink denylist. */
  readonly sinkDenylist?: SinkDenylist;
  /** Receive every decision as it is made, the refusing one included. */
  readonly onDecision?: (decision: RenderDecision) => void;
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

/** A URL on its way through the URL steps. */
interface UrlTarget {
  readonly request: UrlRequest;
  readonly original: string;
  readonly isImage: boolean;
  /** The URL as it now stands; a step that rewrites it replaces this, and later steps check the new one. */
  parsed: ParsedUrl;
  /** The value to use when every step passes. */
  value: string;
  readonly decisions: RenderDecision[];
}

/** A URL step returns the reason to block, or null to pass the URL on. */
type UrlStep = (target: UrlTarget) => Problem | null;

/**
 * The URL policy of a resolved {@link RenderPolicy}, as a function. The sanitizer runs every URL
 * attribute through it; {@link createUrlGuard} exposes it for URLs that never pass through HTML
 * (structured agent UI, where a component property holds the URL).
 */
export function createUrlPipeline(win: RenderWindow, policy: RenderPolicy, denylist: SinkDenylist): UrlGuard {
  const pageOrigin = (): string | null => {
    const origin = win.document.location?.origin;
    return origin && origin !== 'null' ? origin : null;
  };
  const pageBase = (): string | undefined => usableBase(win.document.location?.href);

  const entry = (target: UrlTarget, kind: RenderDecision['kind'], subject: RenderDecision['subject'], problem: Problem): RenderDecision => ({
    kind,
    subject,
    code: problem.code,
    reason: problem.reason,
    tag: target.request.tag,
    attribute: target.request.attribute,
    value: target.original,
  });

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
  // check runs before anything sees the URL (in the guard below), the sink denylist before
  // application code, and the image policy last, so that a `urls.decide` rewrite is checked too.
  const urlSteps: readonly UrlStep[] = [
    // Known exfiltration sinks. `log` mode flags the URL and lets it through.
    (target) => {
      if (target.parsed.relative || policy.urls.sinkDenylist === 'off') return null;
      const { isImage, parsed } = target;
      const explicitlyAllowed =
        isImage && Array.isArray(policy.images.hosts) && hostMatches(parsed.url.host, policy.images.hosts, policy.images.allowWildcardHosts);
      const hit = explicitlyAllowed ? null : matchSink(parsed.url, denylist);
      if (!hit) return null;
      const reason = `host matches the sink denylist (${hit.category}: ${hit.pattern}, list ${denylist.version})`;
      if (policy.urls.sinkDenylist === 'block') return { code: 'sink-host', reason };
      target.decisions.push({ ...entry(target, 'flagged', target.request.subject, { code: 'sink-host', reason }), value: parsed.normalized });
      return null;
    },

    // Application URL hook: the place a link policy lives (deny or redirect off-site links). If it
    // throws, that one URL is dropped. An image is screened as the content wrote it before the hook
    // sees it, and the hook gets the URL after query handling: a rewrite to a same-origin proxy must
    // not carry through a host, query or payload the image policy would have blocked.
    (target) => {
      if (!policy.urls.decide) return null;
      const { subject, tag, attribute } = target.request;
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
        decision = policy.urls.decide(new URL((screened ?? target.parsed.url).href), { subject, tag, attribute, relative: target.parsed.relative });
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
        if (stripped) target.decisions.push(entry(target, 'rewritten', 'image', stripped));
        target.decisions.push(entry(target, 'rewritten', subject, { code: 'url-rewritten', reason: decision.reason ?? 'rewritten by urls.decide' }));
      }
      return null;
    },

    // Image hosts, query handling, heuristics and `images.rewriteUrl`, on the URL as it now stands.
    (target) => {
      if (!target.isImage) return null;
      const outcome = applyImagePolicy(target.parsed);
      if (!outcome.ok) return outcome;
      if (outcome.value !== target.original) {
        target.value = outcome.value;
        if (outcome.rewritten) target.decisions.push(entry(target, 'rewritten', 'image', outcome.rewritten));
      }
      return null;
    },
  ];

  return (raw, request) => {
    const decisions: RenderDecision[] = [];
    const verdict = checkUrl(raw, policy.urls, pageBase());
    if (!verdict.ok) {
      // Nothing parseable to show, so a refused URL gets no placeholder href.
      return { allowed: false, decisions, decision: { kind: 'blocked', subject: request.subject, code: verdict.code, reason: verdict.reason, tag: request.tag, attribute: request.attribute, value: raw } };
    }
    const target: UrlTarget = { request, original: raw, isImage: request.subject === 'image', parsed: verdict.parsed, value: raw, decisions };
    for (const step of urlSteps) {
      const problem = step(target);
      if (problem) {
        return { allowed: false, decisions, decision: entry(target, 'blocked', request.subject, problem), href: target.parsed.url.href };
      }
    }
    return { allowed: true, value: target.value, decisions };
  };
}

/**
 * Check URLs that never pass through HTML against the same policy the renderer applies to URL
 * attributes: scheme allowlist, sink denylist, `urls.decide`, and for `image` URLs the host
 * allowlist, query handling, heuristics and `images.rewriteUrl`. Use it where agent output carries
 * a URL as data (a component property, a function argument) and your code is about to fetch it or
 * navigate to it; use the value it returns, not the one you passed in.
 */
export function createUrlGuard(options: UrlGuardOptions = {}): UrlGuard {
  const pipeline = createUrlPipeline(resolveWindow(options.window), resolvePolicy(options.mode, options.policy), options.sinkDenylist ?? SINK_DENYLIST);
  const onDecision = options.onDecision;
  if (!onDecision) return pipeline;
  return (raw, request) => {
    const result = pipeline(raw, request);
    for (const decision of result.decisions) onDecision(decision);
    if (!result.allowed) onDecision(result.decision);
    return result;
  };
}
