/** @typedef {'error' | 'warning' | 'note'} Level */
/**
 * A rule in SARIF terms: `short` and `full` become its short and full description.
 * @typedef {{ id: string, name: string, level: Level, short: string, full: string }} Rule
 */

/**
 * The rules, in SARIF terms. Ids are stable; names are what a scanner shows.
 * @type {readonly Rule[]}
 */
export const RULES = [
  { id: 'MCPAPP001', name: 'csp-missing', level: 'warning', short: 'UI references external hosts but declares no CSP domain list', full: "A compliant host applies default-src 'none' and connect-src 'none' to a resource without ui.csp, so the hosts the UI loads from or calls are blocked. Reported when the HTML references an external host (src, href and similar attributes) or calls one with an absolute URL (fetch, WebSocket, EventSource, XMLHttpRequest, sendBeacon, import()); a UI that references none needs no CSP. For a package, reported when it serves a UI resource (registers one, or sets the MCP Apps MIME type or a ui:// URI on a resource), no domain list is found, literal or built at runtime, and one of its HTML documents references a host." },
  { id: 'MCPAPP002', name: 'csp-allows-every-host', level: 'error', short: 'CSP entry allows every host', full: "A bare '*' or a scheme-only entry such as 'https:' is expanded by hosts into a CSP source that allows every host, including request catchers and tunnels. Name the hosts." },
  { id: 'MCPAPP003', name: 'csp-wildcard-host', level: 'warning', short: 'CSP entry allows every subdomain', full: 'A *.example.com entry allows every subdomain, including user-controlled ones on multi-tenant services. Prefer exact hosts.' },
  { id: 'MCPAPP004', name: 'csp-insecure-scheme', level: 'warning', short: 'CSP entry uses http:', full: 'An http: origin can be read and modified in transit. Use https:. Loopback origins are reported as development origins (MCPAPP006) instead.' },
  { id: 'MCPAPP005', name: 'csp-sink-host', level: 'error', short: 'CSP entry names a data sink', full: 'The host is on a denylist of services that exist to receive data: request catchers, tunnels, anonymous serverless endpoints, form builders, public object storage. The entry reaches accounts anyone can create (the service host itself, a wildcard over its customers, a path-style storage endpoint), so an app allowed to reach it can carry tool results out to a stranger.' },
  { id: 'MCPAPP006', name: 'csp-development-origin', level: 'note', short: 'CSP entry is a development origin', full: 'localhost, 127.0.0.1 or 0.0.0.0 in published metadata is usually a leftover from development; a tool that serves its interface from a local server needs it on purpose. Local schemes such as blob: and data: reach no network and are not reported.' },
  { id: 'MCPAPP007', name: 'permissions-sensitive', level: 'note', short: 'UI resource requests a sensitive permission', full: 'camera, microphone or geolocation is requested for the sandbox. Hosts should ask the user.' },
  { id: 'MCPAPP008', name: 'tool-side-effects-app-visible', level: 'warning', short: 'Side-effecting tool callable by the app', full: 'A tool without readOnlyHint is visible to the app (visibility includes "app", the default). A compromised or injected app can call it with the user\'s session; hosts should require consent.' },
  { id: 'MCPAPP009', name: 'tool-visibility-implicit', level: 'note', short: 'Tool with UI metadata relies on the default visibility', full: 'visibility defaults to ["model", "app"]. Declare it explicitly so the app-callable surface is a decision, not a default.' },
  { id: 'MCPAPP010', name: 'html-dynamic-innerhtml', level: 'warning', short: 'Inline script assigns dynamic content to an HTML sink', full: "innerHTML, outerHTML, insertAdjacentHTML, setHTMLUnsafe, createContextualFragment or document.write receives a non-static value. With the default script-src 'unsafe-inline', an injected tool result becomes script inside the sandbox. Render through a policy or use textContent. A value whose every dynamic part goes through an escaping helper (esc, escapeHtml, escapeHTML, htmlEscape, escapeAttr, escapeHtmlAttr, DOMPurify.sanitize) is not reported; the scanner trusts the name, and HTML escaping does not make a URL attribute safe." },
  { id: 'MCPAPP011', name: 'html-postmessage-wildcard', level: 'warning', short: "Inline script posts a message to '*'", full: "postMessage(…, '*') delivers the message to whatever embeds the document. The app protocol does this by design: calls to parent or top carrying MCP Apps JSON-RPC (jsonrpc, a ui/ method) or an mcp-ui message type are not reported. Other hand-written calls may leak data to a different embedder." },
  { id: 'MCPAPP012', name: 'html-inline-handlers', level: 'note', short: 'Inline event handlers in the document', full: 'on* attributes are script; they are also what an injection uses. Attach handlers from a script instead.' },
  { id: 'MCPAPP013', name: 'html-eval', level: 'warning', short: 'Inline script uses eval or new Function', full: 'String evaluation turns any injected value into script.' },
  { id: 'MCPAPP014', name: 'html-form-action', level: 'note', short: 'Form posts to a URL', full: "The specification's CSP has no form-action directive; a form is a way out of the sandbox for data. Check the destination." },
  { id: 'MCPAPP015', name: 'html-external-host', level: 'note', short: 'Document references external hosts', full: 'Scripts, styles, images or media are loaded from hosts outside the document. They must be declared in resourceDomains or the host blocks them.' },
  { id: 'MCPAPP016', name: 'html-sink-host', level: 'error', short: 'Document references a data sink', full: 'A URL in the document points at a service on the sink denylist.' },
  { id: 'MCPAPP017', name: 'meta-list-read-mismatch', level: 'warning', short: 'resources/read declares a different policy than resources/list', full: 'Hosts must prefer the read-time policy. A wider policy at read time means the policy reviewed at connection time is not the one enforced.' },
  { id: 'MCPAPP018', name: 'meta-read-wider-than-list', level: 'error', short: 'resources/read widens the policy seen at resources/list', full: 'The read-time policy adds domains or wildcards the listing did not declare. This is the pattern a host that reviews at connection time cannot see.' },
  { id: 'MCPAPP019', name: 'csp-sink-tenant-host', level: 'note', short: 'CSP entry names one account on a multi-tenant service', full: 'The host is a single bucket, worker or app on a storage or serverless service from the sink denylist (acct.blob.core.windows.net, pub-<id>.r2.dev). It reaches only that account, which is fine while the owner keeps it; a deleted bucket or app name can be registered by someone else.' },
];

export const RULE_INDEX = new Map(RULES.map((rule, index) => [rule.id, index]));
/** @param {string} name */
export const ruleByName = (name) => RULES.find((r) => r.name === name);
