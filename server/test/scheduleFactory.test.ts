import { describe, it, expect, vi } from 'vitest';
import {
  scheduleFactory,
  timerTick,
  TimersContainer,
  MAX_TIMERS_PER_TANK,
} from '../src/util/scheduleFactory';

// Bot setInterval/setTimeout are monkey-patched to advance with simulation
// ticks (clock.getTime()), not wall-clock time. A bot's setTimeout(fn, 5)
// therefore fires after 5 *ticks*. These tests lock that behavior in.

function makeTank(health = 100) {
  return {
    health,
    logger: { trace: vi.fn(), warn: vi.fn() },
    timers: new TimersContainer(),
  };
}

function makeEnv(tank: ReturnType<typeof makeTank>) {
  const state = { time: 0 };
  return {
    state,
    getTime: () => state.time,
    getProcesses: () => [{ tanks: [tank] }],
  };
}

describe('scheduleFactory + timerTick', () => {
  it('fires an interval every `interval` ticks', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setInterval(1, fn, 5, env as never);

    env.state.time = 4;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 9;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 10;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('fires a timeout once then removes it', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setTimeout(1, fn, 3, env as never);

    env.state.time = 2;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();

    env.state.time = 3;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);

    env.state.time = 10;
    timerTick(env as never);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('clearInterval stops a pending interval', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    const sched = scheduleFactory(tank);
    const id = sched.setInterval(7, fn, 1, env as never);
    sched.clearInterval(id);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });

  it('clearTimeout cancels a pending timeout', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const fn = vi.fn();
    const sched = scheduleFactory(tank);
    const id = sched.setTimeout(8, fn, 2, env as never);
    sched.clearTimeout(id);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });

  it('does not fire timers for a destroyed tank', () => {
    const tank = makeTank(0); // health 0
    const env = makeEnv(tank);
    const fn = vi.fn();
    scheduleFactory(tank).setInterval(1, fn, 1, env as never);

    env.state.time = 5;
    timerTick(env as never);
    expect(fn).not.toHaveBeenCalled();
  });

  // Resource-exhaustion guard (A04-1): a bot cannot register an unbounded number
  // of timers. Each host-side timer costs memory and per-tick CPU, so past the
  // cap registration is refused (returns the falsy sentinel 0) and E021 is
  // warned to the bot console once.
  it('rejects timers past MAX_TIMERS_PER_TANK and warns E021 once', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const sched = scheduleFactory(tank);

    for (let i = 0; i < MAX_TIMERS_PER_TANK; i++) {
      expect(sched.setInterval(i + 1, vi.fn(), 5, env as never)).toBe(i + 1);
    }
    expect(tank.timers.size()).toBe(MAX_TIMERS_PER_TANK);

    // Two more registrations (interval + timeout) are both refused, and the map
    // does not grow.
    expect(sched.setInterval(9001, vi.fn(), 5, env as never)).toBe(0);
    expect(sched.setTimeout(9002, vi.fn(), 5, env as never)).toBe(0);
    expect(tank.timers.size()).toBe(MAX_TIMERS_PER_TANK);

    // Warned exactly once despite multiple rejections (no console flooding).
    expect(tank.logger.warn).toHaveBeenCalledTimes(1);
    expect(String(tank.logger.warn.mock.calls[0][0])).toContain('E021');
  });

  it('frees a slot after clearInterval so a new timer can register again', () => {
    const tank = makeTank();
    const env = makeEnv(tank);
    const sched = scheduleFactory(tank);

    for (let i = 0; i < MAX_TIMERS_PER_TANK; i++) {
      sched.setInterval(i + 1, vi.fn(), 5, env as never);
    }
    expect(sched.setInterval(9001, vi.fn(), 5, env as never)).toBe(0); // full

    sched.clearInterval(1); // free one slot
    expect(sched.setInterval(9002, vi.fn(), 5, env as never)).toBe(9002);
  });
});
