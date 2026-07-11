import { describe, it, expect, vi } from 'vitest';
import Simulation from '../src/util/simulation';
import { Event } from '../src/types/event';

// Simulation → Environment → AppService runs a CREATE TABLE query at import; stub
// the pool so importing it here doesn't reach for a real Postgres (these tests
// drive mock envs and never touch the database).
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

// Simulation.run only reads/writes plain bot fields and invokes
// bot.handlers[...] functions, so we can drive the real physics with
// lightweight mock bots (no isolates). Angles are in degrees; 0° points
// "down" (+y), so a bot at orientation 0 moving at speed s advances +s in y.

function makeBot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'bot',
    health: 100,
    appCrashed: false,
    needsStarting: false,
    codeLoaded: true,
    handlers: {} as Record<string, (arg?: unknown) => void>,
    x: 375,
    y: 375,
    speed: 0,
    speedTarget: 0,
    speedAcceleration: 1,
    speedMax: 10,
    orientation: 0,
    orientationTarget: 0,
    orientationVelocity: 0,
    stats: {
      timesCollided: 0,
      timesHit: 0,
      shotsHit: 0,
      distanceTraveled: 0,
    },
    logger: { trace: vi.fn() },
    bullets: [] as Record<string, unknown>[],
    turret: {
      loaded: 100,
      orientation: 0,
      orientationTarget: 0,
      orientationVelocity: 0,
      radar: {
        charged: 100,
        orientation: 0,
        orientationTarget: 0,
        orientationVelocity: 0,
      },
    },
    timers: { intervalMap: {}, timerMap: {} },
    ...overrides,
  };
}

function makeProcess(appId: string, bots: unknown[]) {
  return { getAppId: () => appId, bots };
}

function makeEnv(
  processes: unknown[],
  { time = 0, width = 750, height = 750 } = {}
) {
  return {
    emit: vi.fn(),
    getTime: () => time,
    getProcesses: () => processes,
    getArena: () => ({ getWidth: () => width, getHeight: () => height }),
  };
}

const run = (env: ReturnType<typeof makeEnv>) =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Simulation.run(env as any);

describe('Simulation.run — movement', () => {
  it('advances a bot along its orientation (0° = +y)', () => {
    const bot = makeBot({ speed: 10, speedTarget: 10, speedMax: 10 });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.x).toBeCloseTo(375);
    expect(bot.y).toBeCloseTo(385);
    expect(bot.stats.distanceTraveled).toBe(10);
  });

  it('accelerates toward speedTarget using pre-acceleration speed for the step', () => {
    const bot = makeBot({ speed: 0, speedTarget: 10, speedAcceleration: 2 });
    run(makeEnv([makeProcess('a', [bot])]));
    // moved with speed 0 (no displacement), then accelerated by 2
    expect(bot.y).toBeCloseTo(375);
    expect(bot.speed).toBe(2);
  });

  it('snaps to speedTarget within one acceleration step', () => {
    const bot = makeBot({ speed: 9, speedTarget: 10, speedAcceleration: 2 });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.speed).toBe(10);
  });

  it('clamps speed to speedMax', () => {
    const bot = makeBot({
      speed: 9,
      speedTarget: 100,
      speedAcceleration: 5,
      speedMax: 10,
    });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.speed).toBe(10);
  });
});

describe('Simulation.run — rotation', () => {
  it('rotates the body toward its target by the rotational velocity', () => {
    const bot = makeBot({
      orientation: 0,
      orientationTarget: 90,
      orientationVelocity: 10,
    });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.orientation).toBeCloseTo(10);
  });

  it('recharges the turret and radar each tick', () => {
    const bot = makeBot();
    bot.turret.loaded = 90;
    bot.turret.radar.charged = 80;
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.turret.loaded).toBe(92);
    expect(bot.turret.radar.charged).toBe(90);
  });
});

describe('Simulation.run — collisions', () => {
  it('stops the bot and applies damage at the arena boundary', () => {
    const collided = vi.fn();
    const bot = makeBot({ x: 10, handlers: { [Event.COLLIDED]: collided } });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(collided).toHaveBeenCalledWith({ angle: 0 });
    expect(bot.health).toBe(99);
    expect(bot.speed).toBe(0);
    expect(bot.x).toBe(10); // movement not applied on collision
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botStop' })
    );
  });

  it('fires COLLIDED on two bots that overlap, flagging friendly teams', () => {
    const c1 = vi.fn();
    const c2 = vi.fn();
    const t1 = makeBot({
      id: '1',
      x: 375,
      y: 375,
      handlers: { [Event.COLLIDED]: c1 },
    });
    const t2 = makeBot({
      id: '2',
      x: 385,
      y: 375,
      handlers: { [Event.COLLIDED]: c2 },
    });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(c1).toHaveBeenCalledWith(
      expect.objectContaining({ friendly: true })
    );
    expect(c2).toHaveBeenCalled();
    expect(t1.stats.timesCollided).toBeGreaterThan(0);
  });
});

describe('Simulation.run — bullets', () => {
  it('damages a bot hit by an enemy bullet and explodes the bullet', () => {
    const hit = vi.fn();
    const target = makeBot({
      id: 'a',
      x: 375,
      y: 375,
      handlers: { [Event.HIT]: hit },
    });
    const bullet = {
      id: 'b1',
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 365 },
      callback: vi.fn(),
    };
    const shooter = makeBot({ id: 'b', x: 375, y: 300, bullets: [bullet] });
    const env = makeEnv([
      makeProcess('a', [target]),
      makeProcess('b', [shooter]),
    ]);
    run(env);
    expect(target.health).toBe(75);
    expect(hit).toHaveBeenCalledTimes(1);
    expect(bullet.exploded).toBe(true);
    expect(target.stats.timesHit).toBe(1);
    expect(shooter.stats.shotsHit).toBe(1);
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'bulletExploded', id: 'b1' })
    );
  });

  it('moves a live bullet along its orientation', () => {
    const bullet = {
      id: 'b1',
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 375 },
    };
    const bot = makeBot({ bullets: [bullet] });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bullet.x).toBeCloseTo(375);
    expect(bullet.y).toBeCloseTo(380);
  });

  it('removes a bullet that leaves the arena', () => {
    const bullet = {
      id: 'b1',
      x: 375,
      y: 800, // already past the height + 32 margin
      speed: 0,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 375 },
      callback: vi.fn(),
    };
    const bot = makeBot({ bullets: [bullet] });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(bot.bullets).toHaveLength(0);
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'bulletRemoved', id: 'b1' })
    );
  });

  it('penalizes the shooter 3 health when its bullet leaves the arena', () => {
    const bullet = {
      id: 'b1',
      x: 375,
      y: 800, // already past the height + 32 margin
      speed: 0,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 375 },
      callback: vi.fn(),
    };
    const bot = makeBot({ id: 'a', health: 100, bullets: [bullet] });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(bot.health).toBe(97);
    expect(bullet.callback).toHaveBeenCalledWith({});
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botDamaged', id: 'a', health: 97 })
    );
  });
});

describe('Simulation.run — lifecycle', () => {
  it('kills a bot whose bot code crashed', () => {
    const bot = makeBot({ appCrashed: true });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(bot.health).toBe(0);
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botDamaged', health: 0 })
    );
  });

  it('runs the START handler exactly once', () => {
    const start = vi.fn();
    const bot = makeBot({
      needsStarting: true,
      handlers: { [Event.START]: start },
    });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    run(env);
    expect(start).toHaveBeenCalledTimes(1);
    expect(bot.needsStarting).toBe(false);
  });

  it('runs START before the first TICK: a just-started bot skips TICK that tick', () => {
    const calls: string[] = [];
    const bot = makeBot({
      needsStarting: true,
      handlers: {
        [Event.START]: () => calls.push('start'),
        [Event.TICK]: () => calls.push('tick'),
      },
    });
    const env = makeEnv([makeProcess('a', [bot])]);

    run(env);
    // START ran; TICK deferred so it can't race ahead of (async) START.
    expect(calls).toEqual(['start']);

    run(env);
    // From the next tick on, TICK fires normally.
    expect(calls).toEqual(['start', 'tick']);
  });

  it('does not defer TICK for a bot with no START handler', () => {
    const tick = vi.fn();
    const bot = makeBot({
      needsStarting: true,
      handlers: { [Event.TICK]: tick },
    });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    // Nothing to start first, so TICK fires immediately on the first tick.
    expect(tick).toHaveBeenCalledTimes(1);
    expect(bot.needsStarting).toBe(false);
  });

  it('does not start or tick a bot whose code has not loaded yet', () => {
    // Reproduces the addApp race: a bot placed in an already-running arena is
    // ticked before execute() has registered its handlers. needsStarting must
    // NOT be consumed, or START is skipped forever and TICK runs first.
    const calls: string[] = [];
    const bot = makeBot({
      needsStarting: true,
      codeLoaded: false,
      handlers: {
        [Event.START]: () => calls.push('start'),
        [Event.TICK]: () => calls.push('tick'),
      },
    });
    const env = makeEnv([makeProcess('a', [bot])]);

    run(env);
    // Code not loaded: neither handler ran, and the start is still pending.
    expect(calls).toEqual([]);
    expect(bot.needsStarting).toBe(true);

    // Code finishes loading (execute() resolves).
    bot.codeLoaded = true;
    run(env);
    // START now runs first, and TICK is deferred to the following tick.
    expect(calls).toEqual(['start']);
    expect(bot.needsStarting).toBe(false);

    run(env);
    expect(calls).toEqual(['start', 'tick']);
  });
});
