/**
 * DOM-side invariants of an evil-Markdown case. Runs inside the browser page
 * after the adapter rendered the input into `container`. Returns a list of
 * failure messages; an empty list means the case passed its DOM invariants.
 * Network invariants (noRequestTo, stream requests) are checked by run.mjs
 * from outside the page.
 */
const URL_ATTRIBUTES = ['href', 'src', 'xlink:href', 'action', 'formaction', 'poster', 'data', 'srcset', 'ping', 'background', 'cite'];

function normalizeUrl(raw) {
  return raw.replace(/[\t\n\r]/g, '').replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');
}

function schemeOf(raw) {
  const match = /^([a-z][a-z0-9+.-]*):/i.exec(normalizeUrl(raw));
  return match ? match[1].toLowerCase() : null;
}

export function evaluate(container, expect, executed) {
  const failures = [];
  const elements = Array.from(container.querySelectorAll('*'));

  if (expect.noExecution && executed) failures.push('payload executed');

  for (const selector of expect.noElements ?? []) {
    if (container.querySelector(selector)) failures.push(`element present: ${selector}`);
  }
  for (const selector of expect.mustHave ?? []) {
    if (!container.querySelector(selector)) failures.push(`element missing: ${selector}`);
  }
  const text = container.textContent ?? '';
  for (const needle of expect.mustContainText ?? []) {
    if (!text.includes(needle)) failures.push(`text missing: ${JSON.stringify(needle)}`);
  }
  for (const needle of expect.mustNotContainText ?? []) {
    if (text.includes(needle)) failures.push(`text present: ${JSON.stringify(needle)}`);
  }

  const forbiddenAttributes = (expect.noAttributes ?? []).map((pattern) => new RegExp(pattern, 'i'));
  const forbiddenSchemes = new Set((expect.noUrlScheme ?? []).map((s) => s.toLowerCase()));
  const forbiddenClasses = new Set(expect.noClassNames ?? []);
  const forbiddenIds = new Set(expect.noIds ?? []);
  const forbiddenNames = new Set(expect.noNames ?? []);

  for (const element of elements) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      if (forbiddenAttributes.some((re) => re.test(name))) {
        failures.push(`attribute present: <${element.tagName.toLowerCase()} ${name}>`);
      }
      if (forbiddenSchemes.size > 0 && URL_ATTRIBUTES.includes(name)) {
        const candidates = name === 'srcset' ? attribute.value.split(',').map((c) => c.trim().split(/\s+/)[0] ?? '') : [attribute.value];
        for (const candidate of candidates) {
          const scheme = schemeOf(candidate);
          if (scheme && forbiddenSchemes.has(scheme)) failures.push(`url scheme ${scheme}: in <${element.tagName.toLowerCase()} ${name}>`);
        }
      }
      if (name === 'class' && forbiddenClasses.size > 0) {
        for (const token of attribute.value.split(/\s+/)) if (forbiddenClasses.has(token)) failures.push(`class present: ${token}`);
      }
      if (name === 'id' && forbiddenIds.has(attribute.value)) failures.push(`id present: ${attribute.value}`);
      if (name === 'name' && forbiddenNames.has(attribute.value)) failures.push(`name present: ${attribute.value}`);
    }
  }

  if (expect.relNoopenerOnTargetBlank) {
    for (const link of container.querySelectorAll('a[target="_blank"]')) {
      const rel = (link.getAttribute('rel') ?? '').split(/\s+/);
      if (!rel.includes('noopener')) failures.push('target="_blank" without rel="noopener"');
    }
  }

  return failures;
}
