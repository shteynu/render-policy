import { createRenderer } from '@render-policy/core';
import { Marked } from 'marked';
import { VECTORS } from './vectors.js';

const params = new URLSearchParams(location.search);
const mode = params.get('mode') ?? 'both';
const policyMode = params.get('policy') ?? 'balanced';
const text = VECTORS.join('\n\n');

window.__pwned = {};
window.__cspViolations = [];
document.addEventListener('securitypolicyviolation', (event) => {
  window.__cspViolations.push(`${event.violatedDirective}: ${event.sample || event.blockedURI}`);
});

const log = (id, message) => {
  document.getElementById(`${id}-log`).textContent = message;
};

if (mode !== 'policy') {
  try {
    document.getElementById('naive').innerHTML = new Marked().parse(text);
    log('naive', 'rendered with innerHTML: the payload markers below are live');
  } catch (error) {
    log('naive', `innerHTML rejected: ${error.message}`);
  }
}

if (mode !== 'naive') {
  const decisions = [];
  const renderer = createRenderer({ mode: policyMode, onDecision: (decision) => decisions.push(decision) });
  renderer.renderMarkdownInto(document.getElementById('policy'), text);
  log('policy', decisions.map((d) => `${d.kind} ${d.subject}${d.tag ? ` <${d.tag}>` : ''}: ${d.reason}`).join('\n'));
  window.__renderer = renderer;
  window.__decisions = decisions;
}

window.__demoReady = true;
