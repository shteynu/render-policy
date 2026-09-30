import { createRenderer } from '@render-policy/core';
import { createMermaidTransform } from '@render-policy/mermaid';
import mermaid from 'mermaid';

window.__pwned = {};
window.p = (id) => {
  window.__pwned[id] = true;
};
window.__decisions = [];
const journal = (decision) => window.__decisions.push(decision);
window.__renderer = createRenderer({
  mode: 'balanced',
  transforms: [createMermaidTransform({ mermaid, onDecision: journal })],
  onDecision: journal,
});
window.__ready = true;
