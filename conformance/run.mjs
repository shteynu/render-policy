/**
 * Conformance run for MCP Apps hosts, in a real Chromium. It checks the host-side security
 * requirements the specification states a host MUST enforce, by serving a UI view under the
 * CSP the reference host builds (conformance/host.mjs) and asserting the browser's own CSP
 * enforcement blocks what the policy forbids and allows what it declares.
 *
 * This is a conformance test, not an attack: each probe is the minimal operation that a
 * directive governs, and the assertion is that a compliant host's policy stops it. A host
 * that fails a check is not enforcing the policy render-policy's census measured and
 * mcp-app-lint flags.
 *
 *   node conformance/run.mjs
 */
import path from 'node:path';
import { createChecker, launchBrowser, repoRoot, startServer } from '../e2e/lib/harness.mjs';
import { buildCsp, RESTRICTIVE_DEFAULT } from './host.mjs';

const VIEW = '/conformance/probes/view.html';

// The host serves the view from a sandbox origin; the runner (the "host page" side) is a
// different origin. Two servers on two ports stand in for the spec's requirement that the
// host and the sandbox have different origins.
const sandbox = await startServer({ root: repoRoot, cspFor: (url) => (url.pathname === VIEW ? currentCsp : undefined) });
const hostOrigin = await startServer({ root: repoRoot });
let currentCsp;

const browser = await launchBrowser();
const { check, finish } = createChecker('MCP Apps host conformance (Chromium)');

/** Load the view under `csp`, fulfilling every request the CSP lets reach the network with 200. */
async function runProbe(csp) {
  currentCsp = csp;
  const page = await browser.newPage();
  await page.route('**/*', (route) => {
    const url = route.request().url();
    if (url.endsWith(VIEW)) return route.continue();
    // Anything else is a probe target: if the request reached us, the CSP allowed it.
    return route.fulfill({ status: 200, contentType: 'text/plain', body: 'ok' });
  });
  await page.goto(`${sandbox.base}${VIEW}`);
  await page.waitForFunction(() => window.__ready === true);
  const result = await page.evaluate(() => ({ violations: window.__violations, fetch: window.__fetch }));
  await page.close();
  return result;
}

const blocked = (result, directive) => result.violations.some((v) => v.directive === directive);

try {
  // Origin separation: the spec requires the host and the sandbox to have different origins.
  check(new URL(sandbox.base).origin !== new URL(hostOrigin.base).origin, 'sandbox and host are served from different origins', `${sandbox.base} vs ${hostOrigin.base}`);

  {
    // A resource that declares a connect host and a resource host, and nothing else.
    const csp = buildCsp({ ui: { csp: { connectDomains: ['https://declared.test'], resourceDomains: ['https://resource.test'] } } });
    const result = await runProbe(csp);
    const declaredBlocked = result.violations.some((v) => v.directive === 'connect-src' && v.blocked.includes('//declared.test'));
    check(result.fetch['connect-declared'] === 200 && !declaredBlocked, 'declared connect host is allowed', JSON.stringify(result.fetch));
    check(result.fetch['connect-undeclared'] === 'error' && result.violations.some((v) => v.directive === 'connect-src' && v.blocked.includes('//undeclared.test')), 'undeclared connect host is blocked', JSON.stringify(result.violations));
    check(!result.violations.some((v) => v.directive === 'img-src'), 'declared resource host is allowed for images', JSON.stringify(result.violations));
    check(blocked(result, 'frame-src'), "nested frame is blocked when no frameDomains are declared (frame-src 'none')");
    check(result.violations.some((v) => v.directive === 'object-src'), "object element is blocked (object-src 'none')");
  }

  {
    // A resource that declares nothing: the host MUST apply the restrictive default.
    const result = await runProbe(RESTRICTIVE_DEFAULT);
    check(currentCsp === RESTRICTIVE_DEFAULT && buildCsp({}) === RESTRICTIVE_DEFAULT, 'a resource with no ui.csp gets the restrictive default');
    check(result.fetch['connect-declared'] === 'error' && result.fetch['connect-undeclared'] === 'error', "restrictive default blocks all network (connect-src 'none')", JSON.stringify(result.fetch));
    check(blocked(result, 'connect-src'), 'restrictive default reports the blocked connection');
    check(blocked(result, 'frame-src'), 'restrictive default blocks nested frames');
  }

  {
    // A resource that declares a frame host: the nested frame to a different host is still blocked.
    const csp = buildCsp({ ui: { csp: { frameDomains: ['https://allowed-frame.test'] } } });
    const result = await runProbe(csp);
    check(result.violations.some((v) => v.directive === 'frame-src' && v.blocked.includes('frame.test')), 'a frame host outside frameDomains is still blocked', JSON.stringify(result.violations));
  }
} finally {
  await browser.close();
  sandbox.close();
  hostOrigin.close();
}

process.exit(finish());
