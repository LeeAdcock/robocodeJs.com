import { describe, it, expect, vi } from 'vitest';

// End-to-end ladder match: the REAL Environment + compiler + isolated-vm run a
// 1v1 to a decision, exercising LadderService's ephemeral-arena wiring (Processes
// pushed directly, synthetic members, runMatchToDecision). Only the database is
// mocked — it serves two real bot sources for appService.get and swallows the
// rating/history writes.
const APP_ROWS: Record<string, { source: string }> = {
  aggressor: {
    // Accelerate, sweep the turret, and fire on cooldown — enough to land hits.
    source: `
      bot.on(Event.START, () => { bot.setSpeed(5) })
      clock.on(Event.TICK, () => {
        bot.radar.scan()
        if (bot.turret.isReady()) bot.turret.fire()
        bot.turret.turn(7)
      })
    `,
  },
  sitter: {
    // Passive target: does nothing, so the aggressor should win (or sudden death
    // forces a decision either way).
    source: `bot.setName('Sitter')`,
  },
};

vi.mock('../src/util/db', () => ({
  default: {
    query: (arg: unknown) => {
      const text =
        typeof arg === 'string'
          ? arg
          : ((arg as { text?: string; values?: unknown[] })?.text ?? '');
      const values =
        typeof arg === 'string'
          ? []
          : ((arg as { values?: unknown[] })?.values ?? []);
      if (/FROM app WHERE id=\$1/i.test(text)) {
        const id = values[0] as string;
        const row = APP_ROWS[id];
        if (!row) return Promise.resolve({ rows: [], rowCount: 0 });
        return Promise.resolve({
          rows: [
            {
              userId: `owner-${id}`,
              name: id,
              source: row.source,
              rating: 1500,
              ratingGames: 0,
              broken: false,
            },
          ],
          rowCount: 1,
        });
      }
      // All other queries (DDL, rating UPDATEs, ranked_match INSERT) succeed.
      return Promise.resolve({ rows: [], rowCount: 1 });
    },
  },
}));

import ladderService from '../src/services/LadderService';

describe('LadderService — real isolate match (integration)', () => {
  it('runs an ephemeral 1v1 to a decision and moves ratings', async () => {
    const res = await ladderService.runOneMatch('aggressor', 'sitter', {
      seed: 42,
      timeoutMs: 30000,
    });

    expect(res.ran).toBe(true);
    expect(res.decided).toBe(true);
    expect(['aggressor', 'sitter']).toContain(res.winnerId);
    // A decided, non-both-crashed match rates: winner up, loser down.
    const winner = res.winnerId === 'aggressor' ? res.a! : res.b!;
    const loser = res.winnerId === 'aggressor' ? res.b! : res.a!;
    expect(winner.delta).toBeGreaterThan(0);
    expect(loser.delta).toBeLessThan(0);
    // Locks released after teardown.
    expect(ladderService.isBusy('aggressor')).toBe(false);
    expect(ladderService.isBusy('sitter')).toBe(false);
  }, 40000);
});
