// Baseline: Markdown to HTML, straight into innerHTML. What a first implementation looks like.
import { Marked } from 'marked';

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
};
