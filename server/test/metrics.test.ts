import { describe, it, expect, vi } from 'vitest';

// collectMetrics only needs EnvironmentService.metrics(); mock it so no isolate
// or pool is loaded.
vi.mock('../src/services/EnvironmentService', () => ({
  default: {
    metrics: vi.fn(() => ({
      arenas: 3,
      runningArenas: 2,
      isolates: 5,
      maxAvgTickMs: 4.2,
    })),
  },
}));

import { collectMetrics } from '../src/util/metrics';
import environmentService from '../src/services/EnvironmentService';

describe('collectMetrics', () => {
  it('merges the env gauges with process memory (in MB)', () => {
    const m = collectMetrics();
    // Env gauges pass through unchanged.
    expect(m).toMatchObject({
      arenas: 3,
      runningArenas: 2,
      isolates: 5,
      maxAvgTickMs: 4.2,
    });
    // Memory gauges are added as whole megabytes.
    expect(typeof m.rssMB).toBe('number');
    expect(typeof m.heapUsedMB).toBe('number');
    expect(Number.isInteger(m.rssMB)).toBe(true);
    expect(Number.isInteger(m.heapUsedMB)).toBe(true);
    // A single cheap env pass per call.
    expect(environmentService.metrics).toHaveBeenCalledTimes(1);
  });
});
