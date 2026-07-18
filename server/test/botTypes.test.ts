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
  MAX_COMMANDS_PER_TICK,
  BOT_MAX_SPEED,
} from '../src/types/bot';
import Environment, { DEPLOY_TICKS } from '../src/types/environment';
import Arena from '../src/types/arena';
import { normalizeAngle } from '../src/util/geometry';
import { Event } from '../src/types/event';
import { logger, LogEvent } from '../src/util/logger';

// Build a real Bot backed by a mock environment. isRunning() returns false so
// the waitUntil-based movement methods settle (reject) immediately instead of
// leaving polling timers running across tests.
function makeRealBot() {
  const emit = vi.fn();
  const faults: Record<string, unknown>[] = [];
  const proc = {
    appId: 'app1',
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
    // Capture structured faults (mirrors Environment.reportFault) so tests can
    // assert the command-budget fault path.
    reportFault: (fault: Record<string, unknown>) => {
      faults.push(fault);
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
    faults,
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
    // The radarScan event carries the detected ids so the debug view can draw
    // scanner→target lines; here that's the one enemy just found.
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarScan', detected: ['enemy'] })
    );
  });

  it('emits an empty detected list when the scan finds nothing', async () => {
    const { bot, env, emit } = makeRealBot();
    bot.turret.radar.charged = 100;
    withEnemies(env, [enemy({ x: 100, y: 750 })]); // out of range → no hits

    await expect(bot.turret.radar.scan()).resolves.toHaveLength(0);
    expect(emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'radarScan', detected: [] })
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

// R2 hardening: bot code is untrusted and weakly typed, so a non-finite numeric
// argument (NaN / Infinity / a passed object) must never reach the shared physics
// — otherwise it can drive this bot's x/y to NaN and propagate through the
// collision math into other bots, corrupting the whole arena. Every numeric
// command coerces then finite-guards its argument (see finiteArg in bot.ts),
// treating a non-finite value as a no-op that leaves the target unchanged.
describe('non-finite command arguments are rejected before reaching physics', () => {
  // Each case: the setter, the target field it must NOT corrupt, and a known-good
  // value to prove the guard only blocks the non-finite path (not all input).
  const cases: Array<{
    name: string;
    call: (bot: Bot, d: unknown) => Promise<unknown>;
    target: (bot: Bot) => number;
    good: number;
    goodTarget: number;
  }> = [
    {
      name: 'bot.setSpeed',
      call: (bot, d) => bot.setSpeed(d as number),
      target: (bot) => bot.speedTarget,
      good: 3,
      goodTarget: 3,
    },
    {
      name: 'bot.turn',
      call: (bot, d) => bot.turn(d as number),
      target: (bot) => bot.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
    {
      name: 'bot.setOrientation',
      call: (bot, d) => bot.setOrientation(d as number),
      target: (bot) => bot.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
    {
      name: 'bot.turret.turn',
      call: (bot, d) => bot.turret.turn(d as number),
      target: (bot) => bot.turret.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
    {
      name: 'bot.turret.setOrientation',
      call: (bot, d) => bot.turret.setOrientation(d as number),
      target: (bot) => bot.turret.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
    {
      name: 'bot.turret.radar.turn',
      call: (bot, d) => bot.turret.radar.turn(d as number),
      target: (bot) => bot.turret.radar.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
    {
      name: 'bot.turret.radar.setOrientation',
      call: (bot, d) => bot.turret.radar.setOrientation(d as number),
      target: (bot) => bot.turret.radar.orientationTarget,
      good: 90,
      goodTarget: 90,
    },
  ];

  // Values that coerce to a non-finite number (Number(x) is NaN/±Infinity) and so
  // must be blocked. Note null/[]/'' coerce to a finite 0 and are intentionally
  // NOT here — a null speed is a harmless "stop", not arena-poisoning.
  const nonFinite: Array<[string, unknown]> = [
    ['NaN', NaN],
    ['Infinity', Infinity],
    ['-Infinity', -Infinity],
    ['an object', {}],
    ['a non-numeric string', 'fast'],
    ['undefined', undefined],
  ];

  for (const c of cases) {
    for (const [label, bad] of nonFinite) {
      it(`${c.name}(${label}) is a no-op that resolves and leaves the target unchanged`, async () => {
        const { bot } = makeRealBot();
        const before = c.target(bot);
        // Resolves (does not reject) and never mutates the target.
        await expect(c.call(bot, bad)).resolves.toBeUndefined();
        expect(c.target(bot)).toBe(before);
        // NaN in particular must not have silently poisoned the field.
        expect(Number.isNaN(c.target(bot))).toBe(false);
      });
    }

    it(`${c.name} still applies a finite argument (guard is not over-broad)`, async () => {
      const { bot } = makeRealBot();
      // isRunning() is false in the harness, so a real change settles (rejects)
      // immediately — but the target is set synchronously first, which is what we
      // assert. The rejection is expected and swallowed.
      c.call(bot, c.good).catch(() => undefined);
      expect(c.target(bot)).toBe(c.goodTarget);
    });

    it(`${c.name} accepts a numeric string (backward-compatible coercion)`, async () => {
      const { bot } = makeRealBot();
      c.call(bot, String(c.good)).catch(() => undefined);
      expect(c.target(bot)).toBe(c.goodTarget);
    });
  }
});

// Per-bot per-tick command budget (GitHub #293, replacing the #292 per-arena
// queue cap): every command entry point charges the issuing bot's own budget,
// and exceeding it FAULTS that bot (appCrashed + an E026 on the fault feed) —
// so flooding is self-defeating, and a flooder structurally cannot consume an
// opponent's command capacity the way the shared per-arena cap allowed.
describe('per-bot per-tick command budget (E026)', () => {
  const floodLogs = (warn: { mock: { calls: unknown[][] } }) =>
    warn.mock.calls.filter(
      (c) => (c[0] as { event?: string })?.event === LogEvent.BOT_COMMAND_FLOOD
    );

  it('faults the bot with E026 when the budget is exceeded, once', async () => {
    const { bot, faults } = makeRealBot();
    const warn = vi.spyOn(logger, 'warn').mockReturnValue(undefined as never);
    try {
      // Exactly at the budget: fine. Each call settles (rejects as cancelled by
      // the stopped harness env) or no-ops; both charge the budget.
      for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++)
        bot.turn(1).catch(() => undefined);
      expect(bot.appCrashed).toBe(false);
      expect(faults).toHaveLength(0);

      // One past the budget: the command rejects with E026 and the bot faults.
      await expect(bot.turn(1)).rejects.toMatch('E026');
      expect(bot.appCrashed).toBe(true);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toMatchObject({
        code: 'E026',
        kind: 'command-flood',
        appId: 'app1',
        botId: bot.id,
      });

      // Further over-budget calls keep rejecting, but the fault and the
      // structured abuse log are single-shot (the bot is already dead).
      await expect(bot.setSpeed(3)).rejects.toMatch('E026');
      expect(faults).toHaveLength(1);
      const logs = floodLogs(warn);
      expect(logs).toHaveLength(1);
      expect(logs[0][0]).toMatchObject({
        event: LogEvent.BOT_COMMAND_FLOOD,
        appId: 'app1',
        botId: bot.id,
      });
    } finally {
      warn.mockRestore();
    }
  });

  it('resets the counter when the clock advances (budget is per tick)', () => {
    const { bot, faults, setTime } = makeRealBot();
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++)
      bot.turn(1).catch(() => undefined);
    setTime(1);
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++)
      bot.turn(1).catch(() => undefined);
    expect(bot.appCrashed).toBe(false);
    expect(faults).toHaveLength(0);
  });

  it('turret and radar commands draw from the same per-bot budget', async () => {
    const { bot, faults } = makeRealBot();
    const commands = [
      () => bot.turn(1),
      () => bot.turret.turn(1),
      () => bot.turret.radar.turn(1),
      () => bot.setSpeed(2),
    ];
    for (let i = 0; i < MAX_COMMANDS_PER_TICK; i++)
      commands[i % commands.length]().catch(() => undefined);

    // The over-budget call is charged at entry — before any readiness check —
    // so it rejects with E026 rather than 'Radar not ready'.
    await expect(bot.turret.radar.scan()).rejects.toMatch('E026');
    expect(bot.appCrashed).toBe(true);
    expect(faults).toHaveLength(1);
  });

  it("a flooding bot cannot consume another bot's capacity (per-bot isolation)", async () => {
    const { bot: flooder, env, faults } = makeRealBot();
    // A second bot from a different app sharing the same environment — the
    // two-bots-one-arena shape the old per-arena cap starved.
    const proc2 = {
      appId: 'app2',
      bots: [] as unknown[],
      getAppId: () => 'app2',
      getSandbox: () => ({}),
    };
    const victim = new Bot(env, proc2 as any);
    victim.logger = {
      trace: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
    } as any;
    victim.orientation = 0;
    victim.orientationTarget = 0;

    for (let i = 0; i <= MAX_COMMANDS_PER_TICK; i++)
      flooder.turn(1).catch(() => undefined);
    expect(flooder.appCrashed).toBe(true);

    // The victim's command runs its normal path in the same tick — rejected as
    // cancelled by the stopped harness env, NOT with E026 — and only the
    // flooder was faulted.
    await expect(victim.turn(90)).rejects.toBe('Turn cancelled');
    expect(victim.appCrashed).toBe(false);
    expect(faults).toHaveLength(1);
    expect(faults[0].appId).toBe('app1');
  });
});
