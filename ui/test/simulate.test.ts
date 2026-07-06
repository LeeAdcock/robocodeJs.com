import { describe, it, expect } from 'vitest';
import simulate from '../src/util/simulate';

// The UI runs this partial mirror of the server's simulation between server
// ticks to interpolate smooth motion. It mutates the apps array in place.
// Angles are in degrees; 0° points "down" (+y).

function makeBot(overrides: Record<string, unknown> = {}) {
  return {
    x: 375,
    y: 375,
    speed: 0,
    health: 100,
    bodyOrientation: 0,
    bodyOrientationTarget: 0,
    bodyOrientationVelocity: 0,
    turretOrientation: 0,
    turretOrientationTarget: 0,
    turretOrientationVelocity: 0,
    radarOrientation: 0,
    radarOrientationTarget: 0,
    radarOrientationVelocity: 0,
    speedTarget: 0,
    speedAcceleration: 1,
    speedMax: 10,
    bullets: [] as Record<string, unknown>[],
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const sim = (bots: unknown[], w = 750, h = 750) =>
  simulate(0, [{ bots }] as any, w, h);

describe('simulate — movement', () => {
  it('advances a bot along its orientation when inside the arena', () => {
    const bot = makeBot({ speed: 10 });
    sim([bot]);
    expect(bot.x).toBeCloseTo(375);
    expect(bot.y).toBeCloseTo(385);
  });

  it('does not move a bot that would leave the arena', () => {
    const bot = makeBot({ x: 20, speed: 10, bodyOrientation: 90 });
    sim([bot]);
    expect(bot.x).toBe(20);
    expect(bot.y).toBe(375);
  });

  it('snaps to speedTarget within one acceleration step', () => {
    const bot = makeBot({ speed: 9, speedTarget: 10, speedAcceleration: 2 });
    sim([bot]);
    expect(bot.speed).toBe(10);
  });

  it('clamps speed to speedMax', () => {
    const bot = makeBot({
      speed: 9,
      speedTarget: 100,
      speedAcceleration: 5,
      speedMax: 10,
    });
    sim([bot]);
    expect(bot.speed).toBe(10);
  });
});

describe('simulate — rotation', () => {
  it('rotates toward the target by the rotational velocity', () => {
    const bot = makeBot({
      bodyOrientation: 0,
      bodyOrientationTarget: 90,
      bodyOrientationVelocity: 10,
    });
    sim([bot]);
    expect(bot.bodyOrientation).toBeCloseTo(10);
  });

  it('does not overshoot when the remaining angle is below the velocity', () => {
    const bot = makeBot({
      bodyOrientation: 0,
      bodyOrientationTarget: 5,
      bodyOrientationVelocity: 10,
    });
    sim([bot]);
    expect(bot.bodyOrientation).toBeCloseTo(5);
  });

  it('keeps the rotated angle in [0, 360) when turning backward past 0', () => {
    const bot = makeBot({
      bodyOrientation: 0,
      bodyOrientationTarget: 270,
      bodyOrientationVelocity: 10,
    });
    sim([bot]);
    // shortest path is counter-clockwise (-10), normalized to 350
    expect(bot.bodyOrientation).toBeCloseTo(350);
  });
});

describe('simulate — bullets', () => {
  it('moves live bullets and leaves exploded ones in place', () => {
    const live = {
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      explodedAt: undefined,
    };
    const exploded = {
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      explodedAt: 5,
    };
    const bot = makeBot({ bullets: [live, exploded] });
    sim([bot]);
    expect(live.y).toBeCloseTo(380);
    expect(exploded.y).toBe(375);
  });

  it('still advances bullets owned by a destroyed bot', () => {
    const bullet = {
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      explodedAt: undefined,
    };
    const bot = makeBot({ health: 0, speed: 10, bullets: [bullet] });
    sim([bot]);
    expect(bot.y).toBe(375); // dead bot does not move
    expect(bullet.y).toBeCloseTo(380); // its bullet still does
  });
});

describe('simulate — path trail', () => {
  // By design the trail records only turn vertices, not every step: a bot
  // driving straight (orientation === target) leaves no breadcrumbs.
  it('records nothing while driving straight', () => {
    const bot = makeBot({ speed: 10 }); // orientation 0 === target 0
    sim([bot]);
    expect(bot.path).toBeUndefined();
    expect(bot.pathIndex).toBeUndefined();
  });

  it('records a point while turning', () => {
    // Still rotating toward the target → a vertex is recorded (at the
    // post-move position, which used the pre-rotation heading of 0 → +y).
    const bot = makeBot({
      speed: 10,
      bodyOrientationTarget: 90,
      bodyOrientationVelocity: 10,
    });
    sim([bot]);
    expect(bot.pathIndex).toBe(1);
    expect(bot.path?.[0]).toMatchObject({ x: 375, y: 385 });
  });

  it('dedups an unchanged position while still turning', () => {
    const bot = makeBot({
      speed: 0, // stays in place
      bodyOrientationTarget: 90,
      bodyOrientationVelocity: 1, // still turning after one step
    });
    sim([bot]);
    sim([bot]);
    expect(bot.pathIndex).toBe(1); // one vertex, then deduped
  });

  it('wraps the dedup read at index 0 instead of reading path[-1]', () => {
    // A turning, stationary bot whose current position already sits in the
    // *last* buffer slot. With the positive-modulo read, (0 - 1 + len) % len
    // wraps to that tail slot and dedups (no new point). The old
    // `pathIndex - (1 % len)` read path[-1] (undefined) and recorded a dup.
    const bot = makeBot({
      speed: 0,
      bodyOrientation: 10,
      bodyOrientationTarget: 90,
      bodyOrientationVelocity: 1,
      path: [undefined, undefined, { x: 375, y: 375, time: 0 }],
      pathIndex: 0,
    });
    sim([bot]);
    expect(bot.pathIndex).toBe(0); // deduped via the wrap, not incremented
  });
});
