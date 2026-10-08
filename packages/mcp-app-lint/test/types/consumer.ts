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
  type DomainCategory,
  type Finding,
  type Level,
  type PackageScan,
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

// @ts-expect-error a finding needs a uri
const broken: Finding = { ruleId: 'MCPAPP001', message: 'm' };

export { a2ui, broken, category, exitCode, fromScan, handwritten, level, ruleIds, sarifVersion, scope };
