import { describe, it, expect, vi } from 'vitest';

// tank.ts transitively imports appService -> util/db, which runs CREATE TABLE
// at import time. Mock the db pool so importing the real Tank/TankTurret/
// TankRadar classes doesn't try to reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Tank, { waitUntil } from '../src/types/tank';
import Environment from '../src/types/environment';
import Arena from '../src/types/arena';
import { normalizeAngle } from '../src/util/geometry';
import { Event } from '../src/types/event';

// Build a real Tank backed by a mock environment. isRunning() returns false so
// the waitUntil-based movement methods settle (reject) immediately instead of
// leaving polling timers running across tests.
function makeRealTank() {
  const emit = vi.fn();
  const proc = {
    tanks: [] as unknown[],
    getAppId: () => 'app1',
    getSandbox: () => ({}),
  };
  const env = {
    getArena: () => ({ getWidth: () => 750, getHeight: () => 750 }),
    getProcesses: () => [proc],
    getTime: () => 0,
    isRunning: () => false,
    random: () => 0.5,
    emit,
    // isRunning() is false, so every movement command's failure condition holds
    // and it settles (rejects) immediately at call time — matching the previous
    // wall-clock waitUntil behaviour without leaving a polling timer running.
    waitForCondition: (
      success: () => boolean,
      failure: (() => boolean) | null,
      msg: string | null
    ) =>
      new Promise<void>((resolve, reject) => {
        if (success()) return resolve();
        if (failure && failure()) return reject(msg ?? undefined);
      }),
    trackBotOp: (op: Promise<unknown>) => {
      void Promise.resolve(op).catch(() => undefined);
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tank = new Tank(env as any, proc as any);
  tank.logger = {
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
  // The constructor randomizes position/orientation; pin them for determinism.
  tank.x = 100;
  tank.y = 100;
  tank.orientation = 0;
  tank.orientationTarget = 0;
  tank.turret.orientation = 0;
  tank.turret.orientationTarget = 0;
  tank.turret.radar.orientation = 0;
  tank.turret.radar.orientationTarget = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { tank, env: env as any, proc, emit };
}

describe('normalizeAngle (util/geometry)', () => {
  it('wraps into [0, 360) without rounding', () => {
    expect(normalizeAngle(0)).toBe(0);
    expect(normalizeAngle(360)).toBe(0);
    expect(normalizeAngle(370)).toBe(10);
    expect(normalizeAngle(-10)).toBe(350);
    expect(normalizeAngle(90.9)).toBeCloseTo(90.9);
  });
});

describe('waitUntil (tick-driven via Environment)', () => {
  const makeEnv = () => new Environment(new Arena('arena1', 'user1'));

  it('resolves immediately when the success condition holds', async () => {
    await expect(waitUntil(makeEnv(), () => true)).resolves.toBeUndefined();
  });

  it('rejects with the message when the failure condition holds', async () => {
    await expect(
      waitUntil(
        makeEnv(),
        () => false,
        () => true,
        'nope'
      )
    ).rejects.toBe('nope');
  });

  it('settles on a later tick once the success condition becomes true', async () => {
    const env = makeEnv();
    let ready = false;
    const p = waitUntil(env, () => ready);

    // Not yet satisfied: settling this tick leaves it pending.
    expect(env.settlePendingCommands()).toBe(0);

    // The simulation reaches the awaited state; the next settle resolves it —
    // deterministically, independent of any wall-clock timer.
    ready = true;
    expect(env.settlePendingCommands()).toBe(1);
    await expect(p).resolves.toBeUndefined();
  });
});

describe('Tank', () => {
  it('turn() sets the target angle and emits tankTurn', async () => {
    const { tank, emit } = makeRealTank();
    const p = tank.turn(90);
    expect(tank.orientationTarget).toBe(90);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({
        type: 'tankTurn',
        bodyOrientationTarget: 90,
      })
    );
    await expect(p).rejects.toBe('Turn cancelled');
  });

  it('setSpeed() clamps to speedMax and emits tankAccelerate', async () => {
    const { tank, emit } = makeRealTank();
    const p = tank.setSpeed(1000);
    expect(tank.speedTarget).toBe(tank.speedMax);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'tankAccelerate' })
    );
    await expect(p).rejects.toBe('Speed change cancelled');
  });

  it('setSpeed() to the current target is a no-op (no event)', async () => {
    const { tank, emit } = makeRealTank();
    await expect(tank.setSpeed(0)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('getOrientation() returns integer degrees (floored)', () => {
    const { tank } = makeRealTank();
    tank.orientation = 90.9;
    expect(tank.getOrientation()).toBe(90);
  });

  it('isTurning() reflects whether orientation has reached its target', () => {
    const { tank } = makeRealTank();
    expect(tank.isTurning()).toBe(false);
    tank.orientationTarget = 45;
    expect(tank.isTurning()).toBe(true);
  });

  it('send() delivers an integer message to other living tanks', () => {
    const { tank, env } = makeRealTank();
    const received = vi.fn();
    const other = {
      id: 'other',
      health: 100,
      stats: { messagesReceived: 0 },
      handlers: { [Event.RECEIVED]: received },
    };
    env.getProcesses = () => [{ tanks: [tank, other] }];
    tank.send(7);
    expect(received).toHaveBeenCalledWith(7);
    expect(other.stats.messagesReceived).toBe(1);
    expect(tank.stats.messagesSent).toBe(1);
  });

  it('send() rejects a non-integer message', () => {
    const { tank } = makeRealTank();
    expect(() => tank.send(1.5)).toThrow();
  });

  it('getHealth() returns health on a 0–100 scale', () => {
    const { tank } = makeRealTank();
    expect(tank.getHealth()).toBe(100); // default health
    tank.health = 50;
    expect(tank.getHealth()).toBe(50);
  });
});

describe('TankTurret', () => {
  it('fire() rejects when not loaded', async () => {
    const { tank } = makeRealTank();
    tank.turret.loaded = 50;
    await expect(tank.turret.fire()).rejects.toBe('Turret not ready');
  });

  it('fire() spawns a bullet, resets load, and emits bulletFired', () => {
    const { tank, emit } = makeRealTank();
    tank.turret.loaded = 100;
    tank.turret.orientation = 30;
    const fired = vi.fn();
    tank.handlers[Event.FIRED] = fired;

    tank.turret.fire();

    expect(tank.bullets).toHaveLength(1);
    const bullet = tank.bullets[0];
    expect(bullet.speed).toBe(25);
    expect(bullet.x).toBe(tank.x);
    expect(bullet.y).toBe(tank.y);
    expect(bullet.orientation).toBe(30); // tank.getOrientation() (0) + turret 30
    expect(tank.turret.loaded).toBe(0);
    expect(tank.stats.shotsFired).toBe(1);
    expect(fired).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'bulletFired' })
    );
  });

  it('isReady()/onReady() track the loaded state', async () => {
    const { tank } = makeRealTank();
    tank.turret.loaded = 100;
    expect(tank.turret.isReady()).toBe(true);
    await expect(tank.turret.onReady()).resolves.toBeUndefined();
  });

  it('turn() sets the turret target and emits turretTurn', async () => {
    const { tank, emit } = makeRealTank();
    const p = tank.turret.turn(90);
    expect(tank.turret.orientationTarget).toBe(90);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'turretTurn' })
    );
    await expect(p).rejects.toBeDefined();
  });
});

describe('TankRadar.scan', () => {
  function enemy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'enemy',
      health: 100,
      x: 100,
      y: 200, // directly "ahead" (0°) of a tank at (100,100)
      speed: 3,
      getOrientation: () => 45,
      handlers: {} as Record<string, () => void>,
      stats: { timesDetected: 0 },
      ...overrides,
    };
  }
  const withEnemies = (
    env: { getProcesses: () => unknown[] },
    tanks: unknown[],
    appId = 'enemyApp'
  ) => {
    env.getProcesses = () => [{ getAppId: () => appId, tanks }];
  };

  it('rejects when the radar is not charged', async () => {
    const { tank } = makeRealTank();
    tank.turret.radar.charged = 50;
    await expect(tank.turret.radar.scan()).rejects.toBe('Radar not ready');
  });

  it('detects an enemy within range and within the radar cone', async () => {
    const { tank, env, emit } = makeRealTank();
    tank.turret.radar.charged = 100;
    const target = enemy({ handlers: { [Event.DETECTED]: vi.fn() } });
    const scanned = vi.fn();
    tank.handlers[Event.SCANNED] = scanned;
    withEnemies(env, [target]);

    const found = await tank.turret.radar.scan();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'enemy',
      friendly: false,
      distance: 100,
    });
    expect(target.stats.timesDetected).toBe(1);
    expect(target.handlers[Event.DETECTED]).toHaveBeenCalled();
    expect(scanned).toHaveBeenCalledWith(found);
    expect(tank.stats.scansCompleted).toBe(1);
    expect(tank.turret.radar.charged).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarScan' })
    );
  });

  it('ignores an enemy out of range', async () => {
    const { tank, env } = makeRealTank();
    tank.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 700 })]); // distance 600 > 300
    await expect(tank.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('ignores an enemy outside the radar cone', async () => {
    const { tank, env } = makeRealTank();
    tank.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 0 })]); // behind (180° off)
    await expect(tank.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('flags detections from the same app as friendly', async () => {
    const { tank, env } = makeRealTank();
    tank.turret.radar.charged = 100;
    withEnemies(env, [enemy()], 'app1'); // same appId as the tank's process
    const found = await tank.turret.radar.scan();
    expect(found[0].friendly).toBe(true);
  });
});
