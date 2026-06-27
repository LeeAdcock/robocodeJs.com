import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// End-to-end tests of the sandbox + simulation together: a real bot is compiled
// into a real isolated-vm isolate, then driven through the real Simulation loop
// tick by tick, and the resulting tank state is asserted. This is the live game
// path minus the 100ms setInterval (we advance ticks manually) and the database.
//
// db is mocked so importing the engine doesn't reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Tank from '../src/types/tank';
import { Process } from '../src/types/environment';
import Simulation from '../src/util/simulation';

// Handlers and timers now run off-thread via async apply, so give each tick a
// moment for the scheduled work (setTimeout(0) -> apply) to settle before the
// next tick reads/advances state.
const SETTLE_MS = 25;
const settle = () => new Promise((r) => setTimeout(r, SETTLE_MS));

function makeWorld() {
  const processes: Process[] = [];
  let clock = 0;
  const events: { name: string; payload: unknown }[] = [];

  // The bits of Environment that Simulation, timers, and Tank actually read.
  const env = {
    getArena: () => ({ getWidth: () => 750, getHeight: () => 750 }),
    getProcesses: () => processes,
    getTime: () => clock,
    isRunning: () => true,
    emit: (name: string, payload: unknown) => events.push({ name, payload }),
  };

  // Compile a bot's source into a fresh isolate-backed tank at a fixed pose.
  const addBot = (
    source: string,
    appId: string,
    pose: { x?: number; y?: number; orientation?: number } = {}
  ): Tank => {
    const proc = new Process(appId);
    processes.push(proc);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const tank = new Tank(env as any, proc);
    proc.tanks.push(tank);
    tank.x = pose.x ?? 375;
    tank.y = pose.y ?? 375;
    tank.orientation = pose.orientation ?? 0;
    tank.orientationTarget = tank.orientation;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    compiler.init(env as any, proc, tank);
    // Running the source registers the bot's handlers/timers (synchronously).
    proc
      .getSandbox()
      .compileScriptSync(source)
      .runSync(tank.getContext(), { timeout: 5000 });
    return tank;
  };

  // Advance the simulation n ticks, letting async handlers settle each tick.
  const tick = async (n = 1) => {
    for (let i = 0; i < n; i++) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      Simulation.run(env as any);
      clock += 1;
      await settle();
    }
  };

  const dispose = () =>
    processes.forEach((p) => p.tanks.forEach((t) => t.getContext().release()));

  return { env, processes, events, addBot, tick, dispose };
}

describe('sandbox + simulation integration', () => {
  let world: ReturnType<typeof makeWorld>;
  beforeEach(() => {
    world = makeWorld();
  });
  afterEach(() => world.dispose());

  it('drives a tank forward when the bot accelerates', async () => {
    const tank = world.addBot(
      `bot.on(Event.START, () => { bot.setSpeed(5) })`,
      'mover'
    );
    expect(tank.y).toBe(375);

    await world.tick(14);

    // orientation 0 => movement is +y; speed ramps to the requested target
    expect(tank.speed).toBe(5);
    expect(tank.y).toBeGreaterThan(390);
    expect(tank.x).toBeCloseTo(375, 5); // no sideways drift
  });

  it('rotates a tank to its target orientation', async () => {
    const tank = world.addBot(
      `bot.on(Event.START, () => { bot.setOrientation(90) })`,
      'turner'
    );

    await world.tick(20);

    expect(tank.getOrientation()).toBe(90);
  });

  it('spawns a bullet that travels when the bot fires', async () => {
    const tank = world.addBot(
      `clock.on(Event.TICK, () => { if (bot.turret.isReady()) bot.turret.fire() })`,
      'gunner'
    );
    tank.turret.loaded = 100; // ready to fire immediately

    await world.tick(1);
    expect(tank.bullets.length).toBeGreaterThan(0);

    const startY = tank.bullets[0].y;
    await world.tick(3);
    expect(tank.bullets[0].y).not.toBe(startY); // bullet is moving
  });

  it('kills a bot whose handler throws', async () => {
    const tank = world.addBot(
      `bot.on(Event.START, () => { throw new Error('boom') })`,
      'crasher'
    );
    expect(tank.health).toBe(100);

    await world.tick(2); // START throws -> appCrashed -> next tick kills it

    expect(tank.appCrashed).toBe(true);
    expect(tank.health).toBe(0);
  });

  it('fires a tick-driven setTimeout after its interval elapses', async () => {
    const tank = world.addBot(
      `setTimeout(() => { bot.setSpeed(3) }, 3)`,
      'timer'
    );

    await world.tick(2);
    expect(tank.speedTarget).toBe(0); // interval not yet elapsed

    await world.tick(4);
    expect(tank.speedTarget).toBe(3); // timer fired and applied the command
  });

  it('lets one tank destroy another with sustained fire', async () => {
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

  it('fires COLLIDED when a tank drives into a wall', async () => {
    const tank = world.addBot(
      `bot.on(Event.COLLIDED, () => bot.turret.fire())
       bot.on(Event.START, () => bot.setSpeed(5))`,
      'bumper',
      { x: 375, y: 730, orientation: 0 } // near the bottom wall, moving +y
    );
    tank.turret.orientation = 0;
    tank.turret.orientationTarget = 0;
    tank.turret.loaded = 100;

    await world.tick(8);

    expect(tank.stats.timesCollided).toBeGreaterThan(0);
    // The COLLIDED handler ran and fired (the bullet itself leaves bounds
    // immediately from against the wall, so assert on the persistent stat).
    expect(tank.stats.shotsFired).toBeGreaterThan(0);
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

  it('lets a bot read the advancing clock via clock.getTime()', async () => {
    const tank = world.addBot(
      `clock.on(Event.TICK, () => { if (clock.getTime() >= 5) bot.setSpeed(2) })`,
      'clockreader'
    );

    await world.tick(3);
    expect(tank.speedTarget).toBe(0); // clock < 5

    await world.tick(5);
    expect(tank.speedTarget).toBe(2); // clock reached 5, command applied
  });

  it('fires the FIRED event after shooting', async () => {
    const tank = world.addBot(
      `bot.on(Event.FIRED, () => bot.setSpeed(1))
       clock.on(Event.TICK, () => { if (bot.turret.isReady()) bot.turret.fire() })`,
      'firer'
    );
    tank.turret.orientation = 0;
    tank.turret.orientationTarget = 0;
    tank.turret.loaded = 100;

    await world.tick(6);

    expect(tank.speed).toBe(1); // FIRED handler ran
  });

  it('exposes dropMarker / arena.createMarker geometry', async () => {
    // A marker dropped at the tank's own position reports zero distance.
    const tank = world.addBot(
      `bot.on(Event.START, () => {
         const m = bot.dropMarker()
         if (m.getDistance() === 0) bot.setSpeed(2)
       })`,
      'marker'
    );

    await world.tick(3);

    expect(tank.speedTarget).toBe(2);
  });

  it('turns a tank by a relative amount (bot.turn)', async () => {
    const tank = world.addBot(
      `bot.on(Event.START, () => bot.turn(30))`,
      'relturner',
      { x: 375, y: 375, orientation: 0 }
    );

    await world.tick(8);

    expect(tank.getOrientation()).toBe(30);
  });
});
