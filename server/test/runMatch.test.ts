import { describe, it, expect, vi, beforeEach } from 'vitest';

// runMatch -> matchSummary -> services -> util/db runs DDL at import. Mock the db
// pool and the summary builder so this unit test stays pure (no isolate/DB).
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/util/matchSummary', () => ({
  buildMatchSummary: vi.fn(),
}));

import { runMatchToDecision } from '../src/util/runMatch';
import { buildMatchSummary } from '../src/util/matchSummary';

// A mock Environment exposing only the surface runMatchToDecision drives.
const makeEnv = () => ({
  setSeed: vi.fn(),
  getSpeed: vi.fn(() => 3), // prior speed to restore
  setSpeed: vi.fn(),
  restart: vi.fn().mockResolvedValue(undefined),
  resume: vi.fn(),
  pause: vi.fn(),
  isRunning: vi.fn(() => true),
});

beforeEach(() => vi.clearAllMocks());

describe('runMatchToDecision', () => {
  it('reseeds, runs unbounded, then pauses and restores the prior speed', async () => {
    const env = makeEnv();
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1', name: 'Winner' } },
      leaderboard: [{ rank: 1, id: 'a1' }],
    } as never);

    const summary = await runMatchToDecision(env as never, [], { seed: 42 });

    expect(env.setSeed).toHaveBeenCalledWith(42);
    expect(env.setSpeed).toHaveBeenNthCalledWith(1, 0); // unbounded during the match
    expect(env.restart).toHaveBeenCalled();
    expect(env.resume).toHaveBeenCalled(); // restart() leaves it paused
    expect(env.pause).toHaveBeenCalled();
    // Prior speed restored (getSpeed returned 3).
    expect(env.setSpeed).toHaveBeenLastCalledWith(3);
    expect(summary.match.winner.id).toBe('a1');
  });

  // The regression this PR fixes: run_tournament calls this once per seed on the
  // caller's LIVE arena. If the match throws mid-run, the arena must not be left
  // stranded at the unbounded speed (0) we set — the finally must restore it.
  it('restores the prior speed and pauses even when the match throws', async () => {
    const env = makeEnv();
    vi.mocked(buildMatchSummary).mockRejectedValue(new Error('summary boom'));

    await expect(
      runMatchToDecision(env as never, [], { seed: 7 })
    ).rejects.toThrow('summary boom');

    // Set to unbounded, then restored to the prior speed despite the throw.
    expect(env.setSpeed).toHaveBeenNthCalledWith(1, 0);
    expect(env.setSpeed).toHaveBeenLastCalledWith(3);
    expect(env.pause).toHaveBeenCalled();
  });

  it('restores the prior speed when restart() itself rejects', async () => {
    const env = makeEnv();
    env.restart.mockRejectedValue(new Error('restart boom'));

    await expect(runMatchToDecision(env as never, [])).rejects.toThrow(
      'restart boom'
    );

    expect(env.setSpeed).toHaveBeenNthCalledWith(1, 0);
    expect(env.setSpeed).toHaveBeenLastCalledWith(3);
    expect(env.pause).toHaveBeenCalled();
    // buildMatchSummary is never reached if restart rejects first.
    expect(buildMatchSummary).not.toHaveBeenCalled();
  });
});
