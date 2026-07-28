import { defineConfig } from 'vitest/config';

// Dedicated config for the on-demand skill-vs-luck harness
// (test/skillLuck.harness.ts). Kept separate from vitest.config.ts so the
// harness never runs in CI (the default glob is `test/**/*.test.ts`) and so it
// gets a long timeout and no coverage instrumentation. Run with
// `npm run skill-luck`.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/skillLuck.harness.ts'],
    // Real isolates + many full matches: the single `it` sets its own 30-min
    // ceiling, this just keeps the hook/suite timeouts from tripping first.
    hookTimeout: 30 * 60 * 1000,
    // One match drives one shared arena at a time; keep runs serial and
    // deterministic rather than racing isolates against each other.
    fileParallelism: false,
  },
});
