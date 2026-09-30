#!/usr/bin/env node
import { run } from '../src/cli.mjs';

run(process.argv.slice(2)).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`mcp-app-lint: ${error.message}\n`);
    process.exit(2);
  },
);
