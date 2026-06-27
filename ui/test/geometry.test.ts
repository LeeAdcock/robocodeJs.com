import { describe, it, expect } from 'vitest';
import { normalizeAngle, shortestAngleDelta } from '../src/util/geometry';

describe('normalizeAngle', () => {
  it('wraps an angle into [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-10)).toBe(350);
    expect(normalizeAngle(-370)).toBe(350);
  });
});

describe('shortestAngleDelta', () => {
  it('takes the short way across the 0/360 seam', () => {
    expect(shortestAngleDelta(359, 1)).toBe(2); // forward, not -358
    expect(shortestAngleDelta(1, 359)).toBe(-2); // backward, not +358
  });

  it('handles same and small in-range deltas', () => {
    expect(shortestAngleDelta(90, 90)).toBe(0);
    expect(shortestAngleDelta(90, 100)).toBe(10);
    expect(shortestAngleDelta(100, 90)).toBe(-10);
  });

  it('works from a continuous (unwrapped) source angle', () => {
    // 361 is equivalent to 1; a target of 1 should not move it.
    expect(shortestAngleDelta(361, 1)).toBe(0);
    // and a small step from there stays small.
    expect(shortestAngleDelta(361, 3)).toBe(2);
  });
});
