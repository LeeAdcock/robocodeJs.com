import { describe, it, expect, vi } from 'vitest';

// End-to-end ladder match: the REAL Environment + compiler + isolated-vm run a
// 1v1 to a decision, exercising LadderService's ephemeral-arena wiring (Processes
// pushed directly, synthetic members, runMatchToDecision). Only the database is
// mocked — it serves two real bot sources for appService.get, keeps a tiny
// in-memory ladder_claim table (the cross-instance claim, GitHub #409), and
// swallows the rating/history writes.
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

// appId -> token of the match holding it.
const claims = new Map<string, string>();

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
      if (/INSERT INTO ladder_claim/i.test(text)) {
        const [a, b, token] = values as string[];
        for (const id of [a, b]) if (!claims.has(id)) claims.set(id, token);
        return Promise.resolve({ rows: [], rowCount: 2 });
      }
      if (/SELECT appId, token FROM ladder_claim/i.test(text)) {
        const rows = (values as string[])
          .filter((id) => claims.has(id))
          .map((id) => ({ appid: id, token: claims.get(id) }));
        return Promise.resolve({ rows, rowCount: rows.length });
      }
      if (
        /DELETE FROM ladder_claim WHERE appId IN \(\$1,\$2\) AND token/i.test(
          text
        )
      ) {
        const [a, b, token] = values as string[];
        for (const id of [a, b])
          if (claims.get(id) === token) claims.delete(id);
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
      // All other queries (DDL, stale-claim expiry, rating UPDATEs,
      // ranked_match INSERT) succeed.
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
    // Locks released after teardown: the local guard and the shared claim.
    expect(ladderService.isBusy('aggressor')).toBe(false);
    expect(ladderService.isBusy('sitter')).toBe(false);
    expect(claims.size).toBe(0);
  }, 40000);
});
