# render-policy plugin

Two skills that teach Claude to handle agent-generated content safely, from the
[render-policy](https://github.com/shteynu/render-policy) project.

- **safe-agent-html**: when code displays Markdown or HTML that a model, agent or tool produced,
  Claude replaces `innerHTML`, `dangerouslySetInnerHTML` and `[innerHTML]` with the render-policy
  packages for plain DOM, React or Angular. It sanitizes into a fragment, applies a policy for images,
  links and hosts, and supports streaming replies and Mermaid diagrams. For A2UI surfaces it checks
  the resolved image, media and `openUrl` values and holds `Text` to the catalog's contract. Claude
  also adds the ESLint rules that keep those sinks from coming back.
- **mcp-app-csp**: when you build or review an MCP App (a `ui://` resource with
  `text/html;profile=mcp-app`), Claude runs `mcp-app-lint` on the server and fixes what it reports:
  CSP entries that allow every host, wildcards over services where anyone can create a subdomain,
  development origins in published metadata, tools the App can call that have side effects, and
  dynamic `innerHTML` in the App's own script.

## Install

In Claude Code:

```bash
claude plugin marketplace add shteynu/render-policy
claude plugin install render-policy@render-policy
```

## What it runs and sends

The plugin has no hooks, MCP servers or background processes. It runs nothing on its own.

- **safe-agent-html** may ask Claude to add the `@render-policy/*` npm packages (and
  `eslint-plugin-render-policy`) to your project with your package manager.
- **mcp-app-csp** asks Claude to run `mcp-app-lint` from your project's `node_modules`. If it is
  not installed, Claude asks you before adding it as a dev dependency with your package manager,
  which downloads it from the npm registry. The CLI reads the directory or files you point it at and
  prints findings locally. With `--package <name>` it downloads that npm package to a temporary
  directory, scans it and deletes it. It sends nothing else anywhere.

Every command goes through Claude's normal tool permissions. The plugin collects no data; see
[PRIVACY.md](PRIVACY.md).

## License

MIT. See [LICENSE](LICENSE).
