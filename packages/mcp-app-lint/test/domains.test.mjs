import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categorizeDomain, categorizeHost, classifyDomains, DOMAIN_CATEGORIES, parseDomainPattern } from '../src/index.mjs';

test('scheme-only entries: network schemes allow every host, local schemes do not', () => {
  const https = parseDomainPattern('https:');
  assert.deepEqual([https.scheme, https.host, https.schemeOnly, https.full, https.insecureScheme], ['https', '', true, true, false]);
  const http = parseDomainPattern('http:');
  assert.deepEqual([http.full, http.insecureScheme], [true, true]);
  const blob = parseDomainPattern('blob:');
  assert.deepEqual([blob.scheme, blob.full, blob.localScheme, blob.development], ['blob', false, true, true]);
  assert.equal(parseDomainPattern('data:').full, false);
  assert.equal(parseDomainPattern('wss:').full, true);
});

test('hosts, ports, wildcards and IPv6', () => {
  assert.equal(parseDomainPattern('https://api.example.com:8443/path').host, 'api.example.com');
  assert.equal(parseDomainPattern('http://127.0.0.1:*').host, '127.0.0.1');
  assert.equal(parseDomainPattern('http://[::1]:8080').host, '[::1]');
  assert.equal(parseDomainPattern('http://[::1]:8080').development, true);
  assert.equal(parseDomainPattern('app.localhost').development, true);
  assert.equal(parseDomainPattern('https://*').full, true);
  assert.equal(parseDomainPattern('*.example.com').bareHost, 'example.com');
  assert.equal(parseDomainPattern('').full, false);
  assert.equal(parseDomainPattern('ws://push.example.com').insecureScheme, true);
});

test('categories are heuristic but stable', () => {
  const cases = {
    '*': 'every-host',
    'https:': 'every-host',
    'http://localhost:*': 'development',
    'blob:': 'development',
    'https://webhook.site': 'sink',
    'https://fonts.googleapis.com': 'fonts',
    'https://fonts.gstatic.com': 'fonts',
    'https://www.google-analytics.com': 'analytics',
    'https://events.mapbox.com': 'analytics',
    'https://api.mapbox.com': 'maps',
    'https://*.tile.openstreetmap.org': 'maps',
    'https://maps.googleapis.com': 'maps',
    'https://storage.googleapis.com': 'sink', // public object storage is on the denylist; sink wins
    'https://bucket.s3.eu-west-1.amazonaws.com': 'storage',
    'https://files.example.com': 'storage',
    'https://lh3.googleusercontent.com': 'media',
    'https://avatars.githubusercontent.com': 'media',
    'https://images-assets.example.gov': 'media',
    'https://unpkg.com': 'cdn',
    'https://cdn.jsdelivr.net': 'cdn',
    'https://raw.githubusercontent.com': 'cdn',
    'https://someone.github.io': 'cdn',
    'https://cdn.shop.example': 'cdn',
    'https://api.example.com': 'api',
    'https://data.api.example.org': 'api',
    'https://sheets.googleapis.com': 'api',
    'https://www.example.com': 'other',
    'https://example.com': 'other',
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(categorizeDomain(raw), expected, raw);
  for (const value of Object.values(cases)) assert.ok(DOMAIN_CATEGORIES.includes(value));
  assert.equal(categorizeHost('cdnjs.cloudflare.com'), 'cdn');
  assert.equal(categorizeHost('localhost'), 'development');
  const c = classifyDomains(['https:', 'https://unpkg.com', 'https://hooks.zapier.com']);
  assert.deepEqual([c.fullWildcards, c.sinks, c.categories], [1, ['webhook'], ['every-host', 'cdn', 'sink']]);
});
