import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end tests of the sandbox + simulation together: a real bot is compiled
// into a real isolated-vm isolate, then driven through the real Simulation loop
// tick by tick, and the resulting bot state is asserted. This is the live game
// path minus the 100ms setInterval (we advance ticks manually) and the database.
//
// db is mocked so importing the engine doesn't reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Bot from '../src/types/bot';
import { Process, DEPLOY_TICKS } from '../src/types/environment';
import Simulation from '../src/util/simulation';
import { makeSimEnv } from './simEnv';

function makeWorld() {
  const world = makeSimEnv({ run: (env) => Simulation.run(env) });
  const { env, processes, events, faults, tick, setClock } = world;
  // These scenarios exercise live combat, so start past the damage-free
  // deployment window — turrets are weapons-held until DEPLOY_TICKS. The warm-up
  // gate itself is unit-tested in botTypes.test.ts.
  setClock(DEPLOY_TICKS);

  // Compile a bot's source into a fresh isolate-backed bot at a fixed pose.
  const addBot = (
    source: string,
    appId: string,
    pose: { x?: number; y?: number; orientation?: number } = {}
  ): Bot => {
    const proc = new Process(appId);
    processes.push(proc);
    const bot = new Bot(env as any, proc);
    proc.bots.push(bot);
    bot.x = pose.x ?? 375;
    bot.y = pose.y ?? 375;
    bot.orientation = pose.orientation ?? 0;
    bot.orientationTarget = bot.orientation;
    compiler.init(env as any, proc, bot);
    // Running the source registers the bot's handlers/timers (synchronously).
    proc
      .getSandbox()
      .compileScriptSync(source)
      .runSync(bot.getContext(), { timeout: 5000 });
    // Loaded synchronously here, so Simulation may start/tick it immediately.
    bot.codeLoaded = true;
    return bot;
  };

  const dispose = () =>
    processes.forEach((p) => p.bots.forEach((t) => t.getContext().release()));

  return { env, processes, events, faults, addBot, tick, setClock, dispose };
}

describe('sandbox + simulation integration', () => {
  let world: ReturnType<typeof makeWorld>;
  beforeEach(() => {
    world = makeWorld();
  });
  afterEach(() => world.dispose());

  it('drives a bot forward when the bot accelerates', async () => {
    const bot = world.addBot(
      `bot.on(Event.START, () => { bot.setSpeed(5) })`,
      'mover'
    );
    expect(bot.y).toBe(375);

    await world.tick(14);

    // orientation 0 => movement is +y; speed ramps to the requested target
    expect(bot.speed).toBe(5);
    expect(bot.y).toBeGreaterThan(390);
    expect(bot.x).toBeCloseTo(375, 5); // no sideways drift
  });

  it('rotates a bot to its target orientation', async () => {
    const bot = world.addBot(
      `bot.on(Event.START, () => { bot.setOrientation(90) })`,
      'turner'
    );

    await world.tick(20);

    // The bot API is north-zero (90 = east); internally that's south-zero 270.
    // `bot.getOrientation()` reads the internal value.
    expect(bot.getOrientation()).toBe(270);
  });

  it('spawns a bullet that travels when the bot fires', async () => {
    const bot = world.addBot(
      `clock.on(Event.TICK, () => { if (bot.turret.isReady()) bot.turret.fire() })`,
      'gunner'
    );
    bot.turret.loaded = 100; // ready to fire immediately

    await world.tick(1);
    expect(bot.bullets.length).toBeGreaterThan(0);

    const startY = bot.bullets[0].y;
    await world.tick(3);
    expect(bot.bullets[0].y).not.toBe(startY); // bullet is moving
  });

  it('kills a bot whose handler throws', async () => {
    const bot = world.addBot(
      `bot.on(Event.START, () => { throw new Error('boom') })`,
      'crasher'
    );
    expect(bot.health).toBe(100);

    await world.tick(2); // START throws -> appCrashed -> next tick kills it

    expect(bot.appCrashed).toBe(true);
    expect(bot.health).toBe(0);
  });

  it('does not crash when an uncaught command rejection escapes a handler', async () => {
    // Awaiting a command that another command supersedes rejects it (documented
    // behavior). If the bot doesn't .catch() it, that rejection escapes the
    // async handler — which must NOT kill the bot. The bot keeps running and
    // honors the latest target.
    const bot = world.addBot(
      `bot.on(Event.START, async () => {
         const superseded = bot.setOrientation(90)
         bot.setOrientation(270) // supersede -> 'superseded' rejects
         await superseded        // uncaught rejection leaves the handler
       })`,
      'resilient'
    );
    expect(bot.health).toBe(100);

    await world.tick(20);

    expect(bot.appCrashed).toBe(false);
    expect(bot.health).toBe(100); // still alive
    // Final API target was north-zero 270 (west) -> internal south-zero 90.
    expect(bot.getOrientation()).toBe(90); // kept running, reached new target
  });

  it('fires a tick-driven setTimeout after its interval elapses', async () => {
    const bot = world.addBot(
      `setTimeout(() => { bot.setSpeed(3) }, 3)`,
      'timer'
    );

    await world.tick(2);
    expect(bot.speedTarget).toBe(0); // interval not yet elapsed

    await world.tick(4);
    expect(bot.speedTarget).toBe(3); // timer fired and applied the command
  });

  it('lets one bot destroy another with sustained fire', async () => {
    // Shooter aimed at a stationary target a short distance away (+y).
    const shooter = world.addBot(
      `clock.on(Event.TICK, () => { if (bot.turret.isReady()) bot.turret.fire() })`,
      'shooter',
      { x: 375, y: 300, orientation: 0 }
    );
    // Turret starts at a random angle; aim it straight ahead so the bullet
    // travels +y toward the target.
    shooter.turret.orientation = 0;
    shooter.turret.orientationTarget = 0;
    shooter.turret.loaded = 100;
    const target = world.addBot(`/* sitting duck */`, 'target', {
      x: 375,
      y: 360,
    });

    const startHealth = target.health;
    await world.tick(40);

    expect(target.health).toBeLessThan(startHealth); // took bullet damage
    expect(shooter.stats.shotsFired).toBeGreaterThan(0);
  });

  it('detects an enemy with the radar (SCANNED + DETECTED)', async () => {
    const scanner = world.addBot(
      `bot.on(Event.SCANNED, (targets) => {
         if (targets.length === 1 && targets[0].friendly === false) bot.setSpeed(4)
       })
       clock.on(Event.TICK, () => { if (bot.radar.isReady()) bot.radar.scan() })`,
      'scanner',
      { x: 375, y: 375, orientation: 0 }
    );
    // Body/turret/radar all start at random angles; aim everything straight
    // ahead (orientation 0 => +y) so the radar beam covers the enemy.
    scanner.turret.orientation = 0;
    scanner.turret.orientationTarget = 0;
    scanner.turret.radar.orientation = 0;
    scanner.turret.radar.orientationTarget = 0;
    scanner.turret.radar.charged = 100;

    const enemy = world.addBot(
      `bot.on(Event.DETECTED, () => bot.setSpeed(2))`,
      'enemy',
      { x: 375, y: 475 } // 100 units ahead (+y), within radar range/beam
    );

    await world.tick(8);

    // SCANNED fired with exactly the (non-friendly) enemy
    expect(scanner.speed).toBe(4);
    // and the enemy's own DETECTED handler fired
    expect(enemy.speed).toBe(2);
    expect(enemy.stats.timesDetected).toBeGreaterThan(0);
  });

  it('aims at a scanned enemy with the body-relative bearing and hits it', async () => {
    // End-to-end proof of the bearing convention: the bot feeds the scan's
    // `angle` straight into bot.turret.setOrientation(...) (no subtraction) and
    // fires. If the bearing weren't body-relative, the shot would miss.
    const sniper = world.addBot(
      `bot.on(Event.SCANNED, (targets) => {
         const enemy = targets.find((t) => !t.friendly)
         if (enemy) return bot.turret.setOrientation(enemy.angle)
           .then(() => bot.turret.onReady())
           .then(() => bot.turret.fire())
           .catch(() => {})
       })
       clock.on(Event.TICK, () => { if (bot.radar.isReady()) bot.radar.scan() })`,
      'sniper',
      { x: 375, y: 375, orientation: 0 }
    );
    sniper.turret.orientation = 0;
    sniper.turret.orientationTarget = 0;
    sniper.turret.radar.orientation = 0;
    sniper.turret.radar.orientationTarget = 0;
    sniper.turret.radar.charged = 100;
    sniper.turret.loaded = 100;

    // Enemy 100 units straight ahead (+y). The body-relative bearing to it is 0,
    // so turret.setOrientation(0) keeps the gun on target.
    const enemy = world.addBot(`bot.setName('dummy')`, 'enemy', {
      x: 375,
      y: 475,
    });
    expect(enemy.health).toBe(100);

    await world.tick(15);

    expect(enemy.health).toBeLessThan(100); // the shot connected
  });

  it('fires COLLIDED when a bot drives into a wall', async () => {
    const bot = world.addBot(
      `bot.on(Event.COLLIDED, () => bot.turret.fire())
       bot.on(Event.START, () => bot.setSpeed(5))`,
      'bumper',
      { x: 375, y: 730, orientation: 0 } // near the bottom wall, moving +y
    );
    bot.turret.orientation = 0;
    bot.turret.orientationTarget = 0;
    bot.turret.loaded = 100;

    await world.tick(8);

    expect(bot.stats.timesCollided).toBeGreaterThan(0);
    // The COLLIDED handler ran and fired (the bullet itself leaves bounds
    // immediately from against the wall, so assert on the persistent stat).
    expect(bot.stats.shotsFired).toBeGreaterThan(0);
  });

  it('delivers messages between bots (send -> RECEIVED)', async () => {
    const sender = world.addBot(
      `bot.on(Event.START, () => bot.send(42))`,
      'sender',
      { x: 200, y: 200 }
    );
    const receiver = world.addBot(
      `bot.on(Event.RECEIVED, () => bot.setSpeed(2))`,
      'receiver',
      { x: 550, y: 550 } // far apart, no collision
    );

    await world.tick(6);

    expect(sender.stats.messagesSent).toBeGreaterThan(0);
    expect(receiver.stats.messagesReceived).toBeGreaterThan(0);
    expect(receiver.speed).toBe(2); // RECEIVED handler ran with the message
  });

  it('delivers a structured message with the sender distance (send -> RECEIVED)', async () => {
    world.addBot(`bot.on(Event.START, () => bot.send({ go: 3 }))`, 'sender', {
      x: 200,
      y: 200,
    });
    const receiver = world.addBot(
      `bot.on(Event.RECEIVED, (msg, from) => {
         if (msg && msg.go && from.distance > 0) bot.setSpeed(msg.go)
       })`,
      'receiver',
      { x: 200, y: 500 } // 300 units from the sender
    );

    await world.tick(6);

    // The receiver only accelerates if it decoded the object payload AND saw a
    // positive sender distance — proving the rich message + provenance crossed
    // the real isolate boundary in both directions.
    expect(receiver.speed).toBe(3);
  });

  it('lets a bot read the advancing clock via clock.getTime()', async () => {
    world.setClock(0); // this test asserts on absolute clock values, not combat
    const bot = world.addBot(
      `clock.on(Event.TICK, () => { if (clock.getTime() >= 5) bot.setSpeed(2) })`,
      'clockreader'
    );

    await world.tick(3);
    expect(bot.speedTarget).toBe(0); // clock < 5

    await world.tick(5);
    expect(bot.speedTarget).toBe(2); // clock reached 5, command applied
  });

  it('fires the FIRED event after shooting', async () => {
    const bot = world.addBot(
      `bot.on(Event.FIRED, () => bot.setSpeed(1))
       clock.on(Event.TICK, () => { if (bot.turret.isReady()) bot.turret.fire() })`,
      'firer'
    );
    bot.turret.orientation = 0;
    bot.turret.orientationTarget = 0;
    bot.turret.loaded = 100;

    await world.tick(6);

    expect(bot.speed).toBe(1); // FIRED handler ran
  });

  it('exposes dropMarker / arena.createMarker geometry', async () => {
    // A marker dropped at the bot's own position reports zero distance.
    const bot = world.addBot(
      `bot.on(Event.START, () => {
         const m = bot.dropMarker()
         if (m.getDistance() === 0) bot.setSpeed(2)
       })`,
      'marker'
    );

    await world.tick(3);

    expect(bot.speedTarget).toBe(2);
  });

  it('turns a bot by a relative amount (bot.turn)', async () => {
    const bot = world.addBot(
      `bot.on(Event.START, () => bot.turn(30))`,
      'relturner',
      { x: 375, y: 375, orientation: 0 }
    );

    await world.tick(8);

    expect(bot.getOrientation()).toBe(30);
  });

  it('reports a structured botFault when a handler throws (E013)', async () => {
    const bot = world.addBot(
      `clock.on(Event.TICK, () => { throw new Error('boom') })`,
      'crasher'
    );

    await world.tick(2);

    expect(bot.appCrashed).toBe(true);
    const fault = world.faults.find((f) => f.code === 'E013');
    expect(fault).toBeDefined();
    expect(fault).toMatchObject({ kind: 'handler', appId: 'crasher' });
    expect(String(fault?.message)).toContain('boom');
    // The isolate stack gives a line inside the bot source.
    expect(typeof fault?.line).toBe('number');
    // ...and it was broadcast as a botFault event.
    expect(
      world.events.some(
        (e) =>
          e.name === 'event' &&
          (e.payload as { type?: string }).type === 'botFault'
      )
    ).toBe(true);
  });
});
