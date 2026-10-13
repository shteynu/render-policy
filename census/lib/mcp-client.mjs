/**
 * The census probes servers with mcp-app-lint's read-only Streamable HTTP client (initialize,
 * resources/list, resources/read, tools/list; never a tool call), under its own user agent and
 * client name so server owners can tell a census probe from someone running the linter.
 */
import { McpHttpClient as LintHttpClient } from 'mcp-app-lint';

export { failureKind, firstJsonRpcFromSse } from 'mcp-app-lint';

export class McpHttpClient extends LintHttpClient {
  constructor(url, options = {}) {
    super(url, { userAgent: 'mcp-ui-census/0.1 (+https://github.com/shteynu/render-policy)', clientName: 'mcp-ui-census', clientVersion: '0.1.0', ...options });
  }
}
