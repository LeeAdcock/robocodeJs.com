import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: './coverage',
      // Measure the real source only. Vitest already excludes test files,
      // node_modules, configs, and .d.ts by default; we add the build output
      // and the process entry point (not exercised under unit test).
      include: ['src/**/*.ts'],
      exclude: ['dist/**', 'src/index.ts'],
    },
  },
});
