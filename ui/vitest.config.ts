import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to a plain node environment (the util suites are pure logic over
    // plain objects). Component/page tests that render React opt into jsdom with
    // a `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
    // Environment shims (ResizeObserver for the virtualized log list).
    setupFiles: ['test/setup.ts'],
    coverage: {
      provider: 'v8',
      // `json-summary` is consumed by the root combined-coverage gate
      // (scripts/coverage-check.cjs) — see the root `coverage` script.
      reporter: ['text', 'html', 'lcov', 'json-summary'],
      reportsDirectory: './coverage',
      // Measure the app source only. Vitest already excludes test files,
      // node_modules, configs, and .d.ts by default; we add the SPA entry
      // point and the wire-DTO type mirrors (no logic to exercise).
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/types/**'],
    },
  },
});
