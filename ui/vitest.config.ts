import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Default to a plain node environment (the util suites are pure logic over
    // plain objects). Component/page tests that render React opt into jsdom with
    // a `// @vitest-environment jsdom` docblock at the top of the file.
    environment: 'node',
    include: ['test/**/*.test.{ts,tsx}'],
  },
});
