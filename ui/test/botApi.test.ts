import { describe, it, expect } from 'vitest';
import { completionsFor, generateDts, EVENTS } from '../src/util/botApi';

describe('completionsFor', () => {
  it('offers the top-level globals when typing a bare identifier', () => {
    const names = completionsFor('  bo').map((c) => c.value);
    expect(names).toContain('bot');
    // Unrelated globals are filtered out by the prefix.
    expect(names).not.toContain('arena');
  });

  it('offers Bot members (incl. nested objects) after `bot.`', () => {
    const names = completionsFor('bot.').map((c) => c.value);
    expect(names).toEqual(
      expect.arrayContaining(['radar', 'turret', 'setSpeed', 'on', 'getX'])
    );
  });

  it('resolves nested object paths like `bot.radar.`', () => {
    const names = completionsFor('  return bot.radar.').map((c) => c.value);
    expect(names).toEqual(
      expect.arrayContaining(['scan', 'turn', 'isReady', 'turnTowards'])
    );
    // Radar has no `fire` — that belongs to the turret.
    expect(names).not.toContain('fire');
  });

  it('filters members by the typed prefix', () => {
    const names = completionsFor('bot.set').map((c) => c.value);
    expect(names).toEqual(
      expect.arrayContaining(['setSpeed', 'setOrientation', 'setName'])
    );
    expect(names).not.toContain('getX');
  });

  it('offers the Event constants after `Event.`', () => {
    const names = completionsFor('bot.on(Event.').map((c) => c.value);
    expect(names).toEqual(expect.arrayContaining(EVENTS.map((e) => e.name)));
  });

  it('includes signatures and hover docs on completions', () => {
    const fire = completionsFor('bot.turret.').find((c) => c.value === 'fire');
    expect(fire?.caption).toBe('fire()');
    expect(fire?.meta).toBe('Promise<{ id?: string }>');
    expect(fire?.docHTML).toContain('bot.turret.fire()');
    expect(fire?.docHTML).toContain('Fires the turret');
  });

  it('returns nothing for an unknown object (defers to other completers)', () => {
    expect(completionsFor('foo.')).toEqual([]);
  });
});

describe('generateDts', () => {
  it('declares the API globals and typed event overloads', () => {
    const dts = generateDts();
    expect(dts).toContain('declare const bot: Bot;');
    expect(dts).toContain(
      "on(event: 'HIT', handler: (event: { angle: number })"
    );
    expect(dts).toContain("on(event: 'TICK', handler: () => void");
    expect(dts).toContain('declare const Event: {');
  });

  // Generates (on first run / `-u`) and then guards the committed file the docs
  // link to, so the shipped type definitions can never silently drift from the
  // model that powers in-editor autocomplete.
  it('matches the committed public/docs/ts/robocode.d.ts', async () => {
    await expect(generateDts()).toMatchFileSnapshot(
      '../public/docs/ts/robocode.d.ts'
    );
  });
});
