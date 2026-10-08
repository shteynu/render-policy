// The common answer: sanitize with DOMPurify's default configuration, then innerHTML.
// On an A2UI surface: Text sanitized the same way, resolved URLs used as they come.
import DOMPurify from 'dompurify';
import { Marked } from 'marked';
import { createA2uiSurface } from '../lib/a2ui-surface.js';

const marked = new Marked({ gfm: true });
const render = (container, markdown) => {
  container.innerHTML = DOMPurify.sanitize(marked.parse(markdown, { async: false }));
};

export default {
  name: 'DOMPurify defaults + innerHTML',
  render,
  createStream(container) {
    let text = '';
    return {
      push(chunk) {
        text += chunk;
        render(container, text);
      },
      end() {},
    };
  },
  a2ui: {
    createSurface: (container) =>
      createA2uiSurface(container, {
        url: (kind, value) => String(value),
        text: (element, value) => render(element, String(value ?? '')),
        openUrl: (value) => window.open(String(value), '_blank', 'noopener,noreferrer'),
      }),
  },
};
