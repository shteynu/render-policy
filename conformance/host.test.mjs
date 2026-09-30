import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildAllowAttribute, buildCsp, RESTRICTIVE_DEFAULT, toolNeedsConsent } from './host.mjs';

const directive = (csp, name) => csp.split('; ').find((d) => d.startsWith(`${name} `) || d === name);

test('no ui.csp gets the restrictive default, verbatim', () => {
  assert.equal(buildCsp(undefined), RESTRICTIVE_DEFAULT);
  assert.equal(buildCsp({}), RESTRICTIVE_DEFAULT);
  assert.equal(buildCsp({ ui: {} }), RESTRICTIVE_DEFAULT);
  assert.equal(directive(RESTRICTIVE_DEFAULT, 'connect-src'), "connect-src 'none'");
  assert.equal(directive(RESTRICTIVE_DEFAULT, 'default-src'), "default-src 'none'");
});

test('declared domains widen the directives the spec assigns them', () => {
  const csp = buildCsp({ ui: { csp: { connectDomains: ['https://api.example'], resourceDomains: ['https://cdn.example'] } } });
  assert.equal(directive(csp, 'connect-src'), "connect-src 'self' https://api.example");
  assert.equal(directive(csp, 'script-src'), "script-src 'self' 'unsafe-inline' https://cdn.example");
  assert.equal(directive(csp, 'img-src'), "img-src 'self' data: https://cdn.example");
  assert.equal(directive(csp, 'font-src'), "font-src 'self' https://cdn.example");
  // A connect host does not leak into resource directives and vice versa.
  assert.ok(!directive(csp, 'img-src').includes('api.example'));
  assert.ok(!directive(csp, 'connect-src').includes('cdn.example'));
});

test('frame-src and base-uri are locked down unless declared', () => {
  const bare = buildCsp({ ui: { csp: { connectDomains: ['https://api.example'] } } });
  assert.equal(directive(bare, 'frame-src'), "frame-src 'none'");
  assert.equal(directive(bare, 'base-uri'), "base-uri 'self'");
  assert.equal(directive(bare, 'object-src'), "object-src 'none'");
  const declared = buildCsp({ ui: { csp: { frameDomains: ['https://frame.example'], baseUriDomains: ['https://base.example'] } } });
  assert.equal(directive(declared, 'frame-src'), 'frame-src https://frame.example');
  assert.equal(directive(declared, 'base-uri'), 'base-uri https://base.example');
  assert.equal(directive(declared, 'object-src'), "object-src 'none'"); // never widened
});

test('default-src none holds for every resource; object-src none is explicit once a policy is built', () => {
  for (const meta of [undefined, {}, { ui: { csp: { connectDomains: ['https://a.example'], resourceDomains: ['https://b.example'], frameDomains: ['https://c.example'] } } }]) {
    assert.equal(directive(buildCsp(meta), 'default-src'), "default-src 'none'", JSON.stringify(meta));
  }
  // The restrictive default lists six directives and relies on default-src 'none' to cover objects;
  // once any domain list is declared, object-src 'none' is written out explicitly.
  assert.equal(directive(RESTRICTIVE_DEFAULT, 'object-src'), undefined);
  assert.equal(directive(buildCsp({ ui: { csp: { connectDomains: ['https://a.example'] } } }), 'object-src'), "object-src 'none'");
});

test('empty or non-string domain entries are dropped, not emitted', () => {
  const csp = buildCsp({ ui: { csp: { connectDomains: ['', 'https://ok.example', null, 42] } } });
  assert.equal(directive(csp, 'connect-src'), "connect-src 'self' https://ok.example");
});

test('allow attribute lists only the sensitive features declared', () => {
  assert.equal(buildAllowAttribute(undefined), '');
  assert.equal(buildAllowAttribute({ clipboardWrite: {} }), '');
  assert.equal(buildAllowAttribute({ camera: {}, geolocation: {} }), 'camera; geolocation');
  assert.equal(buildAllowAttribute({ microphone: {} }), 'microphone');
});

test('a side-effecting app-callable tool needs consent; a read-only or model-only one does not', () => {
  assert.equal(toolNeedsConsent({ name: 'delete', _meta: { ui: { resourceUri: 'ui://a' } } }), true); // default visibility includes app
  assert.equal(toolNeedsConsent({ name: 'read', _meta: { ui: { resourceUri: 'ui://a' } }, annotations: { readOnlyHint: true } }), false);
  assert.equal(toolNeedsConsent({ name: 'delete', _meta: { ui: { resourceUri: 'ui://a', visibility: ['model'] } } }), false);
  assert.equal(toolNeedsConsent({ name: 'delete', _meta: { ui: { resourceUri: 'ui://a', visibility: ['model', 'app'] } } }), true);
  assert.equal(toolNeedsConsent({ name: 'plain' }), true); // no annotations: app-callable by default, no readOnlyHint
});
