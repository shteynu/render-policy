import { RULES, RULE_INDEX } from './rules.mjs';
import { levelOf } from './lint.mjs';

export const TOOL_VERSION = '0.1.0';

/** A SARIF 2.1.0 log with one run. */
export function toSarif(findings, { invocation = {} } = {}) {
  const results = findings.map((f) => ({
    ruleId: f.ruleId,
    ruleIndex: RULE_INDEX.get(f.ruleId),
    level: f.level ?? levelOf(f.ruleId),
    message: { text: f.message },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: f.uri },
          ...(f.region ? { region: f.region } : {}),
        },
        ...(f.logical ? { logicalLocations: [f.logical] } : {}),
      },
    ],
    ...(f.properties ? { properties: f.properties } : {}),
  }));
  return {
    $schema: 'https://json.schemastore.org/sarif-2.1.0.json',
    version: '2.1.0',
    runs: [
      {
        tool: {
          driver: {
            name: 'mcp-app-lint',
            version: TOOL_VERSION,
            informationUri: 'https://github.com/shteynu/render-policy/tree/main/packages/mcp-app-lint',
            rules: RULES.map((rule) => ({
              id: rule.id,
              name: rule.name,
              shortDescription: { text: rule.short },
              fullDescription: { text: rule.full },
              help: { text: rule.full },
              defaultConfiguration: { level: rule.level },
              properties: { tags: ['security', 'mcp-apps'] },
            })),
          },
        },
        invocations: [{ executionSuccessful: true, ...invocation }],
        results,
      },
    ],
  };
}

export function toText(findings) {
  if (findings.length === 0) return 'no findings\n';
  return `${findings
    .map((f) => `${(f.level ?? levelOf(f.ruleId)).padEnd(7)} ${f.ruleId} ${f.uri}${f.region ? `:${f.region.startLine}:${f.region.startColumn}` : ''}  ${f.message}`)
    .join('\n')}\n`;
}
