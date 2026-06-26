import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// compiler.ts -> tank.ts -> appService -> util/db runs CREATE TABLE at import.
// Mock the db pool so importing the real modules doesn't reach Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Tank from '../src/types/tank';
import { Process } from '../src/types/environment';
import { Event } from '../src/types/event';

// These are true integration tests: they spin up a real isolated-vm isolate,
// have compiler.init build the bot API into it, then compile/run bot code in the
// sandbox and read values back out. This locks the bot-facing contract before
// any refactor of compiler.ts.

function makeCompiledTank() {
  const emit = vi.fn();
  const proc = new Process('app1');
  const env = {
    getArena: () => ({ getWidth: () => 750, getHeight: () => 600 }),
    getProcesses: () => [proc],
    getTime: () => 42,
    isRunning: () => false, // waitUntil-based bot calls settle immediately
    emit,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const tank = new Tank(env as any, proc as any);
  tank.x = 100;
  tank.y = 200;
  tank.orientation = 0;
  tank.orientationTarget = 0;
  tank.speed = 0;
  tank.speedTarget = 0;
  proc.tanks.push(tank);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  compiler.init(env as any, proc, tank);

  // Run bot code in the sandbox.
  const run = (code: string) =>
    proc.getSandbox().compileScriptSync(code).runSync(tank.getContext());
  // Evaluate an expression inside the isolate and copy the result out.
  const read = (expr: string) =>
    proc
      .getSandbox()
      .compileScriptSync(`(${expr})`)
      .runSync(tank.getContext(), { copy: true });

  return { tank, proc, env, emit, run, read };
}

describe('compiler — bot API in a real isolate', () => {
  let ctx: ReturnType<typeof makeCompiledTank>;

  beforeEach(() => {
    ctx = makeCompiledTank();
  });
  afterEach(() => {
    ctx.proc.dispose();
  });

  it('exposes synchronous getters that copy real values across the boundary', () => {
    expect(ctx.read('bot.getX()')).toBe(100);
    expect(ctx.read('bot.getY()')).toBe(200);
    expect(ctx.read('bot.getId()')).toBe(ctx.tank.id);
    expect(ctx.read('arena.getWidth()')).toBe(750);
    expect(ctx.read('arena.getHeight()')).toBe(600);
    expect(ctx.read('clock.getTime()')).toBe(42);
  });

  it('removes Date and does not leak Node globals into the sandbox', () => {
    // Date is deliberately set to undefined so bots stay deterministic.
    expect(ctx.read('typeof Date')).toBe('undefined');
    expect(ctx.read('typeof process')).toBe('undefined');
    expect(ctx.read('typeof require')).toBe('undefined');
    expect(ctx.read('typeof globalThis.setInterval')).toBe('function');
  });

  it('applies mutating commands to the underlying tank', () => {
    ctx.run('bot.setSpeed(3).catch(() => {})');
    expect(ctx.tank.speedTarget).toBe(3);

    ctx.run('bot.turn(90).catch(() => {})');
    expect(ctx.tank.orientationTarget).toBe(90);

    ctx.run('bot.turret.setOrientation(45).catch(() => {})');
    expect(ctx.tank.turret.orientationTarget).toBe(45);

    ctx.run('bot.radar.setOrientation(10).catch(() => {})');
    expect(ctx.tank.turret.radar.orientationTarget).toBe(10);
  });

  it('clamps setSpeed to the tank speedMax', () => {
    ctx.run('bot.setSpeed(1000).catch(() => {})');
    expect(ctx.tank.speedTarget).toBe(ctx.tank.speedMax);
  });

  it('registers event handlers and runs them through the Reference bridge', async () => {
    ctx.run(`
            globalThis._started = false
            bot.on(Event.START, () => { globalThis._started = true })
        `);
    expect(typeof ctx.tank.handlers[Event.START]).toBe('function');

    // Invoking the handler schedules a setTimeout(0) that calls into the isolate.
    ctx.tank.handlers[Event.START]();
    await new Promise((r) => setTimeout(r, 25));
    expect(ctx.read('globalThis._started')).toBe(true);
  });

  it('wires clock.on(TICK) through to a tank TICK handler', async () => {
    ctx.run(`
            globalThis._ticks = 0
            clock.on(Event.TICK, () => { globalThis._ticks++ })
        `);
    expect(typeof ctx.tank.handlers[Event.TICK]).toBe('function');
    ctx.tank.handlers[Event.TICK]();
    await new Promise((r) => setTimeout(r, 25));
    expect(ctx.read('globalThis._ticks')).toBe(1);
  });

  it('routes console.log to the environment log stream', () => {
    ctx.run(`console.log('hello world')`);
    expect(ctx.emit).toHaveBeenCalledWith(
      'log',
      expect.objectContaining({ time: 42 })
    );
  });

  it('registers tick-driven setInterval timers on the tank', () => {
    ctx.run(`setInterval(() => {}, 5)`);
    expect(Object.keys(ctx.tank.timers.intervalMap)).toHaveLength(1);
  });

  it('exposes the Event enum to bots', () => {
    expect(ctx.read('Event.START')).toBe('START');
    expect(ctx.read('Event.TICK')).toBe('TICK');
  });

  it('copies bot.getHealth() across the boundary as a 0–1 fraction', () => {
    // tank health 100 -> 1.0
    expect(ctx.read('bot.getHealth()')).toBe(1);
  });
});
