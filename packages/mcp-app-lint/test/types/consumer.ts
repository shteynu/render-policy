// Compiled against the published declarations (dist/) by `npm run build`: what a TypeScript
// user of the package sees. Not executed.
import {
  analyzeHtml,
  categorizeDomain,
  lintA2uiMessages,
  lintPackageScan,
  parseA2uiMessages,
  lintResource,
  parseDomainPattern,
  RULES,
  run,
  scanPackageDir,
  sinkScope,
  toSarif,
  cspNeeds,
  handleMessage,
  lintSnapshot,
  McpHttpClient,
  McpStdioClient,
  snapshotServer,
  suggestCsp,
  type CspNeeds,
  type DomainCategory,
  type Finding,
  type Level,
  type PackageScan,
  type ServerSnapshot,
} from 'mcp-app-lint';

const findings: Finding[] = lintResource({ uri: 'ui://app', readMeta: { ui: { csp: { connectDomains: ['https://api.example.com'] } } }, html: '<p>hi</p>' });
const level: Level | undefined = findings[0]?.level;
const category: DomainCategory = categorizeDomain(parseDomainPattern('https://*.example.com'));
const scope: 'shared' | 'tenant' | undefined = sinkScope('storage.googleapis.com')?.scope;
const scan: Promise<PackageScan> = scanPackageDir('.', { maxFiles: 10 });
const fromScan: Promise<Finding[]> = scan.then((s) => lintPackageScan(s, 'pkg'));
const handwritten: number = analyzeHtml('<script>x.innerHTML = y</script>').unsafeInnerHtmlHandwritten;
const sarifVersion: string = toSarif(findings).version;
const exitCode: Promise<number> = run(['--html', 'app.html'], { stdout: { write: () => true } });
const ruleIds: string[] = RULES.map((rule) => rule.id);
const a2ui: Finding[] = lintA2uiMessages(parseA2uiMessages('{"version":"v0.9","deleteSurface":{"surfaceId":"s"}}'), 'stream.jsonl');
const needs: CspNeeds = cspNeeds('<img src="https://img.example/a.png">');
const suggested: Partial<CspNeeds> | null = suggestCsp(needs);
const snapshot: Promise<ServerSnapshot> = snapshotServer(new McpHttpClient('https://x.example/mcp', { headers: { authorization: 'Bearer t' }, timeoutMs: 1000 }));
const live: Promise<Finding[]> = snapshot.then((s) => lintSnapshot(s));
const stdio: McpStdioClient = new McpStdioClient('node server.js', { timeoutMs: 1000 });
const answer: Promise<Record<string, unknown> | null> = handleMessage({ jsonrpc: '2.0', id: 1, method: 'ping' });

// @ts-expect-error a finding needs a uri
const broken: Finding = { ruleId: 'MCPAPP001', message: 'm' };

export { a2ui, answer, broken, category, exitCode, fromScan, handwritten, level, live, ruleIds, sarifVersion, scope, stdio, suggested };
