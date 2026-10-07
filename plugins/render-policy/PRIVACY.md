# Privacy policy: render-policy plugin

The render-policy plugin consists of two skills, which are instructions for Claude. It has no MCP
servers, hooks, background processes or network endpoints of its own.

## Data the plugin collects

None. The plugin and its authors receive no data from your use of it: no prompts, code, files,
usage statistics or personal data.

## What the skills may ask Claude to do

- **safe-agent-html** may ask Claude to add the open-source `@render-policy/*` and
  `eslint-plugin-render-policy` packages to your project with your package manager. The package
  manager downloads them from the registry your project uses.
- **mcp-app-csp** may ask Claude to install the open-source `mcp-app-lint` package as a dev
  dependency the same way, and to run it from your project's `node_modules`. It reads local files
  and prints findings in your terminal; it does not send them anywhere. Only when you pass
  `--package <name>` does it download that package from the npm registry to scan it.

Package registries see the download requests your package manager makes, under their own privacy
policies. Every command runs through Claude's normal tool permissions, so you approve it first.

## Contact

Questions about this policy: open an issue at https://github.com/shteynu/render-policy/issues or
see [SECURITY.md](https://github.com/shteynu/render-policy/blob/main/SECURITY.md) for private
reports.
