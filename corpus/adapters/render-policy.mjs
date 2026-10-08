// @render-policy/core in its default (balanced) mode: no configuration.
// On an A2UI surface: @render-policy/a2ui's guard with the same defaults.
import { createRenderer } from '@render-policy/core';
import { createA2uiGuard } from '@render-policy/a2ui';
import { createA2uiSurface } from '../lib/a2ui-surface.js';

const renderer = createRenderer();

export default {
  name: '@render-policy/core (balanced, defaults)',
  render(container, markdown) {
    renderer.renderMarkdownInto(container, markdown);
  },
  createStream(container) {
    return renderer.createStream(container);
  },
  a2ui: {
    name: '@render-policy/a2ui (balanced, defaults)',
    createSurface(container) {
      const guard = createA2uiGuard();
      return createA2uiSurface(container, {
        url(kind, value, componentId) {
          const result = guard.url(kind, value, { componentId });
          return result.allowed ? result.value : null;
        },
        text: (element, value, componentId) => guard.renderText(element, value, { componentId }),
        openUrl: (value, componentId) => guard.openUrl(value, { componentId }),
      });
    },
  },
};
