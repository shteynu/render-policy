import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { levelOf, lintA2uiMessages, parseA2uiMessages, run, toSarif } from '../src/index.mjs';

const v = 'v0.9';
const surface = (id = 's') => ({ version: v, createSurface: { surfaceId: id, catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json' } });
const components = (list, id = 's') => ({ version: v, updateComponents: { surfaceId: id, components: list } });
const data = (path, value, id = 's') => ({ version: v, updateDataModel: { surfaceId: id, path, value } });
const ids = (findings) => findings.map((f) => f.ruleId).sort();
const button = (id, url) => ({ id, component: 'Button', child: 'label', action: { functionCall: { call: 'openUrl', args: { url }, returnType: 'void' } } });

test('parse: one message, an array, the list wrapper, JSONL with lines', () => {
  const one = surface();
  assert.deepEqual(parseA2uiMessages(JSON.stringify(one)), [{ message: one }]);
  assert.equal(parseA2uiMessages(JSON.stringify([one, one])).length, 2);
  assert.equal(parseA2uiMessages(JSON.stringify({ messages: [one] })).length, 1);
  const jsonl = parseA2uiMessages(`${JSON.stringify(one)}\n\n${JSON.stringify(data('/', {}))}\n`);
  assert.deepEqual(jsonl.map((e) => e.line), [1, 3]);
  assert.throws(() => parseA2uiMessages(`${JSON.stringify(one)}\n{nope\n`), /line 2/);
});

test('A2UI001: openUrl outside http and https, literal or bound', () => {
  const findings = lintA2uiMessages(
    [surface(), components([button('a', 'javascript:alert(1)'), button('b', 'java\tscript:x'), button('c', 'mailto:a@example.com'), button('ok', 'https://docs.example.com'), button('rel', '/help'), button('bound', { path: '/target' })]), data('/target', 'data:text/html,<script>x</script>')],
    'm.json',
  );
  assert.deepEqual(findings.map((f) => `${f.ruleId}:${f.properties.componentId}`).sort(), ['A2UI001:a', 'A2UI001:b', 'A2UI001:bound', 'A2UI001:c']);
  const bound = findings.find((f) => f.properties.componentId === 'bound');
  assert.equal(bound.properties.dataPath, '/target');
  assert.equal(bound.logical.name, 's/bound.action.functionCall.args.url <- /target');
  assert.equal(levelOf('A2UI001'), 'error');
});

test('A2UI002: sink hosts in media, the theme icon and openUrl; a value swapped after the first render', () => {
  const messages = [
    { version: v, createSurface: { surfaceId: 's', catalogId: 'c', theme: { iconUrl: 'https://abc.ngrok.io/i.png' } } },
    components([{ id: 'hero', component: 'Image', url: { path: '/hero' } }, { id: 'v', component: 'Video', url: 'https://webhook.site/x.mp4' }, button('go', 'https://pipedream.net/x')]),
    data('/', { hero: 'https://cdn.example.com/a.png' }),
    data('/hero', 'https://storage.googleapis.com/x.png'),
  ];
  const entries = messages.map((message, i) => ({ message, line: i + 1 }));
  const findings = lintA2uiMessages(entries, 'stream.jsonl').filter((f) => f.ruleId === 'A2UI002');
  assert.deepEqual(findings.map((f) => f.logical.name).sort(), ['s/go.action.functionCall.args.url', 's/hero.url <- /hero', 's/theme.theme.iconUrl', 's/v.url']);
  // The swapped value is reported at the line of the update that brought it.
  assert.equal(findings.find((f) => f.properties.componentId === 'hero').region.startLine, 4);
  // One account on a storage service is not a shared sink.
  assert.deepEqual(ids(lintA2uiMessages([surface(), components([{ id: 'i', component: 'Image', url: 'https://acct.blob.core.windows.net/a.png' }])], 'm')), ['A2UI007']);
});

test('A2UI003 and A2UI005: data assembled into a media URL, resolved from the stream', () => {
  const token = 'c2Vzc2lvbi10b2tlbi1mcm9tLXRoZS1jb252ZXJzYXRpb24'.repeat(2);
  const findings = lintA2uiMessages(
    [surface(), components([{ id: 'avatar', component: 'Image', url: { call: 'formatString', args: { value: 'https://cdn.example.com/${/user/token}.png' }, returnType: 'string' } }]), data('/user', { token })],
    'm',
  );
  assert.deepEqual(ids(findings), ['A2UI003', 'A2UI005', 'A2UI007']);
  assert.match(findings.find((f) => f.ruleId === 'A2UI003').message, /encoded payload/);
  // A literal with a payload, and a short query that is not one.
  const literal = lintA2uiMessages([surface(), components([{ id: 'a', component: 'Image', url: `https://cdn.example.com/p.png?d=${token}` }, { id: 'b', component: 'Image', url: 'https://images.example.com/p.jpg?w=400&h=200&fit=crop' }])], 'm');
  assert.deepEqual(literal.filter((f) => f.ruleId === 'A2UI003').map((f) => f.properties.componentId), ['a']);
});

test('A2UI004: formatString takes the host or the whole URL from data', () => {
  const findings = lintA2uiMessages(
    [surface(), components([
      { id: 'h', component: 'Image', url: { call: 'formatString', args: { value: 'https://${/host}/a.png' } } },
      { id: 'w', component: 'Image', url: { call: 'formatString', args: { value: '${/url}' } } },
      { id: 'e', component: 'Image', url: { call: 'formatString', args: { value: 'https://cdn.example.com/\\${/literal}' } } },
    ])],
    'm',
  );
  // The escaped interpolation is a literal URL: only its host is noted (A2UI007).
  assert.deepEqual(findings.filter((f) => f.ruleId !== 'A2UI007').map((f) => `${f.ruleId}:${f.properties.componentId}`).sort(), ['A2UI004:h', 'A2UI004:w']);
});

test('A2UI006: HTML, images and links in Text, literal or bound; code is not markup', () => {
  const findings = lintA2uiMessages(
    [surface(), components([
      { id: 'html', component: 'Text', text: 'Hello <b>there</b>' },
      { id: 'img', component: 'Text', text: 'See ![chart](https://evil.example/c.png)' },
      { id: 'link', component: 'Text', text: 'Read [the docs](https://docs.example.com) or https://bare.example.com' },
      { id: 'code', component: 'Text', text: 'Use `<b>` for bold, and ```\n<img src=x>\n```' },
      { id: 'plain', component: 'Text', text: '# Title\n\n**bold** *italic* - list [not a link]' },
      { id: 'bound', component: 'Text', text: { path: '/msg' } },
    ]), data('/msg', '<img src="https://evil.example/p.png">')],
    'm',
  );
  assert.deepEqual(findings.map((f) => `${f.properties.componentId}:${f.properties.kinds.join('+')}`).sort(), ['bound:raw HTML', 'html:raw HTML', 'img:an image', 'link:a link']);
});

test('A2UI007: the remote media hosts, literal and resolved; relative and data: URLs are not hosts', () => {
  const findings = lintA2uiMessages(
    [surface(), components([
      { id: 'a', component: 'Image', url: 'https://b.example.com/a.png' },
      { id: 'b', component: 'AudioPlayer', url: { path: '/audio' } },
      { id: 'c', component: 'Image', url: '/local.png' },
      { id: 'd', component: 'Image', url: 'data:image/png;base64,AAAA' },
    ]), data('/audio', 'https://a.example.com/x.mp3')],
    'm',
  );
  assert.deepEqual(findings, [{ ruleId: 'A2UI007', message: findings[0].message, uri: 'm', properties: { hosts: ['a.example.com', 'b.example.com'] } }]);
});

test('unresolvable bindings, relative template paths, other surfaces and deleted surfaces are left alone', () => {
  const findings = lintA2uiMessages(
    [
      surface('one'),
      components([{ id: 'list', component: 'Image', url: { path: 'art' } }, { id: 't', component: 'Image', url: { call: 'formatString', args: { value: 'https://cdn.example.com/${name}.png' } } }], 'one'),
      data('/', { art: 'https://webhook.site/a.png', name: 'x' }, 'one'),
      surface('two'),
      components([{ id: 'x', component: 'Image', url: { path: '/u' } }], 'two'),
      { version: v, deleteSurface: { surfaceId: 'two' } },
      data('/u', 'https://webhook.site/late.png', 'two'),
      'not a message',
      { version: 'v0.8', surfaceUpdate: {} },
    ],
    'm',
  );
  assert.deepEqual(ids(findings), ['A2UI005']);
});

test('CLI: --a2ui reads JSONL and writes SARIF with a2ui tags; errors fail the run', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'mcp-app-lint-a2ui-'));
  const file = path.join(dir, 'stream.jsonl');
  await writeFile(file, [surface(), components([button('go', 'javascript:alert(1)')])].map((m) => JSON.stringify(m)).join('\n'));
  let out = '';
  const code = await run(['--a2ui', file], { stdout: { write: (s) => { out += s; return true; } }, stderr: { write: () => true } });
  assert.equal(code, 1);
  const sarif = JSON.parse(out);
  const result = sarif.runs[0].results[0];
  assert.equal(result.ruleId, 'A2UI001');
  assert.equal(result.locations[0].physicalLocation.region.startLine, 2);
  const rule = sarif.runs[0].tool.driver.rules[result.ruleIndex];
  assert.deepEqual([rule.id, rule.properties.tags], ['A2UI001', ['security', 'a2ui']]);
  assert.deepEqual(toSarif([]).runs[0].tool.driver.rules.find((r) => r.id === 'MCPAPP001').properties.tags, ['security', 'mcp-apps']);
});
