import { describe, it, expect, vi } from 'vitest';

// bot.ts transitively imports appService -> util/db, which runs CREATE TABLE
// at import time. Mock the db pool so importing the real Bot/BotTurret/
// BotRadar classes doesn't try to reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Bot, { waitUntil } from '../src/types/bot';
import Environment, { DEPLOY_TICKS } from '../src/types/environment';
import Arena from '../src/types/arena';
import { normalizeAngle } from '../src/util/geometry';
import { Event } from '../src/types/event';

// Build a real Bot backed by a mock environment. isRunning() returns false so
// the waitUntil-based movement methods settle (reject) immediately instead of
// leaving polling timers running across tests.
function makeRealBot() {
  const emit = vi.fn();
  const proc = {
    bots: [] as unknown[],
    getAppId: () => 'app1',
    getSandbox: () => ({}),
  };
  let clock = 0;
  const env = {
    getArena: () => ({ getWidth: () => 750, getHeight: () => 750 }),
    getProcesses: () => [proc],
    getTime: () => clock,
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
  const bot = new Bot(env as any, proc as any);
  bot.logger = {
    trace: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  };
  // The constructor randomizes position/orientation; pin them for determinism.
  bot.x = 100;
  bot.y = 100;
  bot.orientation = 0;
  bot.orientationTarget = 0;
  bot.turret.orientation = 0;
  bot.turret.orientationTarget = 0;
  bot.turret.radar.orientation = 0;
  bot.turret.radar.orientationTarget = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    bot,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    env: env as any,
    proc,
    emit,
    setTime: (t: number) => {
      clock = t;
    },
  };
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

describe('Bot', () => {
  it('turn() sets the target angle and emits botTurn', async () => {
    const { bot, emit } = makeRealBot();
    const p = bot.turn(90);
    expect(bot.orientationTarget).toBe(90);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({
        type: 'botTurn',
        bodyOrientationTarget: 90,
      })
    );
    await expect(p).rejects.toBe('Turn cancelled');
  });

  it('setSpeed() clamps to speedMax and emits botAccelerate', async () => {
    const { bot, emit } = makeRealBot();
    const p = bot.setSpeed(1000);
    expect(bot.speedTarget).toBe(bot.speedMax);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botAccelerate' })
    );
    await expect(p).rejects.toBe('Speed change cancelled');
  });

  it('setSpeed() to the current target is a no-op (no event)', async () => {
    const { bot, emit } = makeRealBot();
    await expect(bot.setSpeed(0)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('getOrientation() returns integer degrees (floored)', () => {
    const { bot } = makeRealBot();
    bot.orientation = 90.9;
    expect(bot.getOrientation()).toBe(90);
  });

  it('isTurning() reflects whether orientation has reached its target', () => {
    const { bot } = makeRealBot();
    expect(bot.isTurning()).toBe(false);
    bot.orientationTarget = 45;
    expect(bot.isTurning()).toBe(true);
  });

  it('send() delivers an integer message to other living bots', () => {
    const { bot, env } = makeRealBot();
    const received = vi.fn();
    const other = {
      id: 'other',
      health: 100,
      x: 100,
      y: 200, // 100 units from the sender at (100, 100)
      stats: { messagesReceived: 0 },
      handlers: { [Event.RECEIVED]: received },
    };
    env.getProcesses = () => [{ bots: [bot, other] }];
    bot.send(7);
    // The payload, plus the sender's distance (a range, not a bearing).
    expect(received).toHaveBeenCalledWith(7, { distance: 100 });
    expect(other.stats.messagesReceived).toBe(1);
    expect(bot.stats.messagesSent).toBe(1);
  });

  it('send() also delivers a structured (object) message', () => {
    const { bot, env } = makeRealBot();
    const received = vi.fn();
    const other = {
      id: 'other',
      health: 100,
      x: 130,
      y: 140, // 50 units from the sender at (100, 100)
      stats: { messagesReceived: 0 },
      handlers: { [Event.RECEIVED]: received },
    };
    env.getProcesses = () => [{ bots: [bot, other] }];
    const msg = { secret: 8, x: 1, y: 2 };
    bot.send(msg);
    expect(received).toHaveBeenCalledWith(msg, { distance: 50 });
  });

  it('getHealth() returns health on a 0–100 scale', () => {
    const { bot } = makeRealBot();
    expect(bot.getHealth()).toBe(100); // default health
    bot.health = 50;
    expect(bot.getHealth()).toBe(50);
  });
});

describe('BotTurret', () => {
  it('fire() rejects when not loaded', async () => {
    const { bot } = makeRealBot();
    bot.turret.loaded = 50;
    await expect(bot.turret.fire()).rejects.toBe('Turret not ready');
  });

  it('fire() spawns a bullet, resets load, and emits bulletFired', () => {
    const { bot, emit, setTime } = makeRealBot();
    setTime(DEPLOY_TICKS); // past the deployment window so the turret is live
    bot.turret.loaded = 100;
    bot.turret.orientation = 30;
    const fired = vi.fn();
    bot.handlers[Event.FIRED] = fired;

    bot.turret.fire();

    expect(bot.bullets).toHaveLength(1);
    const bullet = bot.bullets[0];
    expect(bullet.speed).toBe(25);
    expect(bullet.x).toBe(bot.x);
    expect(bullet.y).toBe(bot.y);
    expect(bullet.orientation).toBe(30); // bot.getOrientation() (0) + turret 30
    expect(bot.turret.loaded).toBe(0);
    expect(bot.stats.shotsFired).toBe(1);
    expect(fired).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'bulletFired' })
    );
  });

  it('isReady()/onReady() track the loaded state', async () => {
    const { bot, setTime } = makeRealBot();
    setTime(DEPLOY_TICKS); // past the deployment window
    bot.turret.loaded = 100;
    expect(bot.turret.isReady()).toBe(true);
    await expect(bot.turret.onReady()).resolves.toBeUndefined();
  });

  it('stays weapons-held during the deployment window even when loaded', async () => {
    const { bot, setTime } = makeRealBot();
    bot.turret.loaded = 100;
    // Inside the deployment window (time 0 < DEPLOY_TICKS): a fully loaded turret
    // still reads not-ready and refuses to fire — so no bullet exists in warm-up.
    expect(bot.turret.isReady()).toBe(false);
    await expect(bot.turret.fire()).rejects.toBe('Turret not ready');
    expect(bot.bullets).toHaveLength(0);
    // Once the window passes, the same loaded turret is live.
    setTime(DEPLOY_TICKS);
    expect(bot.turret.isReady()).toBe(true);
  });

  it('turn() sets the turret target and emits turretTurn', async () => {
    const { bot, emit } = makeRealBot();
    const p = bot.turret.turn(90);
    expect(bot.turret.orientationTarget).toBe(90);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'turretTurn' })
    );
    await expect(p).rejects.toBeDefined();
  });
});

describe('BotRadar.scan', () => {
  function enemy(overrides: Record<string, unknown> = {}) {
    return {
      id: 'enemy',
      health: 100,
      x: 100,
      y: 200, // directly "ahead" (0°) of a bot at (100,100)
      speed: 3,
      getOrientation: () => 45,
      handlers: {} as Record<string, () => void>,
      stats: { timesDetected: 0 },
      ...overrides,
    };
  }
  const withEnemies = (
    env: { getProcesses: () => unknown[] },
    bots: unknown[],
    appId = 'enemyApp'
  ) => {
    env.getProcesses = () => [{ getAppId: () => appId, bots }];
  };

  it('rejects when the radar is not charged', async () => {
    const { bot } = makeRealBot();
    bot.turret.radar.charged = 50;
    await expect(bot.turret.radar.scan()).rejects.toBe('Radar not ready');
  });

  it('detects an enemy within range and within the radar cone', async () => {
    const { bot, env, emit } = makeRealBot();
    bot.turret.radar.charged = 100;
    const target = enemy({ handlers: { [Event.DETECTED]: vi.fn() } });
    const scanned = vi.fn();
    bot.handlers[Event.SCANNED] = scanned;
    withEnemies(env, [target]);

    const found = await bot.turret.radar.scan();

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      id: 'enemy',
      friendly: false,
      distance: 100,
      health: target.health,
    });
    expect(target.stats.timesDetected).toBe(1);
    expect(target.handlers[Event.DETECTED]).toHaveBeenCalled();
    expect(scanned).toHaveBeenCalledWith(found);
    expect(bot.stats.scansCompleted).toBe(1);
    expect(bot.turret.radar.charged).toBe(0);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarScan' })
    );
  });

  it('ignores an enemy out of range', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 700 })]); // distance 600 > 300
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('ignores an enemy outside the radar cone', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 0 })]); // behind (180° off)
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('flags detections from the same app as friendly', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    withEnemies(env, [enemy()], 'app1'); // same appId as the bot's process
    const found = await bot.turret.radar.scan();
    expect(found[0].friendly).toBe(true);
  });
});
