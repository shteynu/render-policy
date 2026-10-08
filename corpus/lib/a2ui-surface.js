/**
 * A minimal A2UI v0.9 surface for the reference adapters: applies createSurface, updateComponents,
 * updateDataModel and deleteSurface, resolves `{ "path": "/abs" }` bindings and `formatString` with
 * `${/abs}` interpolations at render time, and renders the basic catalog's URL and text places
 * (Image, Video, AudioPlayer, theme.iconUrl, Text, Button with openUrl) flat, in component order.
 *
 * What a renderer does with a resolved value is the adapter's choice, through three hooks:
 *
 *   url(kind, value, componentId) -> string | null   kind: image | video | audio | icon; null drops the element
 *   text(element, value, componentId)                renders Text.text into the element
 *   openUrl(value, componentId)                      the Button's openUrl action
 */
const pointer = (path) =>
  path === undefined || path === '' || path === '/' ? [] : String(path).split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'));

export function createA2uiSurface(container, hooks) {
  let components = new Map();
  let data = {};
  let theme = {};

  const read = (path) => pointer(path).reduce((node, key) => (node == null ? undefined : node[key]), data);
  const write = (path, value, remove) => {
    const keys = pointer(path);
    if (keys.length === 0) {
      data = remove ? {} : value;
      return;
    }
    let node = data;
    for (const key of keys.slice(0, -1)) {
      if (typeof node[key] !== 'object' || node[key] === null) node[key] = {};
      node = node[key];
    }
    if (remove) delete node[keys.at(-1)];
    else node[keys.at(-1)] = value;
  };
  const resolve = (value) => {
    if (typeof value !== 'object' || value === null) return value;
    if (typeof value.path === 'string') return read(value.path);
    if (value.call === 'formatString') {
      return String(value.args?.value ?? '').replace(/\$\{(\/[^}]*)\}/g, (_, path) => {
        const v = read(path);
        return v === undefined || v === null ? '' : String(v);
      });
    }
    return undefined;
  };

  const media = (tag, kind, value, id) => {
    const src = hooks.url(kind, resolve(value), id);
    if (src === null || src === undefined) return null;
    const element = document.createElement(tag);
    element.setAttribute('src', src);
    if (tag !== 'img') element.preload = 'auto';
    element.dataset.a2uiId = id;
    return element;
  };

  const buttons = new Map();
  const render = () => {
    const nodes = [];
    buttons.clear();
    if (theme.iconUrl !== undefined) {
      const icon = media('img', 'icon', theme.iconUrl, 'theme.iconUrl');
      if (icon) nodes.push(icon);
    }
    for (const [id, c] of components) {
      if (c.component === 'Image') nodes.push(media('img', 'image', c.url, id));
      else if (c.component === 'Video') nodes.push(media('video', 'video', c.url, id));
      else if (c.component === 'AudioPlayer') nodes.push(media('audio', 'audio', c.url, id));
      else if (c.component === 'Text') {
        const element = document.createElement('div');
        element.dataset.a2uiId = id;
        hooks.text(element, resolve(c.text), id);
        nodes.push(element);
      } else if (c.component === 'Button') {
        const element = document.createElement('button');
        element.type = 'button';
        element.dataset.a2uiId = id;
        element.textContent = id;
        element.addEventListener('click', () => {
          const call = c.action?.functionCall;
          if (call?.call === 'openUrl') hooks.openUrl(resolve(call.args?.url), id);
        });
        buttons.set(id, element);
        nodes.push(element);
      }
    }
    container.replaceChildren(...nodes.filter(Boolean));
  };

  return {
    apply(message) {
      if (message.createSurface) {
        components = new Map();
        data = {};
        theme = message.createSurface.theme ?? {};
      }
      if (message.updateComponents) for (const c of message.updateComponents.components ?? []) components.set(c.id, c);
      if (message.updateDataModel) {
        const update = message.updateDataModel;
        write(update.path, update.value, !('value' in update));
      }
      if (message.deleteSurface) {
        components = new Map();
        data = {};
        theme = {};
      }
      render();
    },
    activate(id) {
      buttons.get(id)?.click();
    },
  };
}
