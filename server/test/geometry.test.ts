import { describe, it, expect } from 'vitest';
import {
  normalizeAngle,
  toApiHeading,
  toInternalHeading,
  toRelativeBearing,
} from '../src/util/geometry';

// These primitives back the bot-facing convention boundary: the internal engine
// uses a south-zero compass, while the bot API is north-zero, and reported
// bearings are relative to the body. Getting any of these wrong silently aims
// bots the wrong way, so they're tested exhaustively.

describe('normalizeAngle', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(450)).toBe(90);
    expect(normalizeAngle(-90)).toBe(270);
    expect(normalizeAngle(-450)).toBe(270);
  });
});

describe('toApiHeading (internal south-zero -> bot-facing north-zero)', () => {
  it('rotates the four cardinals by 180°', () => {
    expect(toApiHeading(0)).toBe(180); // internal south -> API south(180)
    expect(toApiHeading(90)).toBe(270); // internal west  -> API west(270)
    expect(toApiHeading(180)).toBe(0); // internal north -> API north(0)
    expect(toApiHeading(270)).toBe(90); // internal east  -> API east(90)
  });
  it('normalizes the result', () => {
    expect(toApiHeading(360)).toBe(180);
    expect(toApiHeading(-90)).toBe(90);
  });
});

describe('toInternalHeading (bot-facing north-zero -> internal south-zero)', () => {
  it('is the inverse of toApiHeading', () => {
    expect(toInternalHeading(0)).toBe(180); // API north -> internal 180 (up)
    expect(toInternalHeading(90)).toBe(270); // API east  -> internal 270
    expect(toInternalHeading(180)).toBe(0);
    expect(toInternalHeading(270)).toBe(90);
  });
  it('round-trips with toApiHeading', () => {
    for (const a of [0, 1, 45, 90, 179, 180, 270, 359]) {
      expect(toInternalHeading(toApiHeading(a))).toBe(normalizeAngle(a));
      expect(toApiHeading(toInternalHeading(a))).toBe(normalizeAngle(a));
    }
  });
});

describe('toRelativeBearing (absolute internal angle -> bearing off the body)', () => {
  it('is the normalized difference from the body heading', () => {
    expect(toRelativeBearing(0, 0)).toBe(0); // dead ahead
    expect(toRelativeBearing(90, 0)).toBe(90);
    expect(toRelativeBearing(0, 90)).toBe(270); // target behind-left of a turned body
    expect(toRelativeBearing(270, 270)).toBe(0);
    expect(toRelativeBearing(45, 90)).toBe(315);
  });
  it('is invariant to the compass zero-point (convention-independent)', () => {
    // Shifting both target and body by the same amount leaves the bearing fixed.
    expect(toRelativeBearing(200, 110)).toBe(toRelativeBearing(20, 290));
  });
});
