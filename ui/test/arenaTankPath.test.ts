import { describe, it, expect } from 'vitest';
import {
  buildTrailPoints,
  trailSegmentOpacity,
} from '../src/components/arena/arenaTankPath';
import PointInTime from '../src/types/pointInTime';

// buildTrailPoints reconstructs the trail polyline: recorded vertices in
// ring-buffer insertion order (oldest → newest), then the live position.

const p = (x: number, y: number, time = 0): PointInTime => ({ x, y, time });
const xs = (pts: { x: number }[]) => pts.map((pt) => pt.x);

describe('buildTrailPoints', () => {
  it('orders vertices oldest→newest then appends the current position', () => {
    const path = new Array<PointInTime>(20);
    path[0] = p(100, 100);
    path[1] = p(110, 120);
    path[2] = p(130, 140);
    const pts = buildTrailPoints(path, 3, 200, 200);
    expect(xs(pts)).toEqual([100, 110, 130, 200]);
  });

  it('orders by insertion (pathIndex), NOT by the time field', () => {
    // The seed point (path[0]) and the recorded vertices are stamped from
    // different clocks, so the origin can carry a larger `time` than later
    // vertices. A time-sort would move it next to the appended current point and
    // draw a spurious origin→current line; ring order keeps it first.
    const path = new Array<PointInTime>(20);
    path[0] = p(100, 100, 9999); // origin, but a big/out-of-order timestamp
    path[1] = p(110, 120, 6);
    path[2] = p(130, 140, 7);
    const pts = buildTrailPoints(path, 3, 200, 200);
    expect(xs(pts)).toEqual([100, 110, 130, 200]);
    expect(pts[0]).toMatchObject({ x: 100, y: 100 }); // origin stays first
  });

  it('walks the ring in insertion order after the buffer has wrapped', () => {
    // Size-3 ring, 5 points written: slots hold [step3, step4, step2]; the
    // oldest surviving is the next-write slot (pathIndex % len).
    const path: PointInTime[] = [p(3, 3), p(4, 4), p(2, 2)];
    const pts = buildTrailPoints(path, 5, 9, 9); // next write = 5 % 3 = 2
    expect(xs(pts)).toEqual([2, 3, 4, 9]);
  });

  it('skips empty slots and points on an axis (falsy x/y)', () => {
    const path = new Array<PointInTime>(20);
    path[0] = p(100, 100);
    path[1] = { x: 0, y: 50, time: 1 }; // filtered (x is falsy)
    path[2] = p(130, 140);
    const pts = buildTrailPoints(path, 3, 200, 200);
    expect(xs(pts)).toEqual([100, 130, 200]);
  });
});

describe('trailSegmentOpacity', () => {
  it('draws the initial spawn→current segment at full opacity', () => {
    // Two points (spawn + current) = one segment; it must be visible, not faded
    // to 0 the way the old `0.45 * pointIndex/length` formula left it.
    expect(trailSegmentOpacity(0, 2)).toBeCloseTo(0.45);
  });

  it('keeps the newest segment opaque and fades older ones', () => {
    const count = 6; // 5 segments, indexed 0 (oldest) .. 4 (newest)
    expect(trailSegmentOpacity(4, count)).toBeCloseTo(0.45); // newest: full
    expect(trailSegmentOpacity(0, count)).toBeGreaterThan(0); // oldest: visible
    expect(trailSegmentOpacity(0, count)).toBeLessThan(
      trailSegmentOpacity(4, count)
    );
  });
});
