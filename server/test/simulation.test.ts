import { describe, it, expect, vi } from 'vitest';
import Simulation, { applyEliminations } from '../src/util/simulation';
import { BotStats } from '../src/types/botStats';
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
    // A real BotStats rather than a hand-listed subset, so a counter added to the
    // class can never leave the mock short a field (an absent one would silently
    // turn `stats.x += n` into NaN here instead of failing).
    stats: new BotStats(),
    eliminatedAt: null as number | null,
    lastDamagedBy: null as unknown,
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

const run = (env: ReturnType<typeof makeEnv>) => Simulation.run(env as any);

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
    expect(bot.turret.loaded).toBe(92.5);
    expect(bot.turret.radar.charged).toBe(90);
  });
});

describe('Simulation.run — collisions', () => {
  it('stops the bot and applies damage at the arena boundary', () => {
    const collided = vi.fn();
    // Against the west wall, facing south (orientation 0): the wall is 90° off
    // the heading. COLLIDED omits `friendly` for a wall (it isn't a bot).
    const bot = makeBot({ x: 10, handlers: { [Event.COLLIDED]: collided } });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(collided).toHaveBeenCalledWith({ angle: 90 });
    expect(collided.mock.calls[0][0]).not.toHaveProperty('friendly');
    expect(bot.health).toBe(99);
    expect(bot.stats.damageTaken).toBe(1);
    expect(bot.speed).toBe(0);
    expect(bot.x).toBe(10); // movement not applied on collision
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botStop' })
    );
  });

  it('leaves collision damage unattributed, clearing a prior shooter', () => {
    // Shot down to 1 by an enemy on an earlier tick, then finished off by a wall.
    // The wall is the last hit, so the enemy does not get the kill.
    const bot = makeBot({ x: 10, health: 1 });
    bot.lastDamagedBy = makeBot({ id: 'enemy' });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.health).toBe(0);
    expect(bot.lastDamagedBy).toBeNull();
  });

  it('reports a head-on wall (dead ahead) as bearing 0', () => {
    const collided = vi.fn();
    // Driving south (orientation 0, +y) into the south wall — hit straight on.
    const bot = makeBot({
      y: 740,
      speed: 10,
      speedTarget: 10,
      handlers: { [Event.COLLIDED]: collided },
    });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(collided).toHaveBeenCalledWith({ angle: 0 });
  });

  it('reports a corner wall as a diagonal bearing', () => {
    const collided = vi.fn();
    // Lodged in the south-east corner, facing south (orientation 0): the corner
    // sits between dead-ahead (south) and the west-of-heading east wall.
    const bot = makeBot({
      x: 745,
      y: 745,
      handlers: { [Event.COLLIDED]: collided },
    });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(collided).toHaveBeenCalledWith({ angle: 315 });
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
    expect(target.stats.damageTaken).toBe(25);
    expect(shooter.stats.damageDealt).toBe(25);
    expect(target.lastDamagedBy).toBe(shooter);
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'bulletExploded', id: 'b1' })
    );
  });

  it('counts only the health a bullet actually removed, not the nominal 25', () => {
    // The enclosing health > 0 check runs once per tick, so both bullets land even
    // though the first one is fatal. The second must not count 25 against a bot
    // that only had 10 health left to give.
    const target = makeBot({ id: 'a', x: 375, y: 375, health: 10 });
    const mkBullet = (id: string) => ({
      id,
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 365 },
      callback: vi.fn(),
    });
    const shooter = makeBot({
      id: 'b',
      x: 375,
      y: 300,
      bullets: [mkBullet('b1'), mkBullet('b2')],
    });
    run(makeEnv([makeProcess('a', [target]), makeProcess('b', [shooter])]));
    // Health itself is still allowed to go negative — that behavior is unchanged.
    expect(target.health).toBe(-40);
    expect(target.stats.timesHit).toBe(2);
    expect(target.stats.damageTaken).toBe(10);
    expect(shooter.stats.damageDealt).toBe(10);
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
    expect(bot.stats.damageTaken).toBe(3);
    expect(bullet.callback).toHaveBeenCalledWith({});
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botDamaged', id: 'a', health: 97 })
    );
  });

  it('does not let a corpse’s own stray miss steal its killer’s credit', () => {
    // A dead bot's bullets keep flying, and the miss penalty runs OUTSIDE the
    // `health > 0` check — so in the same tick a bot can be shot dead and then
    // "damage itself" by missing. That must not overwrite the attribution: the
    // enemy landed the killing blow, and a bot already at <= 0 cannot be damaged
    // further. (Found by driving a real match: every kill went uncredited.)
    const outgoing = {
      id: 'b-out',
      x: 375,
      y: 800, // already outside — will be scored a miss this tick
      speed: 0,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 375 },
      callback: vi.fn(),
    };
    const victim = makeBot({
      id: 'v',
      x: 375,
      y: 375,
      health: 10,
      bullets: [outgoing],
    });
    const incoming = {
      id: 'b-in',
      x: 375,
      y: 375,
      speed: 5,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 365 },
      callback: vi.fn(),
    };
    const killer = makeBot({ id: 'k', x: 375, y: 300, bullets: [incoming] });
    run(makeEnv([makeProcess('a', [victim]), makeProcess('b', [killer])]));

    expect(victim.health).toBeLessThanOrEqual(0);
    expect(victim.lastDamagedBy).toBe(killer);
    // The 10 health the bullet took, and nothing for the post-mortem miss.
    expect(victim.stats.damageTaken).toBe(10);
  });

  it('leaves a self-inflicted missed shot unattributed, clearing a prior shooter', () => {
    // Shot by an enemy earlier in the tick, then finished off by its own missed
    // shot: the miss is the last hit, so the enemy loses the credit.
    const bullet = {
      id: 'b1',
      x: 375,
      y: 800,
      speed: 0,
      orientation: 0,
      exploded: false,
      origin: { x: 375, y: 375 },
      callback: vi.fn(),
    };
    const bot = makeBot({ id: 'a', health: 100, bullets: [bullet] });
    bot.lastDamagedBy = makeBot({ id: 'enemy' });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.lastDamagedBy).toBeNull();
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

  it('treats a crash as a forfeit: no damage counted, prior shooter cleared', () => {
    // Shot to 10 by an enemy, then crashes. The crash — not the enemy — is what
    // killed it, so nobody is credited and the 90 lost health is not a 100th
    // point of damage taken.
    const bot = makeBot({ appCrashed: true, health: 10 });
    bot.stats.damageTaken = 90;
    bot.lastDamagedBy = makeBot({ id: 'enemy' });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.health).toBe(0);
    expect(bot.stats.damageTaken).toBe(90);
    expect(bot.lastDamagedBy).toBeNull();
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

describe('applyEliminations — kill credit', () => {
  // applyEliminations takes real Processes, so link each bot back to its process
  // the way Bot's constructor does. The cast keeps the lightweight mock bots above
  // usable here — the helper only touches health/eliminatedAt/lastDamagedBy/stats
  // and process.getAppId().
  const link = (appId: string, bots: ReturnType<typeof makeBot>[]) => {
    const process = makeProcess(appId, bots);
    bots.forEach((bot) => {
      (bot as unknown as { process: unknown }).process = process;
    });
    return process as any;
  };

  it('credits the enemy who landed the last hit, and records the death tick', () => {
    const killer = makeBot({ id: 'k' });
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = killer;
    applyEliminations([link('a', [victim]), link('b', [killer])], 42);
    expect(victim.eliminatedAt).toBe(42);
    expect(killer.stats.kills).toBe(1);
  });

  it('credits nobody for an unattributed death (collision, decay, crash, own miss)', () => {
    // Every unattributed damage site clears lastDamagedBy, so they all arrive here
    // looking identical — null attribution. The bystander proves the credit didn't
    // simply land on whoever else happened to be in the arena.
    const bystander = makeBot({ id: 'b' });
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = null;
    applyEliminations([link('a', [victim]), link('b', [bystander])], 7);
    expect(victim.eliminatedAt).toBe(7);
    expect(bystander.stats.kills).toBe(0);
    expect(victim.stats.kills).toBe(0);
  });

  it('credits nobody for friendly fire', () => {
    // Same app: the damage was real and is already recorded, but killing your own
    // teammate is not an achievement.
    const shooter = makeBot({ id: 's' });
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = shooter;
    applyEliminations([link('a', [victim, shooter])], 5);
    expect(shooter.stats.kills).toBe(0);
  });

  it('credits nobody when a bot shoots itself to death', () => {
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = victim;
    applyEliminations([link('a', [victim])], 5);
    expect(victim.stats.kills).toBe(0);
  });

  it('credits a shooter that is already dead itself (bullet still in flight)', () => {
    const killer = makeBot({ id: 'k', health: 0, eliminatedAt: 3 });
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = killer;
    applyEliminations([link('a', [victim]), link('b', [killer])], 9);
    expect(killer.stats.kills).toBe(1);
  });

  it('is a once-latch: repeated ticks never re-credit the same death', () => {
    const killer = makeBot({ id: 'k' });
    const victim = makeBot({ id: 'v', health: 0 });
    victim.lastDamagedBy = killer;
    const processes = [link('a', [victim]), link('b', [killer])];
    applyEliminations(processes, 1);
    applyEliminations(processes, 2);
    applyEliminations(processes, 3);
    expect(killer.stats.kills).toBe(1);
    expect(victim.eliminatedAt).toBe(1); // the first tick it was found dead
  });

  it('leaves living bots untouched', () => {
    const bot = makeBot({ id: 'v', health: 1 });
    applyEliminations([link('a', [bot])], 4);
    expect(bot.eliminatedAt).toBeNull();
  });
});
