import { describe, it, expect } from 'vitest';
import { normalizeAngle } from '../src/util/geometry';

describe('normalizeAngle', () => {
  it('wraps an angle into [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-10)).toBe(350);
    expect(normalizeAngle(-370)).toBe(350);
  });
});
