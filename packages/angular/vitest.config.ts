import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const here = path.dirname(fileURLToPath(import.meta.url));

// The tests run against the ng-packagr output, the artifact that ships: its partial declarations
// are linked at runtime by @angular/compiler (JIT), the same way packages/angular/e2e runs it.
// Signal inputs need compiled metadata, which plain decorators in source do not carry, so the
// library source cannot be tested directly without the Angular CLI's JIT transform.
const fesm = path.resolve(here, 'dist/fesm2022/render-policy-angular.mjs');
if (!existsSync(fesm)) {
  throw new Error('@render-policy/angular tests run against the built package: npm run build -w packages/core && npm run build -w packages/angular');
}

export default defineConfig({
  resolve: {
    alias: {
      '@render-policy/angular': fesm,
      '@render-policy/core': path.resolve(here, '../core/src/index.ts'),
    },
  },
  test: {
    environment: 'jsdom',
    environmentOptions: {
      jsdom: { url: 'https://app.example/chat' },
    },
    setupFiles: ['test/setup.ts'],
    include: ['test/**/*.test.ts'],
  },
});
