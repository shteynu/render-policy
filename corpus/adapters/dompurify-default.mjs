// The common answer: sanitize with DOMPurify's default configuration, then innerHTML.
import DOMPurify from 'dompurify';
import { Marked } from 'marked';

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
};
