import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';

// Smoke-test the shipped sample bots: load each into a real isolate, drive it
// through the simulation, fire the events it might handle, and assert it never
// crashes (appCrashed). Catches broken samples before they ship.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import compiler from '../src/util/compiler';
import Tank from '../src/types/tank';
import { Process } from '../src/types/environment';
import Simulation from '../src/util/simulation';
import { Event } from '../src/types/event';

const SAMPLES_DIR = path.join(process.cwd(), '..', 'ui', 'public', 'samples');
const samples = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.js'));

describe('sample bots run without crashing', () => {
  it.each(samples)('%s loads, runs, and handles its events', async (file) => {
    const source = fs.readFileSync(path.join(SAMPLES_DIR, file), 'utf-8');

    const procs: Process[] = [];
    let clock = 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const env: any = {
      getArena: () => ({ getWidth: () => 750, getHeight: () => 750 }),
      getProcesses: () => procs,
      getTime: () => clock,
      isRunning: () => true,
      emit: () => undefined,
    };
    const proc = new Process('app1');
    procs.push(proc);
    const tank = new Tank(env, proc);
    proc.tanks.push(tank);
    tank.x = 375;
    tank.y = 375;
    // Let scanning/firing actually happen.
    tank.turret.radar.charged = 100;
    tank.turret.loaded = 100;

    compiler.init(env, proc, tank);
    proc
      .getSandbox()
      .compileScriptSync(source)
      .runSync(tank.getContext(), { timeout: 5000 });

    const tick = async (n: number) => {
      for (let i = 0; i < n; i++) {
        // Keep turret/radar ready so firing/scanning chains actually progress
        // (otherwise a bot awaiting onReady stalls for ~50 ticks and deep code
        // paths never run within the test).
        tank.turret.loaded = 100;
        tank.turret.radar.charged = 100;
        Simulation.run(env);
        clock++;
        await new Promise((r) => setTimeout(r, 15));
      }
    };

    // START + TICK run via the simulation; then fire the inbound events a bot
    // might subscribe to (no-ops if it doesn't), and drive long enough for the
    // resulting async chains (turn/aim/fire/scan) to fully play out.
    await tick(10);
    tank.handlers[Event.HIT]?.({ angle: 45 });
    tank.handlers[Event.COLLIDED]?.({ angle: 45, friendly: false });
    tank.handlers[Event.RECEIVED]?.(123456);
    tank.handlers[Event.DETECTED]?.();
    await tick(30);

    expect(tank.appCrashed).toBe(false);
    proc.dispose();
  });
});
