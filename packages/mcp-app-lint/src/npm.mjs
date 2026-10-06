/**
 * npm as a source: keyword search, package metadata, tarballs downloaded with a size cap and
 * scanned for what the package declares about its UI resources. Public data only.
 */
import { execFile } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { analyzeHtml, withSinkHosts } from './analyze.mjs';
import { classifyDomains } from './domains.mjs';

const execFileAsync = promisify(execFile);
const REGISTRY = 'https://registry.npmjs.org';
const UA = 'mcp-ui-census/0.1 (+https://github.com/shteynu/render-policy)';
export const UI_SDKS = ['@modelcontextprotocol/ext-apps', '@mcp-ui/server', '@mcp-ui/client'];

async function getJson(url, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': UA }, signal: controller.signal });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { status: response.status });
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

/** All packages a search query returns (the API pages by `from`, 250 per page). */
export async function searchPackages(text, { max = 2000 } = {}) {
  const names = [];
  for (let from = 0; from < max; from += 250) {
    const data = await getJson(`${REGISTRY}/-/v1/search?text=${encodeURIComponent(text)}&size=250&from=${from}`);
    const objects = Array.isArray(data.objects) ? data.objects : [];
    for (const object of objects) names.push(object.package?.name);
    if (objects.length < 250) break;
  }
  return names.filter(Boolean);
}

/** Latest version manifest (small): dependencies, tarball, size. */
export async function packageMeta(name) {
  const manifest = await getJson(`${REGISTRY}/${encodeURIComponent(name).replace('%40', '@')}/latest`);
  if (!manifest?.version) throw new Error(`${name}: no latest version`);
  const deps = { ...(manifest.dependencies ?? {}), ...(manifest.peerDependencies ?? {}), ...(manifest.optionalDependencies ?? {}) };
  return {
    name,
    version: manifest.version,
    description: manifest.description ?? '',
    repository: manifest.repository?.url ?? null,
    tarball: manifest.dist?.tarball ?? null,
    unpackedSize: manifest.dist?.unpackedSize ?? null,
    uiSdks: UI_SDKS.filter((sdk) => sdk in deps),
    dependsOnMcpSdk: '@modelcontextprotocol/sdk' in deps,
  };
}

export async function downloadTarball(url, dest, { maxBytes = 25 * 1024 * 1024, timeoutMs = 60000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'user-agent': UA }, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > maxBytes) throw Object.assign(new Error(`tarball is ${length} bytes, over the cap`), { kind: 'too-large' });
    let received = 0;
    const capped = Readable.fromWeb(response.body);
    capped.on('data', (chunk) => {
      received += chunk.length;
      if (received > maxBytes) capped.destroy(Object.assign(new Error('tarball exceeded the cap while streaming'), { kind: 'too-large' }));
    });
    await pipeline(capped, createWriteStream(dest));
    return received;
  } finally {
    clearTimeout(timer);
  }
}

export async function extractTarball(file, dir) {
  await mkdir(dir, { recursive: true });
  await execFileAsync('tar', ['-xzf', file, '-C', dir], { maxBuffer: 1024 * 1024 });
}

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx', '.mts', '.cts']);
const CSP_ARRAY_RE = /\b(connectDomains|resourceDomains|frameDomains|baseUriDomains)\s*:\s*\[([^\]]*)\]/g;
// `connectDomains: DOMAINS` and the shorthand `{ connectDomains }`: a list built elsewhere. Lookaheads keep
// out member access (`x.array(…)` in the SDK's bundled schema) and type annotations (`string[]`).
const CSP_IDENT_RE = /\b(connectDomains|resourceDomains|frameDomains|baseUriDomains)\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\r\n])/g;
const CSP_SHORTHAND_RE = /[{,]\s*(connectDomains|resourceDomains|frameDomains|baseUriDomains)\s*(?=[,}])/g;
const NOT_A_LIST = new Set(['undefined', 'null', 'true', 'false', 'string', 'number', 'boolean', 'any', 'unknown', 'never']);
// What a server that serves a UI resource writes; a host or SDK mentions the MIME type or ui:// too.
const SERVES_UI_RE = /\b(registerAppResource|createUIResource)\s*\(|\bmimeType\s*(:|=)\s*(RESOURCE_MIME_TYPE\b|["'`]text\/html;profile=mcp-app)|\buri\s*[:=]\s*["'`]ui:\/\/|\.(registerResource|resource)\s*\(\s*[^,()]+,\s*["'`]ui:\/\//;
// `mimeType: APP_MIME` where some file of the package sets APP_MIME to the MCP Apps MIME type.
const MIME_CONSTANT_RE = /\b([A-Za-z_$][\w$]*)\s*=\s*["'`]text\/html;profile=mcp-app["'`]/g;
const MIME_IDENT_RE = /\bmimeType\s*:\s*([A-Za-z_$][\w$]*)\s*(?=[,}\r\n])/g;
const lineAt = (text, index) => text.slice(0, index).split('\n').length;
const PERMISSIONS_RE = /\bpermissions\s*:\s*\{([^}]*)\}/g;
const VISIBILITY_RE = /\bvisibility\s*:\s*\[([^\]]*)\]/g;
const EMBEDDED_HTML_RE = /<!doctype html>[\s\S]*?<\/html>/gi;

async function* walk(dir, depth = 0) {
  if (depth > 12) return;
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, depth + 1);
    else if (entry.isFile()) yield full;
  }
}

const stringLiterals = (text) => [...text.matchAll(/["'`]([^"'`]*)["'`]/g)].map((m) => m[1]).filter(Boolean);

/** What an unpacked package says about its UI resources. Regex-based on purpose: a census, not a compiler. */
export async function scanPackageDir(dir, { maxFiles = 4000, maxFileBytes = 2 * 1024 * 1024 } = {}) {
  const result = {
    files: 0,
    sourceFiles: 0,
    appResourceRegistrations: 0,
    uiMimeMentions: 0,
    uiUriMentions: 0,
    cspArrays: 0,
    cspDynamic: 0,
    servesUi: false,
    domainSites: [],
    domains: { connectDomains: [], resourceDomains: [], frameDomains: [], baseUriDomains: [] },
    permissions: new Set(),
    toolVisibility: { app: 0, model: 0 },
    readOnlyHints: 0,
    html: [],
    embeddedHtml: 0,
  };
  const mimeConstants = new Set();
  const mimeIdents = new Set();
  for await (const file of walk(dir)) {
    result.files += 1;
    if (result.files > maxFiles) break;
    const ext = path.extname(file).toLowerCase();
    const isSource = SOURCE_EXT.has(ext);
    const isHtml = ext === '.html' || ext === '.htm';
    if (!isSource && !isHtml) continue;
    const info = await stat(file);
    if (info.size > maxFileBytes) continue;
    const text = await readFile(file, 'utf8').catch(() => '');
    if (isHtml) {
      result.html.push({ file: path.relative(dir, file), ...withSinkHosts(analyzeHtml(text)) });
      continue;
    }
    result.sourceFiles += 1;
    result.appResourceRegistrations += (text.match(/\bregisterAppResource\s*\(/g) ?? []).length;
    result.uiMimeMentions += (text.match(/text\/html;profile=mcp-app/g) ?? []).length;
    result.uiUriMentions += (text.match(/["'`]ui:\/\//g) ?? []).length;
    const relative = path.relative(dir, file).split(path.sep).join('/');
    const declaration = !/\.d\.[cm]?ts$/.test(file);
    if (declaration) {
      if (SERVES_UI_RE.test(text)) result.servesUi = true;
      for (const m of text.matchAll(MIME_CONSTANT_RE)) mimeConstants.add(m[1]);
      for (const m of text.matchAll(MIME_IDENT_RE)) mimeIdents.add(m[1]);
    }
    const addList = (key, body, index) => {
      result.cspArrays += 1;
      const line = lineAt(text, index);
      for (const raw of stringLiterals(body)) {
        result.domains[key].push(raw);
        // One list referenced twice (`resourceDomains: DOMAINS` in two tools) is one place to fix.
        if (!result.domainSites.some((site) => site.key === key && site.raw === raw && site.file === relative && site.line === line)) result.domainSites.push({ key, raw, file: relative, line });
      }
    };
    for (const match of text.matchAll(CSP_ARRAY_RE)) addList(match[1], match[2], match.index);
    const named = [...text.matchAll(CSP_IDENT_RE)].map((m) => [m[1], m[2]]).concat([...text.matchAll(CSP_SHORTHAND_RE)].map((m) => [m[1], m[1]]));
    for (const [key, name] of declaration ? named : []) {
      if (NOT_A_LIST.has(name)) continue;
      const list = new RegExp(`\\b(?:const|let|var)\\s+${name.replace(/\$/g, '\\$')}\\s*(?::[^=]+)?=\\s*\\[([^\\]]*)\\]`).exec(text);
      if (list) addList(key, list[1], list.index);
      else result.cspDynamic += 1;
    }
    for (const match of text.matchAll(PERMISSIONS_RE)) {
      for (const key of ['camera', 'microphone', 'geolocation', 'clipboardWrite']) if (new RegExp(`\\b${key}\\b`).test(match[1])) result.permissions.add(key);
    }
    for (const match of text.matchAll(VISIBILITY_RE)) {
      if (/['"]app['"]/.test(match[1])) result.toolVisibility.app += 1;
      if (/['"]model['"]/.test(match[1])) result.toolVisibility.model += 1;
    }
    result.readOnlyHints += (text.match(/readOnlyHint\s*:\s*true/g) ?? []).length;
    for (const match of text.matchAll(EMBEDDED_HTML_RE)) {
      result.embeddedHtml += 1;
      if (result.html.length < 40) result.html.push({ file: `${path.relative(dir, file)}#embedded`, ...withSinkHosts(analyzeHtml(match[0])) });
    }
  }
  const classified = {};
  for (const key of Object.keys(result.domains)) classified[key] = classifyDomains(result.domains[key]);
  return {
    ...result,
    permissions: [...result.permissions],
    domainsClassified: classified,
    declaresUi: result.appResourceRegistrations + result.uiMimeMentions + result.uiUriMentions > 0,
    cspDeclared: result.cspArrays + result.cspDynamic > 0,
    // A domain list written in code is itself a sign the package serves a UI resource.
    servesUi: result.servesUi || [...mimeIdents].some((name) => mimeConstants.has(name)) || result.domainSites.some((site) => !/\.d\.[cm]?ts$/.test(site.file)),
  };
}

/** Download, extract, scan, clean up. */
export async function scanPackage(meta, workDir, options = {}) {
  const safe = meta.name.replace(/[^a-z0-9]+/gi, '_');
  const tgz = path.join(workDir, `${safe}.tgz`);
  const dir = path.join(workDir, safe);
  try {
    const bytes = await downloadTarball(meta.tarball, tgz, options);
    await extractTarball(tgz, dir);
    const scan = await scanPackageDir(dir, options);
    return { ok: true, bytes, ...scan };
  } finally {
    await rm(tgz, { force: true });
    await rm(dir, { recursive: true, force: true });
  }
}
