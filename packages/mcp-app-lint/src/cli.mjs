/**
 * mcp-app-lint: SARIF findings about what an MCP App declares and what its HTML does.
 *
 *   mcp-app-lint --dir ./my-server                 # a package directory (built or source)
 *   mcp-app-lint --package @scope/name             # an npm package (downloaded, scanned, deleted)
 *   mcp-app-lint --read read.json [--list list.json] [--tools tools.json]
 *                                                  # results of resources/read, resources/list, tools/list
 *   mcp-app-lint --html app.html                   # one UI document
 * Options: --out file.sarif, --format sarif|text (default sarif), --fail-on error|warning|note|none (default error)
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { UI_MIME } from './analyze.mjs';
import { lintHtml, lintPackageScan, lintResource, lintTools, levelOf } from './lint.mjs';
import { packageMeta, scanPackage, scanPackageDir } from './npm.mjs';
import { toSarif, toText } from './sarif.mjs';

const LEVEL_RANK = { error: 3, warning: 2, note: 1, none: 0 };

function parseArgs(argv) {
  const options = { format: 'sarif', failOn: 'error' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => argv[++i];
    if (arg === '--dir') options.dir = next();
    else if (arg === '--package') options.package = next();
    else if (arg === '--read') options.read = next();
    else if (arg === '--list') options.list = next();
    else if (arg === '--tools') options.tools = next();
    else if (arg === '--html') options.html = next();
    else if (arg === '--out') options.out = next();
    else if (arg === '--format') options.format = next();
    else if (arg === '--fail-on') options.failOn = next();
    else if (arg === '--help' || arg === '-h') options.help = true;
    else throw new Error(`unknown argument ${arg}`);
  }
  return options;
}

const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
const isUiResource = (r) => (r?.mimeType ?? '').startsWith('text/html') || String(r?.uri ?? '').startsWith('ui://');

export async function run(argv, { stdout = process.stdout, stderr = process.stderr } = {}) {
  const options = parseArgs(argv);
  if (options.help || (!options.dir && !options.package && !options.read && !options.html && !options.tools)) {
    stderr.write('usage: mcp-app-lint (--dir <path> | --package <name> | --read <read.json> [--list <list.json>] | --html <file>) [--tools <tools.json>] [--out file] [--format sarif|text] [--fail-on error|warning|note|none]\n');
    return 2;
  }
  const findings = [];

  if (options.dir) {
    const scan = await scanPackageDir(path.resolve(options.dir));
    findings.push(...lintPackageScan(scan, options.dir));
  }
  if (options.package) {
    const meta = await packageMeta(options.package);
    if (!meta.tarball) throw new Error(`${options.package}: no tarball`);
    const work = path.join(os.tmpdir(), 'mcp-app-lint');
    await mkdir(work, { recursive: true });
    try {
      const scan = await scanPackage(meta, work);
      findings.push(...lintPackageScan(scan, `npm:${meta.name}@${meta.version}`));
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  if (options.read) {
    const read = await readJson(options.read);
    const contents = Array.isArray(read?.contents) ? read.contents : Array.isArray(read) ? read : [read];
    const listing = options.list ? await readJson(options.list) : null;
    const listEntries = Array.isArray(listing?.resources) ? listing.resources : Array.isArray(listing) ? listing : listing ? [listing] : [];
    for (const item of contents) {
      if (!isUiResource(item) && item.mimeType !== UI_MIME) continue;
      const entry = listEntries.find((r) => r.uri === item.uri) ?? null;
      findings.push(...lintResource({ uri: item.uri ?? options.read, listMeta: entry?._meta ?? null, readMeta: item._meta ?? null, html: typeof item.text === 'string' ? item.text : null }));
    }
  }
  if (options.html) {
    findings.push(...lintHtml(await readFile(options.html, 'utf8'), options.html));
  }
  if (options.tools) {
    const tools = await readJson(options.tools);
    findings.push(...lintTools(Array.isArray(tools?.tools) ? tools.tools : tools, options.tools));
  }

  const output = options.format === 'text' ? toText(findings) : `${JSON.stringify(toSarif(findings, { commandLine: `mcp-app-lint ${argv.join(' ')}` }), null, 2)}\n`;
  if (options.out) await writeFile(options.out, output);
  else stdout.write(output);

  const threshold = LEVEL_RANK[options.failOn] ?? 3;
  const worst = Math.max(0, ...findings.map((f) => LEVEL_RANK[f.level ?? levelOf(f.ruleId)] ?? 0));
  return threshold > 0 && worst >= threshold ? 1 : 0;
}
