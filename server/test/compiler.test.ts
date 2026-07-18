import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// compiler.ts -> bot.ts -> appService -> util/db runs CREATE TABLE at import.
// Mock the db pool so importing the real modules doesn't reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Bot, { BOT_MAX_SPEED } from '../src/types/bot';
import { Process } from '../src/types/environment';
import { Event } from '../src/types/event';
import { timerTick } from '../src/util/scheduleFactory';
import appService from '../src/services/AppService';
import { logger } from '../src/util/logger';

// These are true integration tests: they spin up a real isolated-vm isolate,
// have compiler.init build the bot API into it, then compile/run bot code in the
// sandbox and read values back out. This locks the bot-facing contract before
// any refactor of compiler.ts.

function makeCompiledBot() {
  const emit = vi.fn();
  const proc = new Process('app1');
  // Mutable so contact-staleness tests can advance the clock between a scan
  // and the intercept computed from it.
  let time = 42;
  const env = {
    getArena: () => ({ getWidth: () => 750, getHeight: () => 600 }),
    getProcesses: () => [proc],
    getTime: () => time,
    isRunning: () => false, // command failure conditions settle immediately
    random: () => 0.5,
    emit,
    // Commands resolve/reject at call time here (no simulation loop drives ticks
    // in these unit tests); with isRunning() false every command's failure
    // condition holds, so bot calls settle immediately as before.
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
  bot.x = 100;
  bot.y = 200;
  bot.orientation = 0;
  bot.orientationTarget = 0;
  bot.speed = 0;
  bot.speedTarget = 0;
  proc.bots.push(bot);

  compiler.init(env as any, proc, bot);

  // A second, uncompiled bot for the radar to detect — scan() only reads plain
  // fields and (guardedly) host-side handlers, so it needs no isolate. Same
  // process, so scans report it as friendly.
  const addOtherBot = (
    x: number,
    y: number,
    opts: { speed?: number; orientation?: number } = {}
  ) => {
    const other = new Bot(env as any, proc as any);
    other.x = x;
    other.y = y;
    // Internal south-zero degrees (0 moves +y; the API heading is this +180).
    other.orientation = opts.orientation ?? 0;
    other.orientationTarget = other.orientation;
    other.speed = opts.speed ?? 0;
    other.speedTarget = other.speed;
    proc.bots.push(other);
    return other;
  };

  // Point the radar beam along an internal-compass angle and make it ready, so
  // a scan detects whatever sits in that direction.
  const aimRadar = (internalAngle: number) => {
    bot.turret.orientation = 0;
    bot.turret.orientationTarget = 0;
    bot.turret.radar.orientation = internalAngle;
    bot.turret.radar.orientationTarget = internalAngle;
    bot.turret.radar.charged = 100;
  };

  // Run bot code in the sandbox.
  const run = (code: string) =>
    proc.getSandbox().compileScriptSync(code).runSync(bot.getContext());
  // Evaluate an expression inside the isolate and copy the result out.
  const read = (expr: string) =>
    proc
      .getSandbox()
      .compileScriptSync(`(${expr})`)
      .runSync(bot.getContext(), { copy: true });

  return {
    bot,
    proc,
    env,
    emit,
    run,
    read,
    addOtherBot,
    aimRadar,
    setTime: (t: number) => {
      time = t;
    },
  };
}

describe('compiler — bot API in a real isolate', () => {
  let ctx: ReturnType<typeof makeCompiledBot>;

  beforeEach(() => {
    ctx = makeCompiledBot();
  });
  afterEach(() => {
    ctx.proc.dispose();
  });

  // Bot code now runs off-thread via async apply, so effects land after a
  // boundary round-trip. Poll the isolate for a value rather than racing a fixed
  // delay (timing varies under parallel-test CPU load).
  const waitUntilRead = async (
    expr: string,
    done: (v: unknown) => boolean
  ): Promise<unknown> => {
    const deadline = Date.now() + 3000;
    while (!done(ctx.read(expr)) && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 25));
    }
    return ctx.read(expr);
  };

  it('exposes synchronous getters that copy real values across the boundary', () => {
    expect(ctx.read('bot.getX()')).toBe(100);
    expect(ctx.read('bot.getY()')).toBe(200);
    expect(ctx.read('bot.getId()')).toBe(ctx.bot.id);
    expect(ctx.read('arena.getWidth()')).toBe(750);
    expect(ctx.read('arena.getHeight()')).toBe(600);
    expect(ctx.read('clock.getTime()')).toBe(42);
  });

  it('mirrors the physics constants as plain data properties with the engine values', () => {
    // Interpolated at init via compiler's num(), so these assert the sandbox
    // copies match the real engine values.
    expect(ctx.read('bot.radius')).toBe(16);
    expect(ctx.read('bot.maxSpeed')).toBe(5);
    expect(ctx.read('bot.acceleration')).toBe(2);
    expect(ctx.read('bot.turnRate')).toBe(10);
    expect(ctx.read('bot.turret.turnRate')).toBe(4);
    expect(ctx.read('bot.turret.bulletSpeed')).toBe(25);
    expect(ctx.read('bot.turret.bulletDamage')).toBe(25);
    expect(ctx.read('bot.radar.turnRate')).toBe(4);
  });

  // The fixture arena is deliberately non-square (750×600) so these fail
  // loudly if any helper assumes width === height.
  it('arena.contains tests raw arena bounds, edges inclusive', () => {
    expect(ctx.read('arena.contains(16, 16)')).toBe(true);
    expect(ctx.read('arena.contains(0, 0)')).toBe(true);
    expect(ctx.read('arena.contains(750, 600)')).toBe(true);
    expect(ctx.read('arena.contains(-5, -5)')).toBe(false);
    expect(ctx.read('arena.contains(751, 300)')).toBe(false);
    // In x-range but past the (shorter) height — the square-assumption canary.
    expect(ctx.read('arena.contains(400, 620)')).toBe(false);
  });

  it('arena.getNearestWall returns a marker on the nearest boundary', () => {
    // Bot at (100, 200): west wall (x = 0) is nearest at distance 100. The
    // internal orientation 0 is API heading 180 (south), so due-west is a
    // relative bearing of 90.
    expect(ctx.read('arena.getNearestWall().getX()')).toBe(0);
    expect(ctx.read('arena.getNearestWall().getY()')).toBe(200);
    expect(ctx.read('arena.getNearestWall().getDistance()')).toBe(100);
    expect(ctx.read('arena.getNearestWall().getBearing()')).toBe(90);
    expect(ctx.read('arena.getNearestWall().isInBounds()')).toBe(true);

    // Move near the top edge: north wall (y = 0) wins, directly behind (180).
    ctx.bot.x = 400;
    ctx.bot.y = 50;
    expect(ctx.read('arena.getNearestWall().getX()')).toBe(400);
    expect(ctx.read('arena.getNearestWall().getY()')).toBe(0);
    expect(ctx.read('arena.getNearestWall().getDistance()')).toBe(50);
    expect(ctx.read('arena.getNearestWall().getBearing()')).toBe(180);
  });

  it('markers expose isInBounds', () => {
    expect(ctx.read('bot.dropMarker().isInBounds()')).toBe(true);
    expect(ctx.read('arena.createMarker(-5, -5).isInBounds()')).toBe(false);
    expect(ctx.read('arena.createMarker(750, 600).isInBounds()')).toBe(true);
  });

  it('createMarker distance is full precision', () => {
    // getDistance() returns an unrounded float, matching getBearing()/getSpeed()
    // and the raw .distance scan property — no method-vs-property mismatch for
    // bots doing lead math. From (100, 200) to (101, 202): √5 ≈ 2.236.
    expect(ctx.read('arena.createMarker(101, 202).getDistance()')).toBeCloseTo(
      Math.sqrt(5),
      10
    );
  });

  // ---- Contacts: scan results as Markers-with-motion ----
  // The bot sits at (100, 200) in the 750×600 fixture arena.

  // Meet-equation invariant: something leaving the bot at `speed` arrives at
  // the returned point in exactly the time the target needs to reach it. This
  // checks the solve itself rather than a hand-computed answer.
  const expectMeets = (
    intercept: { x: number; y: number },
    targetNow: { x: number; y: number },
    v: { x: number; y: number },
    speed: number
  ) => {
    const t =
      Math.abs(v.x) > 1e-12
        ? (intercept.x - targetNow.x) / v.x
        : (intercept.y - targetNow.y) / v.y;
    expect(t).toBeGreaterThan(0);
    expect(Math.hypot(intercept.x - 100, intercept.y - 200)).toBeCloseTo(
      speed * t,
      6
    );
  };

  it('scan resolves Contacts that recover the scanned bot position', async () => {
    // The highest-value check: the Contact's polar→cartesian inversion is run
    // against the scan's own forward transform, not against hand arithmetic.
    ctx.addOtherBot(100, 500);
    ctx.aimRadar(0); // beam along +y, straight at the target 300 away
    ctx.run(`
      bot.radar.scan().then((cs) => {
        const c = cs[0]
        globalThis._scan = {
          n: cs.length,
          x: c.getX(), y: c.getY(),
          dProp: c.distance, live: c.getDistance(),
          friendly: c.friendly, inb: c.isInBounds(),
          // Every raw reading is also a method; both forms must agree.
          accessorsAgree:
            c.getId() === c.id &&
            c.getSpeed() === c.speed &&
            c.getOrientation() === c.orientation &&
            c.isFriendly() === c.friendly &&
            c.getHealth() === c.health,
          // Methods are non-enumerable, so enumeration-based bot code
          // (Object.keys, for...in, {...spread}) sees exactly the plain
          // object scans always returned.
          keys: Object.keys(c),
          spreadKeys: Object.keys({ ...c }),
          json: JSON.parse(JSON.stringify(c)),
        }
      })
    `);
    const s = (await waitUntilRead('globalThis._scan', (v) => !!v)) as {
      n: number;
      x: number;
      y: number;
      dProp: number;
      live: number;
      friendly: boolean;
      inb: boolean;
      accessorsAgree: boolean;
      keys: string[];
      spreadKeys: string[];
      json: Record<string, unknown>;
    };
    expect(s.n).toBe(1);
    expect(s.x).toBeCloseTo(100, 6);
    expect(s.y).toBeCloseTo(500, 6);
    expect(s.dProp).toBeCloseTo(300, 6); // capture-time raw distance property
    expect(s.live).toBe(300); // Marker's live (floored) distance
    expect(s.friendly).toBe(true);
    expect(s.inb).toBe(true);
    expect(s.accessorsAgree).toBe(true);
    // The wire shape — what bot.send(contact), spread, and JSON serialize
    // (methods always drop out) — is the ScanResult data fields plus the
    // frame-independent x/y/time, exactly what arena.createContact needs to
    // rebuild the Contact on the receiving side. The scan's angle/distance
    // are relative to the scanner, so alone they can't be re-anchored.
    const wireFields = [
      'angle',
      'distance',
      'friendly',
      'health',
      'id',
      'orientation',
      'speed',
      'time',
      'x',
      'y',
    ];
    expect(Object.keys(s.json).sort()).toEqual(wireFields);
    expect(s.json.x).toBeCloseTo(100, 6); // absolute capture position…
    expect(s.json.y).toBeCloseTo(500, 6);
    expect(s.json.time).toBe(42); // …and the capture tick survive the wire
    // The enumerable surface matches: enumeration-based bot code
    // (Object.keys, for...in, {...spread}) sees only data, never methods.
    expect(s.keys.sort()).toEqual(wireFields);
    expect(s.spreadKeys.sort()).toEqual(wireFields);
  });

  it('getIntercept aims at a stationary target and rejects bad speeds', async () => {
    ctx.addOtherBot(100, 500);
    ctx.aimRadar(0);
    ctx.run(`
      bot.radar.scan().then((cs) => {
        const m = cs[0].getIntercept(25)
        globalThis._i = {
          p: m && { x: m.getX(), y: m.getY() },
          zero: cs[0].getIntercept(0),
          neg: cs[0].getIntercept(-5),
          none: cs[0].getIntercept(),
        }
      })
    `);
    const i = (await waitUntilRead('globalThis._i', (v) => !!v)) as {
      p: { x: number; y: number };
      zero: unknown;
      neg: unknown;
      none: unknown;
    };
    expect(i.p.x).toBeCloseTo(100, 6);
    expect(i.p.y).toBeCloseTo(500, 6);
    expect(i.zero).toBeNull();
    expect(i.neg).toBeNull();
    expect(i.none).toBeNull();
  });

  it('getIntercept leads a crossing target (meet-equation invariant)', async () => {
    // Internal orientation 180 = API heading 0 (north): velocity (0, -5),
    // crossing the +x line of sight at a right angle.
    ctx.addOtherBot(400, 200, { speed: 5, orientation: 180 });
    ctx.aimRadar(270); // beam along +x
    ctx.run(`
      bot.radar.scan().then((cs) => {
        const m = cs[0].getIntercept(25)
        globalThis._i = m && { x: m.getX(), y: m.getY() }
      })
    `);
    const i = (await waitUntilRead('globalThis._i', (v) => !!v)) as {
      x: number;
      y: number;
    };
    expect(i.x).toBeCloseTo(400, 6); // no x velocity — x holds
    expect(i.y).toBeLessThan(200); // led in the direction of travel
    expectMeets(i, { x: 400, y: 200 }, { x: 0, y: -5 }, 25);
  });

  it('getIntercept folds in ticks elapsed since the scan', async () => {
    ctx.addOtherBot(400, 200, { speed: 5, orientation: 180 });
    ctx.aimRadar(270);
    ctx.run(`bot.radar.scan().then((cs) => { globalThis._c = cs[0] })`);
    await waitUntilRead('typeof globalThis._c', (v) => v === 'object');

    // Three ticks pass; the target's true position is now (400, 185). The
    // solve must start from there, not from the stale capture point.
    ctx.setTime(45);
    const i = ctx.read(`(() => {
      const m = globalThis._c.getIntercept(25)
      return m && { x: m.getX(), y: m.getY() }
    })()`) as { x: number; y: number };
    expect(i.x).toBeCloseTo(400, 6);
    expectMeets(i, { x: 400, y: 185 }, { x: 0, y: -5 }, 25);
  });

  it('getIntercept returns null when the target outruns the given speed', async () => {
    // Internal 270 = API 90 (east): fleeing straight down the line of sight
    // at 30, faster than the 25 we can chase with.
    ctx.addOtherBot(400, 200, { speed: 30, orientation: 270 });
    ctx.aimRadar(270);
    ctx.run(`
      bot.radar.scan().then((cs) => {
        globalThis._out = { i: cs[0].getIntercept(25) }
      })
    `);
    const o = (await waitUntilRead('globalThis._out', (v) => !!v)) as {
      i: unknown;
    };
    expect(o.i).toBeNull();
  });

  it('SCANNED handlers receive the same Contact objects', async () => {
    ctx.addOtherBot(100, 500);
    ctx.aimRadar(0);
    ctx.run(`
      bot.on(Event.SCANNED, (cs) => {
        globalThis._ev = {
          x: cs[0].getX(),
          y: cs[0].getY(),
          canIntercept: cs[0].getIntercept(25) !== null,
          distance: cs[0].distance,
        }
      })
      bot.radar.scan().catch(() => {})
    `);
    const e = (await waitUntilRead('globalThis._ev', (v) => !!v)) as {
      x: number;
      y: number;
      canIntercept: boolean;
      distance: number;
    };
    expect(e.x).toBeCloseTo(100, 6);
    expect(e.y).toBeCloseTo(500, 6);
    expect(e.canIntercept).toBe(true);
    expect(e.distance).toBeCloseTo(300, 6);
  });

  it('markers serialize their position and rebuild with createMarker', () => {
    // x/y are enumerable data, so bot.send(marker) / JSON round-trips carry
    // the point; methods drop out as always.
    expect(
      ctx.read('JSON.parse(JSON.stringify(arena.createMarker(30, 40)))')
    ).toEqual({ x: 30, y: 40 });
    expect(ctx.read('arena.createMarker(30, 40).x')).toBe(30);
    // The receive-side idiom: rebuild from the wire data.
    expect(
      ctx.read(
        `(() => {
          const m = JSON.parse(JSON.stringify(bot.dropMarker()))
          return arena.createMarker(m.x, m.y).getDistance()
        })()`
      )
    ).toBe(0);
  });

  it('arena.createContact rehydrates a serialized Contact, methods intact', async () => {
    // Internal orientation 180 = API heading 0 (north): velocity (0, -5).
    ctx.addOtherBot(400, 200, { speed: 5, orientation: 180 });
    ctx.aimRadar(270); // beam along +x
    ctx.run(`
      bot.radar.scan().then((cs) => {
        const c = cs[0]
        const wire = JSON.parse(JSON.stringify(c)) // what bot.send delivers
        const r = arena.createContact(wire)
        const a = c.getIntercept(25), b = r.getIntercept(25)
        globalThis._rt = {
          x: r.getX(), y: r.getY(),
          speed: r.getSpeed(), orientation: r.getOrientation(),
          friendly: r.isFriendly(), health: r.getHealth(), id: r.getId(),
          bearing: r.getBearing() === c.getBearing(),
          distance: r.getDistance() === c.getDistance(),
          sameIntercept:
            !!a && !!b && a.getX() === b.getX() && a.getY() === b.getY(),
          // A second hop serializes identically — relaying is lossless.
          wire2: JSON.parse(JSON.stringify(r)),
          wire1: wire,
        }
      })
    `);
    const rt = (await waitUntilRead('globalThis._rt', (v) => !!v)) as {
      x: number;
      y: number;
      speed: number;
      orientation: number;
      friendly: boolean;
      health: number;
      id: string;
      bearing: boolean;
      distance: boolean;
      sameIntercept: boolean;
      wire2: Record<string, unknown>;
      wire1: Record<string, unknown>;
    };
    expect(rt.x).toBeCloseTo(400, 6);
    expect(rt.y).toBeCloseTo(200, 6);
    expect(rt.speed).toBe(5);
    expect(rt.orientation).toBe(0); // API heading (internal 180)
    expect(rt.friendly).toBe(true); // same process in this fixture
    expect(rt.health).toBe(100);
    expect(rt.id).toBeTruthy();
    expect(rt.bearing).toBe(true);
    expect(rt.distance).toBe(true);
    expect(rt.sameIntercept).toBe(true);
    expect(rt.wire2).toEqual(rt.wire1);
  });

  it('a rehydrated Contact folds in ticks elapsed since its capture time', async () => {
    ctx.addOtherBot(400, 200, { speed: 5, orientation: 180 });
    ctx.aimRadar(270);
    ctx.run(`
      bot.radar.scan().then((cs) => {
        globalThis._wire = JSON.parse(JSON.stringify(cs[0]))
      })
    `);
    await waitUntilRead('typeof globalThis._wire', (v) => v === 'object');

    // Three ticks after the capture, rehydrate and solve: like a live
    // Contact, the solve must start from the target's projected position
    // (400, 185), not the stale capture point.
    ctx.setTime(45);
    const i = ctx.read(`(() => {
      const m = arena.createContact(globalThis._wire).getIntercept(25)
      return m && { x: m.getX(), y: m.getY() }
    })()`) as { x: number; y: number };
    expect(i.x).toBeCloseTo(400, 6);
    expectMeets(i, { x: 400, y: 185 }, { x: 0, y: -5 }, 25);
  });

  it('createContact defaults a missing time to now and clamps future times', () => {
    ctx.setTime(45);
    const read = (extra: string) =>
      ctx.read(`(() => {
        const m = arena.createContact(
          Object.assign({ x: 400, y: 200, speed: 5, orientation: 0 }${extra})
        ).getIntercept(25)
        return m && { x: m.getX(), y: m.getY() }
      })()`) as { x: number; y: number };

    // No time: treated as captured now (dt = 0) — solve from (400, 200).
    const fresh = read('');
    expectMeets(fresh, { x: 400, y: 200 }, { x: 0, y: -5 }, 25);
    // A capture tick "from the future" (e.g. recorded before a match restart
    // reset the clock) is clamped to now, not projected backward.
    const future = read(', { time: 9999 }');
    expect(future).toEqual(fresh);
    // A genuinely stale capture projects forward as usual.
    const stale = read(', { time: 42 }');
    expectMeets(stale, { x: 400, y: 185 }, { x: 0, y: -5 }, 25);
  });

  it('createContact rejects malformed input with a clear error', () => {
    for (const bad of [
      'null',
      '42',
      '"contact"',
      '({})',
      '({ x: 1, y: 2, speed: 0 })', // missing orientation
      '({ x: "1", y: 2, speed: 0, orientation: 0 })', // non-numeric
      '({ x: Infinity, y: 2, speed: 0, orientation: 0 })',
    ]) {
      expect(() => ctx.read(`arena.createContact(${bad})`)).toThrow(
        /createContact/
      );
    }
  });

  it('removes Date and does not leak Node globals into the sandbox', () => {
    // Date is deliberately set to undefined so bots stay deterministic.
    expect(ctx.read('typeof Date')).toBe('undefined');
    expect(ctx.read('typeof process')).toBe('undefined');
    expect(ctx.read('typeof require')).toBe('undefined');
    expect(ctx.read('typeof globalThis.setInterval')).toBe('function');
  });

  it('seeds Math.random from the arena RNG so bot randomness is reproducible', () => {
    // The mock env.random() is constant, so both bots draw the same sub-seed and
    // therefore replay the identical Math.random stream — the reproducibility a
    // fixed arena seed provides.
    const a = makeCompiledBot();
    const b = makeCompiledBot();
    const seqA = a.read(
      '[Math.random(), Math.random(), Math.random()]'
    ) as number[];
    const seqB = b.read(
      '[Math.random(), Math.random(), Math.random()]'
    ) as number[];

    expect(seqA).toEqual(seqB);
    // Real numbers in [0, 1) that actually advance (not a constant).
    expect(seqA[0]).toBeGreaterThanOrEqual(0);
    expect(seqA[0]).toBeLessThan(1);
    expect(seqA[0]).not.toEqual(seqA[1]);

    a.proc.dispose();
    b.proc.dispose();
  });

  it('applies mutating commands to the underlying bot', () => {
    ctx.run('bot.setSpeed(3).catch(() => {})');
    expect(ctx.bot.speedTarget).toBe(3);

    ctx.run('bot.turn(90).catch(() => {})');
    expect(ctx.bot.orientationTarget).toBe(90);

    ctx.run('bot.turret.setOrientation(45).catch(() => {})');
    expect(ctx.bot.turret.orientationTarget).toBe(45);

    ctx.run('bot.radar.setOrientation(10).catch(() => {})');
    expect(ctx.bot.turret.radar.orientationTarget).toBe(10);
  });

  it('clamps setSpeed to BOT_MAX_SPEED', () => {
    ctx.run('bot.setSpeed(1000).catch(() => {})');
    expect(ctx.bot.speedTarget).toBe(BOT_MAX_SPEED);
  });

  it('registers event handlers and runs them through the Reference bridge', async () => {
    ctx.run(`
            globalThis._started = false
            bot.on(Event.START, () => { globalThis._started = true })
        `);
    expect(typeof ctx.bot.handlers[Event.START]).toBe('function');

    // Invoking the handler schedules a setTimeout(0) that calls into the isolate.
    ctx.bot.handlers[Event.START]();
    expect(await waitUntilRead('globalThis._started', (v) => v === true)).toBe(
      true
    );
  });

  it('wires clock.on(TICK) through to a bot TICK handler', async () => {
    ctx.run(`
            globalThis._ticks = 0
            clock.on(Event.TICK, () => { globalThis._ticks++ })
        `);
    expect(typeof ctx.bot.handlers[Event.TICK]).toBe('function');
    ctx.bot.handlers[Event.TICK]();
    expect(await waitUntilRead('globalThis._ticks', (v) => v === 1)).toBe(1);
  });

  it('routes console.log to the environment log stream', () => {
    ctx.run(`console.log('hello world')`);
    expect(ctx.emit).toHaveBeenCalledWith(
      'log',
      expect.objectContaining({ time: 42 })
    );
  });

  it('registers tick-driven setInterval timers on the bot', () => {
    ctx.run(`setInterval(() => {}, 5)`);
    expect(Object.keys(ctx.bot.timers.intervalMap)).toHaveLength(1);
  });

  it('terminates a runaway timer body under the sandbox timeout (DoS guard)', async () => {
    // Without a timeout on timer callbacks, this infinite loop would hang the
    // host thread forever. The timer now runs off-thread via apply(), so the
    // crash is recorded asynchronously once the (shortened) timeout fires.
    process.env.SANDBOX_TIMEOUT_MS = '200';
    try {
      ctx.run(`setInterval(() => { while (true) {} }, 0)`);
      // Fire the registered interval the way the simulation loop does.
      timerTick(ctx.env as never);
      // The crash is recorded asynchronously once the timeout fires; poll for it
      // rather than racing a fixed delay (off-thread timing varies under load).
      const deadline = Date.now() + 3000;
      while (!ctx.bot.appCrashed && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(ctx.bot.appCrashed).toBe(true);
    } finally {
      delete process.env.SANDBOX_TIMEOUT_MS;
    }
  });

  it('caps the per-tick log budget and clamps long messages', () => {
    // env.getTime() is fixed at 42, so every call shares one budget window.
    ctx.run(`for (let i = 0; i < 200; i++) console.log('x'.repeat(5000))`);
    const logCalls = ctx.emit.mock.calls.filter((c) => c[0] === 'log');
    expect(logCalls.length).toBeLessThanOrEqual(50);
    // Long strings are truncated before they reach the SSE stream.
    expect(logCalls[0][1].msg.length).toBeLessThanOrEqual(2001);
  });

  // The message text of the most recent broadcast log line.
  const lastLogMsg = () => {
    const logs = ctx.emit.mock.calls.filter((c) => c[0] === 'log');
    return logs[logs.length - 1]?.[1].msg as string;
  };

  it('formats object arguments into the log message (visible in the UI)', () => {
    // The UI renders only the message text, so an object must be serialized into
    // it — whether passed alone or after a label.
    ctx.run(`console.log({ x: 1, y: 2 })`);
    expect(lastLogMsg()).toBe('{"x":1,"y":2}');

    ctx.run(`console.log('state', { hp: 0.5, pos: [1, 2] })`);
    expect(lastLogMsg()).toBe('state {"hp":0.5,"pos":[1,2]}');
  });

  it('formats numbers, booleans, and arrays in console.log', () => {
    ctx.run(`console.log('n', 42, true, [1, 2, 3])`);
    expect(lastLogMsg()).toBe('n 42 true [1,2,3]');
  });

  it('does not crash the bot when logging a circular structure', () => {
    ctx.run(`
      const o = { a: 1 };
      o.self = o;
      console.log('obj', o);
    `);
    expect(ctx.bot.appCrashed).toBeFalsy();
    expect(lastLogMsg()).toBe('obj {"a":1,"self":"[Circular]"}');
  });

  it('does not crash the bot when logging functions', () => {
    // Functions can't be cloned across the isolate boundary; formatting them to
    // a placeholder before crossing keeps a debugging log from killing the bot.
    ctx.run(`console.log('fn', function greet() {}, { cb: () => {} })`);
    expect(ctx.bot.appCrashed).toBeFalsy();
    expect(lastLogMsg()).toBe('fn [Function: greet] {"cb":"[Function: cb]"}');
  });

  it('renders an Error with its stack', () => {
    ctx.run(`console.error(new Error('boom'))`);
    expect(ctx.bot.appCrashed).toBeFalsy();
    expect(lastLogMsg()).toContain('boom');
  });

  it('reloading code does not re-fire START (saves keep running state)', async () => {
    // A bot that has already started, then has new source loaded onto it (a
    // save/recompile). START must NOT re-arm — re-initialization is explicit
    // (the reboot button / Environment.reboot), so an edit doesn't disrupt a
    // running bot.
    ctx.bot.needsStarting = false;
    vi.spyOn(appService, 'get').mockResolvedValue({
      getSource: () => 'bot.on(Event.START, () => {})',
    } as never);

    await ctx.bot.execute(ctx.proc);

    expect(ctx.bot.needsStarting).toBe(false);
  });

  it('exposes console.info / warn / error / debug and logger levels', () => {
    ctx.run(`
      console.info('i');
      console.warn('w');
      console.error('e');
      console.debug('d');
      logger.trace('t');
    `);
    const msgs = ctx.emit.mock.calls
      .filter((c) => c[0] === 'log')
      .map((c) => c[1].msg);
    expect(msgs).toEqual(expect.arrayContaining(['i', 'w', 'e', 'd', 't']));
  });

  it('tags each broadcast log entry with its bunyan level and levelName', () => {
    // Each console/logger method must ride its own level to the SSE stream so
    // the UI's per-level coloring and "Levels" filter work (GitHub #147).
    // browser-bunyan levels: trace=10, debug=20, info=30, warn=40, error=50.
    ctx.run(`
      console.log('l');
      console.info('i');
      console.warn('w');
      console.error('e');
      console.debug('d');
      logger.trace('t');
    `);
    const entryFor = (msg: string) =>
      ctx.emit.mock.calls
        .filter((c) => c[0] === 'log')
        .map((c) => c[1])
        .find((e) => e.msg === msg);

    // console.log and console.info both map to info.
    expect(entryFor('l')).toMatchObject({ level: 30, levelName: 'info' });
    expect(entryFor('i')).toMatchObject({ level: 30, levelName: 'info' });
    expect(entryFor('w')).toMatchObject({ level: 40, levelName: 'warn' });
    expect(entryFor('e')).toMatchObject({ level: 50, levelName: 'error' });
    expect(entryFor('d')).toMatchObject({ level: 20, levelName: 'debug' });
    expect(entryFor('t')).toMatchObject({ level: 10, levelName: 'trace' });
  });

  it('hides the raw _log channel from bot code', () => {
    // Bots must go through the formatting wrappers; the raw native channel that
    // can crash on un-cloneable arguments is removed after setup.
    expect(ctx.read('typeof _log')).toBe('undefined');
  });

  it('sanitizes and bounds a bot-supplied name before broadcasting it', async () => {
    const app = {
      getId: () => 'app1',
      getName: () => 'old',
      setName: vi.fn().mockResolvedValue(undefined),
    };
    vi.spyOn(appService, 'get').mockResolvedValue(app as never);
    ctx.bot.setName('  \u0000Super\u0007Bot' + 'z'.repeat(100));
    await new Promise((r) => setTimeout(r, 0));
    const call = ctx.emit.mock.calls.find(
      (c) => c[0] === 'event' && c[1]?.type === 'appRenamed'
    );
    expect(call).toBeTruthy();
    // control chars stripped, trimmed, clamped to 50 chars
    expect(call![1].name).toBe(('SuperBot' + 'z'.repeat(100)).slice(0, 50));
    expect(call![1].name.length).toBe(50);
  });

  it('ignores a name that is empty after sanitizing', async () => {
    const app = {
      getId: () => 'app1',
      getName: () => 'old',
      setName: vi.fn(),
    };
    vi.spyOn(appService, 'get').mockResolvedValue(app as never);
    ctx.emit.mockClear();
    ctx.bot.setName(' ');
    await new Promise((r) => setTimeout(r, 0));
    expect(
      ctx.emit.mock.calls.find((c) => c[1]?.type === 'appRenamed')
    ).toBeUndefined();
  });

  it('does not expose the ivm module (or Reference/Callback) to bot code', () => {
    expect(ctx.read('typeof _ivm')).toBe('undefined');
    expect(ctx.read('typeof globalThis._ivm')).toBe('undefined');
    expect(ctx.read('typeof ivm')).toBe('undefined');
    // The escape-relevant primitives must be unreachable too.
    expect(ctx.read('typeof Reference')).toBe('undefined');
    expect(ctx.read('typeof ExternalCopy')).toBe('undefined');
  });

  it('delivers async rejections back to bot code across the boundary', async () => {
    // radar starts uncharged, so scan() rejects — exercises the settle path.
    ctx.run(
      `globalThis.__r = 'pending'; bot.radar.scan().then(() => { __r = 'ok' }, (e) => { __r = 'err:' + e })`
    );
    expect(await waitUntilRead('__r', (v) => v !== 'pending')).toBe(
      'err:Radar not ready'
    );
  });

  it('copies an async object result (scan hit list) back across the boundary', async () => {
    ctx.bot.turret.radar.charged = 100; // allow the scan to run
    ctx.run(
      `globalThis.__hits = 'pending'; bot.radar.scan().then((v) => { __hits = Array.isArray(v) ? v.length : 'notarray' })`
    );
    expect(await waitUntilRead('__hits', (v) => v !== 'pending')).toBe(0);
  });

  it('exposes the Event enum to bots', () => {
    expect(ctx.read('Event.START')).toBe('START');
    expect(ctx.read('Event.TICK')).toBe('TICK');
  });

  it('copies bot.getHealth() across the boundary on a 0–100 scale', () => {
    // bot health 100
    expect(ctx.read('bot.getHealth()')).toBe(100);
  });

  it('exposes the body heading on a north-zero compass (API boundary)', () => {
    // Internally orientation is south-zero; the bot API is north-zero (+180).
    ctx.bot.orientation = 0; // internal south
    expect(ctx.read('bot.getOrientation()')).toBe(180); // north-zero: south = 180
    ctx.bot.orientation = 90; // internal west
    expect(ctx.read('bot.getOrientation()')).toBe(270);
  });

  it('setOrientation maps a north-zero heading to the internal compass', () => {
    // Bot asks to face north (0); internally that is south-zero 180.
    ctx.run('bot.setOrientation(0).catch(() => {})');
    expect(ctx.bot.orientationTarget).toBe(180);
    ctx.run('bot.setOrientation(90).catch(() => {})'); // east
    expect(ctx.bot.orientationTarget).toBe(270);
  });

  // --- Sandbox security contract (negative capabilities) -------------------
  // These lock the escape-relevant guarantees of the isolate boundary rather
  // than any single bot API: no host or Node capability leaks into bot scope,
  // and the host-captured dispatch entry points cannot be hijacked by a bot
  // reassigning the globals. A failure here means the sandbox boundary
  // regressed — treat it as a security bug, not a flaky test. See the "exposing
  // a new bot API" checklist in CLAUDE.md (every new `_bot_*` function must
  // return copied plain data, never a live host reference).

  it('denies Node and host globals to bot code', () => {
    // A bare V8 isolate has none of Node's globals, and compiler.ts never
    // exposes the `ivm` module itself — every Callback/Reference/ExternalCopy is
    // built host-side. If any of these becomes reachable, untrusted bot code has
    // a path off the sandbox. `typeof` on an undeclared name is safe (no throw),
    // so this reads uniformly whether the name is a missing global or absent.
    for (const name of [
      'process',
      'require',
      'module',
      'exports',
      'Buffer',
      'global',
      'globalThis.process',
      'setImmediate',
      'ivm',
      '__dirname',
      '__filename',
    ]) {
      expect(ctx.read(`typeof (${name})`)).toBe('undefined');
    }
  });

  it('sets Date to undefined so bots cannot read wall-clock time', () => {
    // Determinism canary: bots must use clock.getTime() (the sim clock), never a
    // real clock. A non-undefined Date means real time — or true entropy — leaked
    // into the isolate.
    expect(ctx.read('typeof Date')).toBe('undefined');
    expect(ctx.read('clock.getTime()')).toBe(42);
  });

  it('replaces Math.random with the in-isolate seeded PRNG (no host entropy)', () => {
    // Math.random is overwritten with a seeded mulberry32 so a fixed arena seed
    // replays a match. It still returns a finite value in [0, 1); the contract
    // is only that it is the in-isolate generator, not the host's.
    const r = ctx.read('Math.random()') as number;
    expect(typeof r).toBe('number');
    expect(Number.isFinite(r)).toBe(true);
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThan(1);
  });

  it('a bot cannot hijack promise settlement by reassigning __settle', async () => {
    // The host settles parked bot promises through a Reference to __settle it
    // captured at init, before any bot code runs. A bot that overwrites
    // globalThis.__settle must NOT intercept settlement: the captured reference
    // still points at the original function object.
    ctx.run(`
      globalThis._settled = null
      globalThis._hijackSettle = false
      globalThis.__settle = () => { globalThis._hijackSettle = true }
      // isRunning() is false in this harness, so the command settles (rejects)
      // immediately — through the captured reference, not the bot's replacement.
      bot
        .setSpeed(3)
        .then(() => { globalThis._settled = 'ok' })
        .catch((e) => { globalThis._settled = 'err:' + e })
    `);
    await waitUntilRead('globalThis._settled', (v) => v !== null);
    expect(ctx.read('globalThis._settled')).not.toBeNull();
    expect(ctx.read('globalThis._hijackSettle')).toBe(false);
  });

  it('a bot cannot hijack event dispatch by reassigning __dispatch', async () => {
    // Events reach handlers through a Reference to __dispatch captured at init.
    // Reassigning globalThis.__dispatch from bot code must not divert dispatch.
    ctx.run(`
      globalThis._started = false
      globalThis._hijackDispatch = false
      bot.on(Event.START, () => { globalThis._started = true })
      globalThis.__dispatch = () => { globalThis._hijackDispatch = true }
    `);
    // Drive the handler the way the simulation loop does.
    ctx.bot.handlers[Event.START]();
    expect(await waitUntilRead('globalThis._started', (v) => v === true)).toBe(
      true
    );
    expect(ctx.read('globalThis._hijackDispatch')).toBe(false);
  });
});

describe('compiler.check — dry-run compile (throwaway isolate)', () => {
  it('accepts valid source', async () => {
    const result = await compiler.check(
      `clock.on(Event.TICK, () => { bot.setSpeed(5) })`
    );
    expect(result).toEqual({ valid: true });
  });

  it('reports a syntax error at the compile stage (E017)', async () => {
    const result = await compiler.check(`function ( {`);
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('compile');
    expect(result.errorCode).toBe('E017');
    expect(result.message).toBeTruthy();
  });

  it('cleans the sandbox internals out of the error message', async () => {
    // The raw V8 message is like "Unexpected end of input [<isolated-vm>:1:12]";
    // authors should see a friendly "(line N, char M)" and no sandbox name.
    const result = await compiler.check(`const x = {`);
    expect(result.message).not.toContain('<isolated-vm>');
    expect(result.message).toMatch(/\(line \d+, char \d+\)/);
  });

  it('reports a top-level throw at the load stage (E017)', async () => {
    const result = await compiler.check(`throw new Error('boom at load')`);
    expect(result.valid).toBe(false);
    expect(result.stage).toBe('load');
    expect(result.errorCode).toBe('E017');
    expect(result.message).toContain('boom at load');
  });

  it('bounds an infinite top-level loop by the sandbox timeout', async () => {
    const prev = process.env.SANDBOX_TIMEOUT_MS;
    process.env.SANDBOX_TIMEOUT_MS = '200';
    try {
      const result = await compiler.check(`while (true) {}`);
      expect(result.valid).toBe(false);
      expect(result.stage).toBe('load');
      expect(result.timedOut).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.SANDBOX_TIMEOUT_MS;
      else process.env.SANDBOX_TIMEOUT_MS = prev;
    }
  });
});

describe('compiler — reload scoping (top-level const/let, E017 regression)', () => {
  let ctx: ReturnType<typeof makeCompiledBot>;

  beforeEach(() => {
    ctx = makeCompiledBot();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    ctx.proc.dispose();
  });

  it('documents the hazard: re-running raw top-level const in one context throws', () => {
    // The bot context is reused across a live save; running author code directly
    // in it re-declares any top-level const/let. This is exactly what wrapSource
    // exists to prevent.
    ctx.run('const DUP = 1;');
    expect(() => ctx.run('const DUP = 1;')).toThrow(/already been declared/);
  });

  it('reloads a bot with top-level const/let without crashing, and keeps this-state', async () => {
    // Top-level const (would collide on reload) + this-state (must survive reload).
    const code = [
      'const FLEE = 40;',
      'let loads = (this.loads || 0) + 1;',
      'this.loads = loads;',
      'this.flee = FLEE;',
      'bot.on(Event.START, () => {});',
    ].join('\n');
    vi.spyOn(appService, 'get').mockResolvedValue({
      getSource: () => code,
    } as unknown as Awaited<ReturnType<typeof appService.get>>);

    // First load.
    await compiler.execute(ctx.proc, ctx.bot);
    expect(ctx.bot.appCrashed).toBeFalsy();
    expect(ctx.read('this.loads')).toBe(1);
    expect(ctx.read('this.flee')).toBe(40);

    // Reload in the SAME context — this is what threw "Identifier 'FLEE' has
    // already been declared" (E017) before wrapSource.
    await compiler.execute(ctx.proc, ctx.bot);
    expect(ctx.bot.appCrashed).toBeFalsy();
    // Top-level const gets a fresh per-load scope (no redeclare error)...
    expect(ctx.read('this.flee')).toBe(40);
    // ...while this-state (globalThis) persists across the reload, as documented.
    expect(ctx.read('this.loads')).toBe(2);
  });
});

describe('compiler.check — dry-run must not touch the database', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // Regression (root cause): a dry-run compile runs the real Bot on a throwaway,
  // non-persisted Process whose appId is a sentinel string. A checked bot that
  // called bot.setName() used to fire appService.get(sentinel), which Postgres
  // rejects with a uuid syntax error (22P02); that fire-and-forget rejection had
  // no .catch, so it escaped as an unhandledRejection and tripped the
  // process.fatal alarm on every check_app_source. The process is now flagged
  // non-persisted, so setName skips the DB entirely — the lookup never happens.
  it('never queries appService when checking a bot that calls setName', async () => {
    const getSpy = vi.spyOn(appService, 'get');

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      const result = await compiler.check('bot.setName("Regression")');
      expect(result.valid).toBe(true);

      // Let any stray fire-and-forget work settle before asserting.
      await new Promise((r) => setTimeout(r, 100));

      expect(getSpy).not.toHaveBeenCalled();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});

describe('Bot.setName — persistence safety net', () => {
  let ctx: ReturnType<typeof makeCompiledBot>;

  beforeEach(() => {
    ctx = makeCompiledBot();
  });
  afterEach(() => {
    ctx.proc.dispose();
    vi.restoreAllMocks();
  });

  // Belt-and-suspenders: on a real (persisted) process, a genuine DB failure while
  // persisting a rename must be swallowed (logged, not fatal) rather than escaping
  // as an unhandledRejection.
  it('swallows a DB rejection instead of leaving it unhandled', async () => {
    const warn = vi.spyOn(logger, 'warn').mockReturnValue(undefined as never);
    vi.spyOn(appService, 'get').mockRejectedValue(new Error('connection lost'));

    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandled);
    try {
      // Persisted process (appId 'app1'), so setName proceeds to the DB lookup.
      expect(ctx.proc.persisted).toBe(true);
      ctx.bot.setName('NewName');

      await new Promise((r) => setTimeout(r, 100));

      expect(warn).toHaveBeenCalled();
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });
});
