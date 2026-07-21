import { describe, it, expect, vi } from 'vitest';
import Simulation, { applyEliminations } from '../src/util/simulation';
import { BOT_MAX_SPEED, COLLISION_DAMAGE_FACTOR } from '../src/types/bot';
import { BULLET_SPEED } from '../src/types/bullet';
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
    const bot = makeBot({ speed: 5, speedTarget: 5 });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.x).toBeCloseTo(375);
    expect(bot.y).toBeCloseTo(380);
    expect(bot.stats.distanceTraveled).toBe(5);
  });

  it('accelerates toward speedTarget using pre-acceleration speed for the step', () => {
    const bot = makeBot({ speed: 0, speedTarget: 10 });
    run(makeEnv([makeProcess('a', [bot])]));
    // moved with speed 0 (no displacement), then accelerated by 2
    expect(bot.y).toBeCloseTo(375);
    expect(bot.speed).toBe(2);
  });

  it('snaps to speedTarget within one acceleration step', () => {
    const bot = makeBot({ speed: 4, speedTarget: 5 });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.speed).toBe(5);
  });

  it('clamps speed to BOT_MAX_SPEED', () => {
    const bot = makeBot({ speed: 4, speedTarget: 100 });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.speed).toBe(BOT_MAX_SPEED);
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
  it('stops the bot and applies speed-scaled damage at the arena boundary', () => {
    const collided = vi.fn();
    // Driving south (orientation 0, +y) straight into the south wall at speed 5:
    // the whole speed drives into the wall, so damage = 5 * the ram factor. The
    // wall still stops the bot dead. COLLIDED omits `friendly` for a wall.
    const bot = makeBot({
      y: 740,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: collided },
    });
    const env = makeEnv([makeProcess('a', [bot])]);
    run(env);
    expect(collided).toHaveBeenCalled();
    expect(collided.mock.calls[0][0]).not.toHaveProperty('friendly');
    // The event reports the speed driven into the wall — the same value that
    // scales the damage below. Damage is rounded to keep health integral:
    // 5 * 0.75 = 3.75 -> 4.
    expect(collided.mock.calls[0][0].impactSpeed).toBeCloseTo(5);
    expect(bot.health).toBe(100 - Math.round(5 * COLLISION_DAMAGE_FACTOR)); // 96
    expect(bot.stats.damageTaken).toBe(Math.round(5 * COLLISION_DAMAGE_FACTOR));
    expect(bot.speed).toBe(0);
    expect(bot.y).toBe(740); // movement not applied on collision
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botStop' })
    );
  });

  it('does not damage a bot that only skims along a wall', () => {
    const collided = vi.fn();
    // Moving mostly south with a slight westward drift, just clipping the west
    // wall. The component driving *into* the wall is below the minimum closing
    // speed, so the contact is reported but costs no health — the graze is free.
    const bot = makeBot({
      x: 16.3,
      orientation: 5,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: collided },
    });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(collided).toHaveBeenCalled();
    // The into-wall component is below the minimum closing speed, so the reported
    // impact speed is small (well under the ram factor's damage threshold).
    expect(collided.mock.calls[0][0].impactSpeed).toBeLessThan(1);
    expect(bot.health).toBe(100);
    expect(bot.stats.damageTaken).toBe(0);
  });

  it('re-hits when a stopped bot accelerates back into the wall', () => {
    const collided = vi.fn();
    // Head-on into the south wall at speed 5, which stops us dead.
    const bot = makeBot({
      y: 730,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: collided },
    });
    const env = makeEnv([makeProcess('a', [bot])]);

    run(env);
    expect(collided).toHaveBeenCalledTimes(1);
    expect(bot.speed).toBe(0);
    const healthAfterFirst = bot.health;
    expect(healthAfterFirst).toBe(
      100 - Math.round(5 * COLLISION_DAMAGE_FACTOR)
    );

    // The wall zeroed our speedTarget. Re-command movement straight back in: the
    // very next tick we're stopped and sitting just clear of the boundary (a gap
    // tick), so there's no fresh contact and no damage.
    bot.speedTarget = 5;
    run(env);
    expect(collided).toHaveBeenCalledTimes(1);
    expect(bot.health).toBe(healthAfterFirst);

    // Keep re-commanding into the wall; within a few ticks we accelerate back
    // across the boundary, which registers as a fresh contact and lands another
    // impact hit — re-ramming is never silent.
    for (let i = 0; i < 4; i++) {
      bot.speedTarget = 5;
      run(env);
    }
    expect(collided.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(bot.health).toBeLessThan(healthAfterFirst);
  });

  it('leaves collision damage unattributed, clearing a prior shooter', () => {
    // Shot down to 1 by an enemy on an earlier tick, then finished off by driving
    // into a wall. The wall is the last hit, so the enemy does not get the kill.
    const bot = makeBot({ y: 740, speed: 5, speedTarget: 5, health: 1 });
    bot.lastDamagedBy = makeBot({ id: 'enemy' });
    run(makeEnv([makeProcess('a', [bot])]));
    expect(bot.health).toBeLessThanOrEqual(0);
    expect(bot.lastDamagedBy).toBeNull();
  });

  it('reports a head-on wall (dead ahead) as bearing 0', () => {
    const collided = vi.fn();
    // Driving south (orientation 0, +y) into the south wall — hit straight on.
    const bot = makeBot({
      y: 740,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: collided },
    });
    run(makeEnv([makeProcess('a', [bot])]));
    // Head-on at speed 5: the whole speed drives into the wall, so impactSpeed = 5.
    expect(collided).toHaveBeenCalledWith({ angle: 0, impactSpeed: 5 });
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
    // Lodged in the corner at rest (speed 0), so nothing drives in: impactSpeed 0.
    expect(collided).toHaveBeenCalledWith({ angle: 315, impactSpeed: 0 });
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

  it('debounces bot-vs-bot COLLIDED to the tick contact begins', () => {
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
    const env = makeEnv([makeProcess('a', [t1, t2])]);

    // First overlap: each side is notified once, and counted once.
    run(env);
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
    expect(t1.stats.timesCollided).toBe(1);
    expect(t2.stats.timesCollided).toBe(1);

    // Still overlapping the next tick (the pair is already in contact): COLLIDED
    // must not re-fire — this is the debounce. Force them back into overlap in
    // case the prior tick's push separated them.
    t1.x = 375;
    t2.x = 385;
    run(env);
    expect(c1).toHaveBeenCalledTimes(1);
    expect(c2).toHaveBeenCalledTimes(1);
    expect(t1.stats.timesCollided).toBe(1);
    expect(t2.stats.timesCollided).toBe(1);

    // Separate fully so the contact resets, then bring them back together: a
    // fresh contact fires (and counts) again.
    t1.x = 100;
    t2.x = 700;
    run(env);
    t1.x = 375;
    t2.x = 385;
    run(env);
    expect(c1).toHaveBeenCalledTimes(2);
    expect(c2).toHaveBeenCalledTimes(2);
    expect(t1.stats.timesCollided).toBe(2);
    expect(t2.stats.timesCollided).toBe(2);
  });

  it('debounces the arena-wall COLLIDED to the tick contact begins', () => {
    const collided = vi.fn();
    const bot = makeBot({ x: 10, handlers: { [Event.COLLIDED]: collided } });
    const env = makeEnv([makeProcess('a', [bot])]);

    // First contact with the west wall: fires once, counted once.
    run(env);
    expect(collided).toHaveBeenCalledTimes(1);
    expect(bot.stats.timesCollided).toBe(1);

    // Still pinned against the wall next tick: the event and the count hold
    // steady (the per-tick stop and 1 damage stay level-triggered, but the
    // reporting is edged).
    bot.x = 10;
    run(env);
    expect(collided).toHaveBeenCalledTimes(1);
    expect(bot.stats.timesCollided).toBe(1);

    // Drive off the wall, then back into it: a fresh contact fires again.
    bot.x = 375;
    run(env);
    bot.x = 10;
    run(env);
    expect(collided).toHaveBeenCalledTimes(2);
    expect(bot.stats.timesCollided).toBe(2);
  });

  it('pushes two overlapping bots apart instead of freezing them', () => {
    // 16 units apart on x — deep inside the 32-unit contact distance. Neither is
    // moving, so there's no closing speed and no damage; they should just resolve
    // to (at least) touching distance.
    const t1 = makeBot({ id: '1', x: 375, y: 375 });
    const t2 = makeBot({ id: '2', x: 391, y: 375 });
    const env = makeEnv([makeProcess('a', [t1, t2])]);
    run(env);
    expect(Math.hypot(t1.x - t2.x, t1.y - t2.y)).toBeGreaterThanOrEqual(31.9);
    // A gentle touch (no closing speed) costs no health.
    expect(t1.health).toBe(100);
    expect(t2.health).toBe(100);
    // The push is broadcast so the client can re-sync the bumped position.
    expect(env.emit).toHaveBeenCalledWith(
      'event',
      expect.objectContaining({ type: 'botAccelerate', id: '1' })
    );
  });

  it('preserves a bot’s speed target through a collision (no deadlock)', () => {
    // Two bots driving straight at each other. The old behavior zeroed
    // speedTarget on contact, welding them in place until one died; now the
    // intent survives so they can drive themselves free.
    const t1 = makeBot({ id: '1', x: 375, y: 370, speed: 5, speedTarget: 5 });
    const t2 = makeBot({
      id: '2',
      x: 375,
      y: 400,
      orientation: 180,
      speed: 5,
      speedTarget: 5,
    });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(t1.speedTarget).toBe(5);
    expect(t2.speedTarget).toBe(5);
  });

  it('applies impact damage once per contact, scaled by closing speed', () => {
    // Head-on at ±5 → closing speed 10 → 10 * 0.75 = 7.5 damage, rounded to 8, once.
    const t1 = makeBot({ id: '1', x: 375, y: 370, speed: 5, speedTarget: 5 });
    const t2 = makeBot({
      id: '2',
      x: 375,
      y: 400,
      orientation: 180,
      speed: 5,
      speedTarget: 5,
    });
    const processes = [makeProcess('a', [t1, t2])];
    run(makeEnv(processes));
    const impact = Math.round(10 * COLLISION_DAMAGE_FACTOR); // 8
    expect(t1.health).toBe(100 - impact);
    expect(t2.health).toBe(100 - impact);

    // Still pressed together next tick — the contact is not fresh, so no further
    // impact damage lands (a sustained shove is not a grind).
    run(makeEnv(processes));
    expect(t1.health).toBe(100 - impact);
    expect(t2.health).toBe(100 - impact);
  });

  it('keeps health integral even when the raw impact damage is fractional', () => {
    // Closing speed 7 → 7 * 0.75 = 5.25, which without rounding would leave a
    // fractional health (and a fractional damageDealt total, the bigint-counter
    // fault this guards). Head-on at ±3.5 gives closing speed 7.
    const t1 = makeBot({
      id: '1',
      x: 375,
      y: 370,
      speed: 3.5,
      speedTarget: 3.5,
    });
    const t2 = makeBot({
      id: '2',
      x: 375,
      y: 400,
      orientation: 180,
      speed: 3.5,
      speedTarget: 3.5,
    });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(t1.health).toBe(100 - Math.round(7 * COLLISION_DAMAGE_FACTOR)); // 95
    expect(Number.isInteger(t1.health)).toBe(true);
    expect(Number.isInteger(t2.health)).toBe(true);
    expect(Number.isInteger(t1.stats.damageTaken)).toBe(true);
    expect(Number.isInteger(t2.stats.damageTaken)).toBe(true);
  });

  it('reports the closing speed as impactSpeed to a rammed bot', () => {
    // Head-on at ±5 → closing speed 10, reported to both sides. The value matches
    // the damage each takes (10 * 0.75 = 7.5), and both sides see the same speed.
    const c1 = vi.fn();
    const c2 = vi.fn();
    const t1 = makeBot({
      id: '1',
      x: 375,
      y: 370,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: c1 },
    });
    const t2 = makeBot({
      id: '2',
      x: 375,
      y: 400,
      orientation: 180,
      speed: 5,
      speedTarget: 5,
      handlers: { [Event.COLLIDED]: c2 },
    });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(c1.mock.calls[0][0].impactSpeed).toBeCloseTo(10, 5);
    expect(c2.mock.calls[0][0].impactSpeed).toBeCloseTo(10, 5);
  });

  it('reports impactSpeed 0 for a free (non-closing) contact', () => {
    // Two stationary overlapping bots: the contact is reported but nothing is
    // closing, so impactSpeed is 0 — a free, no-damage graze, mirroring a bot
    // that touches a wall while driving parallel to it.
    const c1 = vi.fn();
    const t1 = makeBot({
      id: '1',
      x: 375,
      y: 375,
      handlers: { [Event.COLLIDED]: c1 },
    });
    const t2 = makeBot({ id: '2', x: 385, y: 375 });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(c1).toHaveBeenCalled();
    expect(c1.mock.calls[0][0].impactSpeed).toBe(0);
  });

  it('sheds the inward speed of a head-on collision (friction, not ice)', () => {
    // A bot ramming a stationary one dead-on: collision friction absorbs the
    // velocity driving into it, so it stops on impact and must re-accelerate,
    // rather than gliding around at full speed like it's on ice.
    const t1 = makeBot({ id: '1', x: 375, y: 370, speed: 5, speedTarget: 5 });
    const t2 = makeBot({ id: '2', x: 375, y: 400, speed: 0, speedTarget: 0 });
    run(makeEnv([makeProcess('a', [t1, t2])]));
    expect(t1.speed).toBeCloseTo(0, 5);
    expect(t1.speedTarget).toBe(5); // intent survives — it recovers once clear
  });

  it('does not grind a settled contact toward death (sticky contact)', () => {
    // Two bots locked dead-center take the one initial impact, then hold: friction
    // parks them at contact distance and the sticky-contact rule keeps re-entry from
    // registering as a fresh collision, so health must stop dropping (the pre-fix
    // failure mode was ~1 HP/tick until one died).
    const t1 = makeBot({ id: '1', x: 375, y: 370, speed: 5, speedTarget: 5 });
    const t2 = makeBot({
      id: '2',
      x: 375,
      y: 400,
      orientation: 180,
      speed: 5,
      speedTarget: 5,
    });
    const env = makeEnv([makeProcess('a', [t1, t2])]);
    for (let i = 0; i < 3; i++) run(env); // let the pair settle into contact
    const settled1 = t1.health;
    const settled2 = t2.health;
    for (let i = 0; i < 40; i++) run(env);
    expect(t1.health).toBe(settled1);
    expect(t2.health).toBe(settled2);
    expect(t1.health).toBeGreaterThan(0);
    expect(t2.health).toBeGreaterThan(0);
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
      prev: { x: 375, y: 375 },
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
      prev: { x: 375, y: 375 },
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

  // A bullet is a point, so it connects within ONE radius of the target's
  // center. The old rule used two (the bot-vs-bot sum), which landed hits a
  // full body width clear of the hull. These two pin both sides of the edge.
  const shootAt = (bulletX: number, bulletY: number, prevY = bulletY) => {
    const target = makeBot({ id: 'a', x: 375, y: 375 });
    const bullet = {
      id: 'b1',
      x: bulletX,
      y: bulletY,
      speed: BULLET_SPEED,
      orientation: 0,
      exploded: false,
      origin: { x: bulletX, y: 300 },
      prev: { x: bulletX, y: prevY },
      callback: vi.fn(),
    };
    const shooter = makeBot({ id: 'b', x: bulletX, y: 300, bullets: [bullet] });
    run(makeEnv([makeProcess('a', [target]), makeProcess('b', [shooter])]));
    return { target, bullet };
  };

  it('hits a bot when the bullet reaches within one radius of its center', () => {
    // 15 units off center — inside the 16 hull, and inside the old 32 too.
    const { target, bullet } = shootAt(375 + 15, 375);
    expect(bullet.exploded).toBe(true);
    expect(target.health).toBe(75);
  });

  it('misses a bot the bullet passes more than one radius from', () => {
    // 20 units off center: clear of the hull, but inside the old two-radii
    // rule, which would have scored this as a hit.
    const { target, bullet } = shootAt(375 + 20, 375);
    expect(bullet.exploded).toBe(false);
    expect(target.health).toBe(100);
    expect(target.stats.timesHit).toBe(0);
  });

  it('catches a fast bullet that stepped clean over the target in one tick', () => {
    // The reason hit detection sweeps the segment instead of sampling the
    // landing point. This shot passes 12 units to the side of the center, so it
    // is only inside the 16 radius for a chord of ~21 — shorter than the 25 it
    // travels per tick. Both endpoints sit ~17 units out (outside the hull), yet
    // the path between them cuts straight through it. Sampling points would call
    // this a miss; sweeping the segment scores the hit it plainly is.
    const { target, bullet } = shootAt(375 + 12, 375 + 13, 375 - 12);
    expect(bullet.exploded).toBe(true);
    expect(target.health).toBe(75);
    expect(target.stats.timesHit).toBe(1);
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
      prev: { x: 375, y: 375 },
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
      prev: { x: 375, y: 800 },
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
      prev: { x: 375, y: 800 },
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
      prev: { x: 375, y: 800 },
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
      prev: { x: 375, y: 375 },
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
      prev: { x: 375, y: 800 },
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
