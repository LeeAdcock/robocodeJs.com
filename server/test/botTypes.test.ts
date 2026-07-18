import { describe, it, expect, vi } from 'vitest';

// bot.ts transitively imports appService -> util/db, which runs CREATE TABLE
// at import time. Mock the db pool so importing the real Bot/BotTurret/
// BotRadar classes doesn't try to reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import Bot, {
  waitUntil,
  MAX_SENDS_PER_TICK,
  BOT_MAX_SPEED,
} from '../src/types/bot';
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
  return {
    bot,
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

  it('setSpeed() clamps to BOT_MAX_SPEED and emits botAccelerate', async () => {
    const { bot, emit } = makeRealBot();
    const p = bot.setSpeed(1000);
    expect(bot.speedTarget).toBe(BOT_MAX_SPEED);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botAccelerate' })
    );
    await expect(p).rejects.toBe('Speed change cancelled');
  });

  it('setSpeed() clamps below -BOT_MAX_SPEED (an unreachable target never settles)', async () => {
    const { bot, emit } = makeRealBot();
    // Already at full reverse: with the target clamped to -BOT_MAX_SPEED the
    // command is satisfied immediately. Unclamped, the -1000 target is
    // unreachable (the physics caps speed at ±BOT_MAX_SPEED) and the promise
    // could never resolve.
    bot.speed = -BOT_MAX_SPEED;
    const p = bot.setSpeed(-1000);
    expect(bot.speedTarget).toBe(-BOT_MAX_SPEED);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botAccelerate', speedTarget: -5 })
    );
    await expect(p).resolves.toBeUndefined();
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

  it('send() enforces a per-tick budget and resets it when the clock advances', () => {
    const { bot, env, setTime } = makeRealBot();
    const received = vi.fn();
    const other = {
      id: 'other',
      health: 100,
      x: 100,
      y: 200,
      stats: { messagesReceived: 0 },
      handlers: { [Event.RECEIVED]: received },
    };
    env.getProcesses = () => [{ bots: [bot, other] }];

    // Well past the cap, all in one tick (clock stays at 0).
    for (let i = 0; i < MAX_SENDS_PER_TICK + 10; i++) bot.send(i);

    // Only the budgeted sends are delivered / counted; the rest are dropped.
    expect(received).toHaveBeenCalledTimes(MAX_SENDS_PER_TICK);
    expect(bot.stats.messagesSent).toBe(MAX_SENDS_PER_TICK);
    // The author is warned exactly once for the window, not per dropped send.
    expect(bot.logger.warn).toHaveBeenCalledTimes(1);

    // Advancing the sim clock opens a fresh budget window.
    setTime(1);
    bot.send(999);
    expect(received).toHaveBeenCalledTimes(MAX_SENDS_PER_TICK + 1);
    expect(received).toHaveBeenLastCalledWith(999, { distance: 100 });
    expect(bot.stats.messagesSent).toBe(MAX_SENDS_PER_TICK + 1);
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
    withEnemies(env, [enemy({ x: 100, y: 750 })]); // distance 650 > 600
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('ignores an enemy outside the radar cone', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 0 })]); // behind (180° off)
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
  });

  // The detection beam: ±16 (one tank-width) at the bot flaring to ±122 at
  // 600 units. These pin its edges. The scanning bot sits at (100, 100)
  // facing 0° (internally +y), so "forward" is +y and "lateral" ±x.
  it('detects a point-blank enemy within the one-tank-wide beam base', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    // forward 10, lateral 14 — inside the ~±17.8 half-width at that depth
    // (the old angular cone would have missed a 54°-off adjacent bot).
    withEnemies(env, [enemy({ x: 114, y: 110 })]);
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(1);
  });

  it('ignores a point-blank enemy just outside the beam base', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    // forward 10, lateral 24 — outside the ~±17.8 half-width at that depth.
    withEnemies(env, [enemy({ x: 124, y: 110 })]);
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
  });

  it('detects a distant enemy inside the widened beam tip', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    // forward 500, lateral 100 — inside the ~±104 half-width at that depth.
    withEnemies(env, [enemy({ x: 200, y: 600 })]);
    await expect(bot.turret.radar.scan()).resolves.toHaveLength(1);
  });

  it('ignores a distant enemy outside the beam sides', async () => {
    const { bot, env } = makeRealBot();
    bot.turret.radar.charged = 100;
    // forward 500, lateral 160 — outside the ~±104 half-width at that depth.
    withEnemies(env, [enemy({ x: 260, y: 600 })]);
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

describe('BotRadar orientation & charge', () => {
  it('setOrientation() sets the absolute target and emits radarTurn', async () => {
    const { bot, emit } = makeRealBot();
    const p = bot.turret.radar.setOrientation(90);
    expect(bot.turret.radar.orientationTarget).toBe(90);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarTurn', radarOrientationTarget: 90 })
    );
    // isRunning() is false in the mock env, so the turn is cancelled at once.
    await expect(p).rejects.toBeDefined();
  });

  it('setOrientation() to the current target is a no-op (no event)', async () => {
    const { bot, emit } = makeRealBot();
    // The radar target is pinned to 0 in makeRealBot.
    await expect(bot.turret.radar.setOrientation(0)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('turn() rotates relative to the current orientation and emits radarTurn', async () => {
    const { bot, emit } = makeRealBot();
    bot.turret.radar.orientation = 30;
    const p = bot.turret.radar.turn(90); // 30 + 90 = 120
    expect(bot.turret.radar.orientationTarget).toBe(120);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarTurn' })
    );
    await expect(p).rejects.toBeDefined();
  });

  it('turn() by a full revolution lands on the same target (no-op, no event)', async () => {
    const { bot, emit } = makeRealBot();
    await expect(bot.turret.radar.turn(360)).resolves.toBeUndefined();
    expect(emit).not.toHaveBeenCalled();
  });

  it('getOrientation() returns integer degrees (floored, normalized)', () => {
    const { bot } = makeRealBot();
    bot.turret.radar.orientation = 90.9;
    expect(bot.turret.radar.getOrientation()).toBe(90);
    bot.turret.radar.orientation = -10;
    expect(bot.turret.radar.getOrientation()).toBe(350);
  });

  it('isTurning() reflects whether the radar has reached its target', () => {
    const { bot } = makeRealBot();
    expect(bot.turret.radar.isTurning()).toBe(false);
    bot.turret.radar.orientationTarget = 45;
    expect(bot.turret.radar.isTurning()).toBe(true);
  });

  it('isReady()/onReady() resolve once the radar is fully charged', async () => {
    const { bot } = makeRealBot();
    bot.turret.radar.charged = 100;
    expect(bot.turret.radar.isReady()).toBe(true);
    await expect(bot.turret.radar.onReady()).resolves.toBeUndefined();
  });

  it('onReady() rejects while uncharged and the sim is stopped', async () => {
    const { bot } = makeRealBot();
    bot.turret.radar.charged = 50;
    expect(bot.turret.radar.isReady()).toBe(false);
    await expect(bot.turret.radar.onReady()).rejects.toBe(
      'Radar already scanned'
    );
  });
});
