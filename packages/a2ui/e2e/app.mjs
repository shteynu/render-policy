/**
 * A minimal A2UI v0.9 surface for the browser proof: applies createSurface / updateComponents /
 * updateDataModel, resolves `{ path }` bindings and `formatString`, and renders Image, Video, Text and
 * Button (openUrl) with plain DOM. `?mode=guarded` runs every resolved value through
 * @render-policy/a2ui at the moment it is used; `?mode=naive` uses the values as they come, which is
 * the control showing the proof would see the requests if they were made.
 */
import { createMarkdownRenderer } from '@render-policy/core';
import { createA2uiGuard } from '@render-policy/a2ui';

const guarded = new URLSearchParams(location.search).get('mode') !== 'naive';
window.__decisions = [];
window.__opened = [];
window.open = (url) => {
  window.__opened.push(String(url));
  return null;
};
const guard = createA2uiGuard({ policy: { images: { hosts: ['cdn.example'] } }, onDecision: (d) => window.__decisions.push(d) });
const markdown = createMarkdownRenderer();

const surface = { components: new Map(), data: {}, theme: {} };

const pointer = (path) => (path === '' || path === '/' ? [] : path.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~')));
const read = (path) => pointer(path).reduce((node, key) => (node == null ? undefined : node[key]), surface.data);
const write = (path, value) => {
  const keys = pointer(path);
  if (keys.length === 0) {
    surface.data = value;
    return;
  }
  let node = surface.data;
  for (const key of keys.slice(0, -1)) node = node[key] ??= {};
  node[keys.at(-1)] = value;
};

// Literal, { path }, or formatString with `${/absolute/path}` interpolations.
const resolve = (value) => {
  if (typeof value !== 'object' || value === null) return value;
  if ('path' in value) return read(value.path);
  if (value.call === 'formatString') return String(value.args.value).replace(/\$\{(\/[^}]*)\}/g, (_, path) => String(read(path) ?? ''));
  return undefined;
};

const mediaUrl = (kind, value, id) => {
  if (!guarded) return value;
  const result = guard.url(kind, value, { surfaceId: 'proof', componentId: id });
  return result.allowed ? result.value : null;
};

function render() {
  const root = document.getElementById('surface');
  const nodes = [];
  if (surface.theme.iconUrl !== undefined) {
    const src = mediaUrl('icon', surface.theme.iconUrl, 'theme');
    if (src !== null) nodes.push(Object.assign(document.createElement('img'), { src, id: 'icon' }));
  }
  for (const [id, c] of surface.components) {
    if (c.component === 'Image' || c.component === 'Video') {
      const src = mediaUrl(c.component === 'Image' ? 'image' : 'video', resolve(c.url), id);
      if (src === null) continue;
      const el = document.createElement(c.component === 'Image' ? 'img' : 'video');
      el.id = id;
      el.setAttribute('src', src);
      if (c.component === 'Video') el.preload = 'auto';
      nodes.push(el);
    } else if (c.component === 'Text') {
      const el = document.createElement('div');
      el.id = id;
      if (guarded) guard.renderText(el, resolve(c.text), { surfaceId: 'proof', componentId: id });
      else el.innerHTML = markdown(String(resolve(c.text))); // the naive control, never library code
      nodes.push(el);
    } else if (c.component === 'Button') {
      const el = document.createElement('button');
      el.id = id;
      el.textContent = id;
      el.addEventListener('click', () => {
        const call = c.action?.functionCall;
        if (call?.call !== 'openUrl') return;
        if (guarded) guard.openUrl(resolve(call.args.url), { surfaceId: 'proof', componentId: id });
        else window.open(resolve(call.args.url), '_blank');
      });
      nodes.push(el);
    }
  }
  root.replaceChildren(...nodes);
}

window.__apply = (message) => {
  if (message.createSurface) surface.theme = message.createSurface.theme ?? {};
  if (message.updateComponents) for (const c of message.updateComponents.components) surface.components.set(c.id, c);
  if (message.updateDataModel) write(message.updateDataModel.path ?? '/', message.updateDataModel.value);
  render();
};
window.__ready = true;
