import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { RULES } from '../src/index.mjs';
import { run } from '../src/cli.mjs';

/** Collect what the CLI writes to stdout/stderr so a test can read it. */
function capture() {
  const out = [];
  const err = [];
  return { stdout: { write: (s) => out.push(s) }, stderr: { write: (s) => err.push(s) }, out: () => out.join(''), err: () => err.join('') };
}

/** A tiny package that declares a risky MCP App, under the working directory so uris come out relative. */
async function badApp() {
  const dir = await mkdtemp(path.join(process.cwd(), '.cli-fixture-'));
  await mkdir(path.join(dir, 'src'), { recursive: true });
  await writeFile(
    path.join(dir, 'src', 'server.js'),
    [
      "server.registerAppResource('ui://demo/app', {",
      "  _meta: { ui: {",
      "    csp: { connectDomains: ['https:'], resourceDomains: ['http://cdn.example'] },",
      '    permissions: { camera: {} },',
      '  } },',
      '});',
    ].join('\n'),
  );
  await writeFile(
    path.join(dir, 'app.html'),
    '<!doctype html><html><body><div id="o"></div><script>\ndocument.getElementById("o").innerHTML = result.text;\nparent.postMessage(result, "*");\n</script></body></html>',
  );
  return dir;
}

const rank = { error: 3, warning: 2, note: 1 };

test('--dir emits code-scanning-ready SARIF and exits per --fail-on', async () => {
  const dir = await badApp();
  try {
    const sarifPath = path.join(dir, 'out.sarif');
    const io = capture();
    const code = await run(['--dir', dir, '--format', 'sarif', '--out', sarifPath, '--fail-on', 'error'], io);
    assert.equal(code, 1); // a full-wildcard connect host is an error-level finding

    const log = JSON.parse(await (await import('node:fs/promises')).readFile(sarifPath, 'utf8'));
    assert.equal(log.version, '2.1.0');
    const runLog = log.runs[0];
    assert.equal(runLog.tool.driver.name, 'mcp-app-lint');
    assert.equal(runLog.tool.driver.rules.length, RULES.length);
    assert.ok(runLog.results.length > 0);

    const ids = new Set(RULES.map((r) => r.id));
    for (const result of runLog.results) {
      assert.ok(ids.has(result.ruleId), `unknown ruleId ${result.ruleId}`);
      assert.equal(runLog.tool.driver.rules[result.ruleIndex].id, result.ruleId, 'ruleIndex points at the rule');
      assert.ok(['error', 'warning', 'note'].includes(result.level));
      const uri = result.locations[0].physicalLocation.artifactLocation.uri;
      assert.ok(uri && !path.isAbsolute(uri) && !uri.startsWith('/') && !uri.includes('\\'), `uri must be relative and forward-slashed: ${uri}`);
    }
    // The risky declarations we planted are all reported.
    const reported = new Set(runLog.results.map((r) => r.ruleId));
    for (const id of ['MCPAPP002', 'MCPAPP004', 'MCPAPP007', 'MCPAPP010', 'MCPAPP011']) assert.ok(reported.has(id), `expected ${id}`);
    // The html finding carries a line/column region.
    const sink = runLog.results.find((r) => r.ruleId === 'MCPAPP010');
    assert.ok(sink.locations[0].physicalLocation.region?.startLine >= 1);
    // A CSP entry points at the file and line where it is written.
    const every = runLog.results.find((r) => r.ruleId === 'MCPAPP002').locations[0].physicalLocation;
    assert.ok(every.artifactLocation.uri.endsWith('/src/server.js'), every.artifactLocation.uri);
    assert.equal(every.region?.startLine, 3);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('--fail-on none reports the same findings but exits 0', async () => {
  const dir = await badApp();
  try {
    const io = capture();
    const code = await run(['--dir', dir, '--format', 'text', '--fail-on', 'none'], io);
    assert.equal(code, 0);
    const text = io.out();
    assert.match(text, /MCPAPP002/);
    assert.match(text, /MCPAPP010/);
    // text lines are "level ruleId uri…", sorted worst-first is not required, but every level is a known word
    for (const line of text.trim().split('\n')) assert.ok(/^(error|warning|note)\s+MCPAPP/.test(line), line);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('no target prints usage and exits 2', async () => {
  const io = capture();
  const code = await run([], io);
  assert.equal(code, 2);
  assert.match(io.err(), /usage: mcp-app-lint/);
});

test('an option without its value is a usage error, not a missing target', async () => {
  await assert.rejects(run(['--dir'], capture()), /--dir needs a value/);
  await assert.rejects(run(['--html', 'a.html', '--format'], capture()), /--format needs a value/);
});

test('--fail-on ranks levels: a warning-only scan passes under error but fails under warning', async () => {
  const dir = await mkdtemp(path.join(process.cwd(), '.cli-fixture-'));
  try {
    // A hand-written innerHTML sink is warning-level (MCPAPP010) with nothing error-level.
    await writeFile(path.join(dir, 'app.html'), '<!doctype html><html><body><div id="o"></div><script>\ndocument.getElementById("o").innerHTML = x;\n</script></body></html>');
    assert.equal(await run(['--dir', dir, '--format', 'sarif', '--out', path.join(dir, 'a.sarif'), '--fail-on', 'error'], capture()), 0);
    assert.equal(await run(['--dir', dir, '--format', 'sarif', '--out', path.join(dir, 'b.sarif'), '--fail-on', 'warning'], capture()), 1);
    assert.ok(rank.error > rank.warning);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
