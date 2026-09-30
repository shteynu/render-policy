// @render-policy/core in its default (balanced) mode: no configuration.
import { createRenderer } from '@render-policy/core';

const renderer = createRenderer();

export default {
  name: '@render-policy/core (balanced, defaults)',
  render(container, markdown) {
    renderer.renderMarkdownInto(container, markdown);
  },
  createStream(container) {
    return renderer.createStream(container);
  },
};
