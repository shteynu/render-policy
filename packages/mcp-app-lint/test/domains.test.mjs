import assert from 'node:assert/strict';
import { test } from 'node:test';
import { categorizeDomain, categorizeHost, classifyDomains, DOMAIN_CATEGORIES, parseDomainPattern, sinkFor, sinkScope } from '../src/index.mjs';

test('scheme-only entries: network schemes allow every host, local schemes do not', () => {
  const https = parseDomainPattern('https:');
  assert.deepEqual([https.scheme, https.host, https.schemeOnly, https.full, https.insecureScheme], ['https', '', true, true, false]);
  const http = parseDomainPattern('http:');
  assert.deepEqual([http.full, http.insecureScheme], [true, true]);
  const blob = parseDomainPattern('blob:');
  assert.deepEqual([blob.scheme, blob.full, blob.localScheme, blob.development], ['blob', false, true, false]);
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
    'blob:': 'local-scheme',
    'data:': 'local-scheme',
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

test('denylist entries with a * match like core: one host label', () => {
  assert.equal(sinkFor('s3.eu-west-1.amazonaws.com')?.pattern, 's3.*.amazonaws.com');
  assert.equal(sinkFor('s3-us-west-2.amazonaws.com')?.pattern, 's3-*.amazonaws.com');
  assert.equal(sinkFor('s3.dualstack.us-east-1.amazonaws.com')?.pattern, 's3.dualstack.*.amazonaws.com');
  assert.equal(sinkFor('abc123.lambda-url.us-east-1.on.aws')?.pattern, 'lambda-url.*.on.aws');
  assert.equal(sinkFor('ec2.eu-west-1.amazonaws.com'), null);
  assert.equal(sinkFor('s3.evil.example.com'), null);
});

test('sink scope: a host anyone can use is shared, one account on a storage or serverless service is a tenant', () => {
  const scope = (raw) => sinkScope(raw)?.scope ?? null;
  const cases = {
    // The service host serves every customer's bucket by path.
    'https://storage.googleapis.com': 'shared',
    'https://s3.amazonaws.com': 'shared',
    's3.eu-west-1.amazonaws.com': 'shared',
    'nyc3.digitaloceanspaces.com': 'shared',
    'f004.backblazeb2.com': 'shared',
    's3.us-west-004.backblazeb2.com': 'shared',
    's3.wasabisys.com': 'shared',
    // A wildcard over the customers.
    '*.blob.core.windows.net': 'shared',
    '*.s3.amazonaws.com': 'shared',
    '*.workers.dev': 'shared',
    'https://pub-*.r2.dev': 'shared',
    // Categories where every name is a sink.
    '*.ngrok-free.dev': 'shared',
    'abc.ngrok-free.app': 'shared',
    'abc.webhook.site': 'shared',
    'acme.typeform.com': 'shared',
    'store1.gofile.io': 'shared',
    // One account.
    'acct.blob.core.windows.net': 'tenant',
    '*.acct.blob.core.windows.net': 'tenant',
    'bucket.storage.googleapis.com': 'tenant',
    'bucket.s3.amazonaws.com': 'tenant',
    'bucket.s3.eu-west-1.amazonaws.com': 'tenant',
    'https://pub-0123456789abcdef.r2.dev': 'tenant',
    'photos.sfo3.cdn.digitaloceanspaces.com': 'tenant',
    'app.team.workers.dev': 'tenant',
    'myapp.replit.app': 'tenant',
    'abc123.lambda-url.us-east-1.on.aws': 'tenant',
    'https://api.example.com': null,
    // A wildcard above a sink service covers it.
    '*.amazonaws.com': 'shared',
    '*.googleapis.com': 'shared',
    '*.core.windows.net': 'shared',
    '*.mapbox.com': null,
  };
  for (const [raw, expected] of Object.entries(cases)) assert.equal(scope(raw), expected, raw);
  assert.equal(categorizeDomain('acct.blob.core.windows.net'), 'storage');
  assert.equal(categorizeDomain('*.blob.core.windows.net'), 'sink');
  const c = classifyDomains(['storage.googleapis.com', 'bucket.storage.googleapis.com', 'pub-0123.r2.dev', 'https://unpkg.com']);
  assert.deepEqual([c.sinks, c.tenantSinks], [['blob-storage'], ['blob-storage', 'blob-storage']]);
});
