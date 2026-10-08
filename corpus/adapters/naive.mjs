// Baseline: Markdown to HTML, straight into innerHTML. What a first implementation looks like.
// On an A2UI surface: resolved values used as they come, Text as Markdown through innerHTML.
import { Marked } from 'marked';
import { createA2uiSurface } from '../lib/a2ui-surface.js';

const marked = new Marked({ gfm: true });

export default {
  name: 'naive (marked + innerHTML)',
  render(container, markdown) {
    container.innerHTML = marked.parse(markdown, { async: false });
  },
  createStream(container) {
    let text = '';
    return {
      push(chunk) {
        text += chunk;
        container.innerHTML = marked.parse(text, { async: false });
      },
      end() {},
    };
  },
  a2ui: {
    createSurface: (container) =>
      createA2uiSurface(container, {
        url: (kind, value) => String(value),
        text: (element, value) => {
          element.innerHTML = marked.parse(String(value ?? ''), { async: false });
        },
        openUrl: (value) => window.open(String(value), '_blank'),
      }),
  },
};
