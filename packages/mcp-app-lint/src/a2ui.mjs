/**
 * Static checks over A2UI v0.9 server-to-client messages (createSurface, updateComponents,
 * updateDataModel, deleteSurface). A2UI sends no HTML; the hazards are URLs the client fetches
 * without a click (Image, Video, AudioPlayer, theme.iconUrl), URLs it navigates to (openUrl), and
 * Markdown in Text that breaks the basic catalog's "no HTML, images or links".
 *
 * Most values are bound to the data model, so the effective value exists only at render time. This
 * scan resolves absolute `{ "path": … }` bindings and `formatString` interpolations against the
 * `updateDataModel` messages of the same stream, after every message, so a value swapped after the
 * first render is seen too. What it cannot resolve (relative paths in list templates, client
 * functions, data from a later stream) it leaves to the runtime check, `@render-policy/a2ui`.
 */
import { checkUrl, DEFAULT_URL_HEURISTICS } from '@render-policy/core';
import { checkUrlHeuristics } from '@render-policy/core/internal';
import { parseDomainPattern, sinkScope } from './domains.mjs';

/**
 * @import { Finding } from './lint.mjs'
 */
/**
 * One message and the line it starts on, when the input had lines (JSONL).
 * @typedef {{ message: unknown, line?: number }} A2uiEntry
 */
/** @typedef {'fetched' | 'openUrl'} UrlUse */
/**
 * Where a value sits: surface, component and property, plus the data-model path it came from.
 * @typedef {{ surfaceId: string, componentId?: string, property: string, dataPath?: string, line?: number }} Place
 */

/** Basic-catalog properties the client fetches without a click. */
const FETCHED_PROPERTIES = /** @type {Record<string, string>} */ ({ Image: 'url', Video: 'url', AudioPlayer: 'url' });
/** The catalog: openUrl must resolve to http or https. */
const OPEN_URL_POLICY = { allowedSchemes: ['http', 'https'], allowRelativeUrls: true };
const MAX_SHOWN = 120;

/** @param {unknown} value */
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {string} value */
const shown = (value) => (value.length > MAX_SHOWN ? `${value.slice(0, MAX_SHOWN)}…` : value);
/** @param {Place} p */
const placeName = (p) => `${p.surfaceId}/${p.componentId ?? 'theme'}.${p.property}${p.dataPath ? ` <- ${p.dataPath}` : ''}`;
/** @param {Place} p */
const placeText = (p) =>
  `${p.componentId ? `component "${p.componentId}"` : 'the surface theme'} (surface "${p.surfaceId}") ${p.property}${p.dataPath ? `, bound to ${p.dataPath}` : ''}`;

/**
 * Messages from the text of a file: one message, an array of them, an object with `messages` (the
 * list wrapper and the specification's samples), or JSONL. Throws on a line that does not parse.
 * @param {string} text
 * @returns {A2uiEntry[]}
 */
export function parseA2uiMessages(text) {
  /** @type {unknown} */
  let whole;
  try {
    whole = JSON.parse(text);
  } catch {
    whole = undefined;
  }
  if (whole !== undefined) {
    if (Array.isArray(whole)) return whole.map((message) => ({ message }));
    if (isObject(whole) && Array.isArray(/** @type {any} */ (whole).messages)) return /** @type {any} */ (whole).messages.map((/** @type {unknown} */ message) => ({ message }));
    return [{ message: whole }];
  }
  /** @type {A2uiEntry[]} */
  const entries = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = (lines[i] ?? '').trim();
    if (line === '') continue;
    try {
      entries.push({ message: JSON.parse(line), line: i + 1 });
    } catch (error) {
      throw new Error(`line ${i + 1}: not a JSON message (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return entries;
}

/**
 * JSON Pointer segments; `/` and `` are the whole model.
 * @param {string} path
 */
const segments = (path) => (path === '' || path === '/' ? [] : path.split('/').slice(1).map((s) => s.replace(/~1/g, '/').replace(/~0/g, '~')));

/**
 * @param {unknown} model
 * @param {string} path
 */
function readPath(model, path) {
  /** @type {any} */
  let node = model;
  for (const key of segments(path)) {
    if (node === null || typeof node !== 'object') return undefined;
    node = node[key];
  }
  return node;
}

/**
 * The model after one updateDataModel: `value` replaces what is at `path`; no `value` removes it.
 * @param {unknown} model
 * @param {string} path
 * @param {unknown} value
 * @param {boolean} remove
 */
function writePath(model, path, value, remove) {
  const keys = segments(path);
  if (keys.length === 0) return remove ? {} : structuredClone(value);
  /** @type {any} */
  const root = isObject(model) || Array.isArray(model) ? model : {};
  let node = root;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === null || typeof node[key] !== 'object') node[key] = {};
    node = node[key];
  }
  const last = /** @type {string} */ (keys.at(-1));
  if (remove) delete node[last];
  else node[last] = structuredClone(value);
  return root;
}

/**
 * `formatString` with only `${/absolute/path}` interpolations, resolved; null when it calls a
 * function or uses a relative path, which only the client can resolve.
 * @param {string} template
 * @param {unknown} model
 */
function interpolate(template, model) {
  let resolvable = true;
  const out = template.replace(/(\\?)\$\{([^}]*)\}/g, (match, escape, expression) => {
    if (escape) return match.slice(1);
    const path = String(expression).trim();
    if (!/^\/[^\s(),:'"]*$/.test(path)) {
      resolvable = false;
      return '';
    }
    const value = readPath(model, path);
    return value === undefined || value === null ? '' : String(value);
  });
  return resolvable ? out : null;
}

/** Interpolations that are not escaped with a backslash. */
const INTERPOLATION_RE = /(?<!\\)\$\{/;
/** Scheme and authority of an absolute URL template. */
const AUTHORITY_RE = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*/i;

/**
 * Markup the basic catalog keeps out of Text. Code spans and fences are left out first: `<b>` in
 * code is shown as code.
 * @param {string} text
 */
function textMarkup(text) {
  const prose = text.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  /** @type {string[]} */
  const kinds = [];
  const TAG_RE = /<\/?[a-z][a-z0-9-]*(\s[^<>]*)?\/?>|<!--[\s\S]*?(-->|$)/gi;
  if (TAG_RE.test(prose)) kinds.push('raw HTML');
  // A URL inside a tag is part of the HTML, not a link of its own.
  const withoutTags = prose.replace(TAG_RE, ' ');
  if (/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])/.test(withoutTags)) kinds.push('an image');
  const withoutImages = withoutTags.replace(/!\[[^\]]*\](\([^)]*\)|\[[^\]]*\])/g, ' ');
  if (/\[[^\]]+\]\([^)]*\)|\[[^\]]+\]\[[^\]]*\]|<[a-z][a-z0-9+.-]*:[^\s>]+>|\bhttps?:\/\/\S|\bwww\.[a-z0-9-]+\.[a-z]/i.test(withoutImages)) kinds.push('a link');
  return kinds;
}

/**
 * Every `{ call: 'openUrl' }` inside a component, with the property path that leads to it.
 * @param {unknown} node
 * @param {string} at
 * @param {Array<{ args: any, at: string }>} out
 */
function findOpenUrlCalls(node, at, out) {
  if (Array.isArray(node)) {
    node.forEach((item, i) => findOpenUrlCalls(item, `${at}[${i}]`, out));
    return out;
  }
  if (!isObject(node)) return out;
  const object = /** @type {Record<string, unknown>} */ (node);
  if (object.call === 'openUrl') out.push({ args: object.args, at });
  for (const [key, value] of Object.entries(object)) findOpenUrlCalls(value, at ? `${at}.${key}` : key, out);
  return out;
}

/**
 * Findings over a stream of A2UI v0.9 messages. `uri` is the file the messages came from.
 * @param {readonly (A2uiEntry | unknown)[]} input messages, or entries with their line
 * @param {string} uri
 * @returns {Finding[]}
 */
export function lintA2uiMessages(input, uri) {
  /** @type {A2uiEntry[]} */
  const entries = input.map((item) => (isObject(item) && 'message' in /** @type {object} */ (item) ? /** @type {A2uiEntry} */ (item) : { message: item }));
  /** @type {Finding[]} */
  const findings = [];
  const reported = new Set();
  /** @type {Set<string>} */
  const remoteHosts = new Set();

  /**
   * @param {string} ruleId
   * @param {string} message
   * @param {Place} place
   * @param {Record<string, unknown>} [properties]
   */
  const report = (ruleId, message, place, properties = {}) => {
    const key = `${ruleId}|${placeName(place)}|${String(properties.value ?? '')}`;
    if (reported.has(key)) return;
    reported.add(key);
    findings.push({
      ruleId,
      message,
      uri,
      ...(place.line ? { region: { startLine: place.line } } : {}),
      logical: { name: placeName(place), kind: 'member' },
      properties: { surfaceId: place.surfaceId, ...(place.componentId ? { componentId: place.componentId } : {}), property: place.property, ...(place.dataPath ? { dataPath: place.dataPath } : {}), ...properties },
    });
  };

  /**
   * One URL value, literal or resolved.
   * @param {unknown} raw
   * @param {UrlUse} use
   * @param {Place} place
   */
  const checkUrlValue = (raw, use, place) => {
    if (typeof raw !== 'string' || raw.trim() === '') return;
    const verdict = checkUrl(raw, OPEN_URL_POLICY);
    if (!verdict.ok) {
      // A fetched URL with another scheme (data:, blob:) makes no network request; only navigation is the catalog's concern.
      if (use === 'openUrl') report('A2UI001', `openUrl in ${placeText(place)} opens "${shown(raw)}": ${verdict.reason}; the basic catalog allows http and https only.`, place, { value: raw });
      return;
    }
    if (verdict.parsed.relative) return;
    const { url } = verdict.parsed;
    const sink = sinkScope(parseDomainPattern(url.host));
    if (sink?.scope === 'shared') {
      report('A2UI002', `${placeText(place)} ${use === 'openUrl' ? 'navigates to' : 'loads'} ${url.host}, which is on the sink denylist (${sink.entry.category}: ${sink.entry.pattern}).`, place, { value: raw, host: url.host });
    }
    if (use === 'fetched') {
      remoteHosts.add(url.host);
      const problem = checkUrlHeuristics(url, DEFAULT_URL_HEURISTICS);
      if (problem) report('A2UI003', `${placeText(place)} is fetched without a click and ${problem.reason.replace(/^URL /, '')}: "${shown(raw)}".`, place, { value: raw, code: problem.code });
    }
  };

  /**
   * @param {unknown} raw
   * @param {Place} place
   */
  const checkTextValue = (raw, place) => {
    if (typeof raw !== 'string') return;
    const kinds = textMarkup(raw);
    if (kinds.length > 0) report('A2UI006', `Text in ${placeText(place)} contains ${kinds.join(', ')}; the basic catalog allows Markdown without HTML, images or links.`, place, { value: raw, kinds });
  };

  /**
   * @param {string} template
   * @param {UrlUse} use
   * @param {Place} place
   */
  const checkTemplate = (template, use, place) => {
    const at = template.search(INTERPOLATION_RE);
    if (at === -1) return;
    const authority = AUTHORITY_RE.exec(template)?.[0] ?? '';
    if (at < authority.length || authority === '') {
      report('A2UI004', `formatString in ${placeText(place)} takes the ${authority === '' ? 'scheme and host' : 'host'} from data: "${shown(template)}". No host allowlist can be checked before render.`, place, { value: template });
    } else if (use === 'fetched') {
      report('A2UI005', `formatString in ${placeText(place)} puts data into a URL fetched without a click: "${shown(template)}". The client must check the resolved URL.`, place, { value: template });
    }
  };

  /**
   * Bindings per surface, resolved against the model after every message.
   * @type {Map<string, { model: unknown, bindings: Array<{ kind: 'path' | 'template', source: string, check: 'url' | 'text', use: UrlUse, place: Place }> }>}
   */
  const surfaces = new Map();
  /** @param {string} id */
  const surface = (id) => {
    let s = surfaces.get(id);
    if (!s) {
      s = { model: {}, bindings: [] };
      surfaces.set(id, s);
    }
    return s;
  };

  /**
   * A property value: a literal is checked now, a binding or template is remembered.
   * @param {unknown} value
   * @param {'url' | 'text'} check
   * @param {UrlUse} use
   * @param {Place} place
   */
  const property = (value, check, use, place) => {
    if (typeof value === 'string') {
      if (check === 'url') checkUrlValue(value, use, place);
      else checkTextValue(value, place);
      return;
    }
    if (!isObject(value)) return;
    const v = /** @type {any} */ (value);
    const bindings = surface(place.surfaceId).bindings;
    if (typeof v.path === 'string' && v.path.startsWith('/')) bindings.push({ kind: 'path', source: v.path, check, use, place });
    else if (v.call === 'formatString' && typeof v.args?.value === 'string') {
      if (check === 'url') checkTemplate(v.args.value, use, place);
      bindings.push({ kind: 'template', source: v.args.value, check, use, place });
    }
  };

  /** @param {string} id */
  const resolveBindings = (id, line = /** @type {number | undefined} */ (undefined)) => {
    const s = surface(id);
    for (const b of s.bindings) {
      const value = b.kind === 'path' ? readPath(s.model, b.source) : interpolate(b.source, s.model);
      if (value === undefined || value === null) continue;
      const place = { ...b.place, dataPath: b.kind === 'path' ? b.source : `formatString "${shown(b.source)}"`, line: line ?? b.place.line };
      if (b.check === 'url') checkUrlValue(value, b.use, place);
      else checkTextValue(value, place);
    }
  };

  for (const { message, line } of entries) {
    if (!isObject(message)) continue;
    const m = /** @type {any} */ (message);
    if (isObject(m.createSurface)) {
      const id = String(m.createSurface.surfaceId ?? '?');
      surface(id);
      if (m.createSurface.theme?.iconUrl !== undefined) checkUrlValue(m.createSurface.theme.iconUrl, 'fetched', { surfaceId: id, property: 'theme.iconUrl', line });
    } else if (isObject(m.updateComponents)) {
      const id = String(m.updateComponents.surfaceId ?? '?');
      for (const c of Array.isArray(m.updateComponents.components) ? m.updateComponents.components : []) {
        if (!isObject(c)) continue;
        const componentId = String(c.id ?? '?');
        const fetched = FETCHED_PROPERTIES[String(c.component)];
        if (fetched) property(c[fetched], 'url', 'fetched', { surfaceId: id, componentId, property: fetched, line });
        if (c.component === 'Text') property(c.text, 'text', 'fetched', { surfaceId: id, componentId, property: 'text', line });
        for (const call of findOpenUrlCalls(c, '', [])) {
          property(call.args?.url, 'url', 'openUrl', { surfaceId: id, componentId, property: `${call.at}.args.url`, line });
        }
      }
      resolveBindings(id);
    } else if (isObject(m.updateDataModel)) {
      const id = String(m.updateDataModel.surfaceId ?? '?');
      const s = surface(id);
      const update = m.updateDataModel;
      s.model = writePath(s.model, typeof update.path === 'string' ? update.path : '/', update.value, !('value' in update));
      resolveBindings(id, line);
    } else if (isObject(m.deleteSurface)) {
      surfaces.delete(String(m.deleteSurface.surfaceId ?? '?'));
    }
  }

  if (remoteHosts.size > 0) {
    const hosts = [...remoteHosts].sort();
    findings.push({ ruleId: 'A2UI007', message: `Surfaces load media from ${hosts.join(', ')}; a client policy must allow these hosts (for example images.hosts in @render-policy/a2ui).`, uri, properties: { hosts } });
  }
  return findings;
}
