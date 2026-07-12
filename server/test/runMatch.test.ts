import { describe, it, expect, vi, beforeEach } from 'vitest';

// runMatch -> matchSummary -> services -> util/db runs DDL at import. Mock the db
// pool and the summary builder so this unit test stays pure (no isolate/DB).
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));
vi.mock('../src/util/matchSummary', () => ({
  buildMatchSummary: vi.fn(),
  // Default the poll predicate to "decided" so the loop exits on the first pass
  // (tests that want it undecided override per-case).
  isMatchDecided: vi.fn(() => true),
}));

import { runMatchToDecision, ArenaBusyError } from '../src/util/runMatch';
import { buildMatchSummary, isMatchDecided } from '../src/util/matchSummary';

// A mock Environment exposing only the surface runMatchToDecision drives.
const makeEnv = () => ({
  beginMatch: vi.fn(() => true), // claim succeeds by default
  endMatch: vi.fn(),
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
    // Claimed the arena for the match and released it afterwards.
    expect(env.beginMatch).toHaveBeenCalled();
    expect(env.endMatch).toHaveBeenCalled();
  });

  // The corruption this guard fixes: two matches driving the same live arena at
  // once (a client retrying a slow run_match). The second must refuse, not touch
  // the arena, and not release the first's claim.
  it('throws ArenaBusyError without touching the arena when a match is in flight', async () => {
    const env = makeEnv();
    env.beginMatch.mockReturnValue(false); // arena already claimed

    await expect(
      runMatchToDecision(env as never, [], { seed: 1 })
    ).rejects.toThrow(ArenaBusyError);

    expect(env.setSeed).not.toHaveBeenCalled();
    expect(env.setSpeed).not.toHaveBeenCalled();
    expect(env.restart).not.toHaveBeenCalled();
    // The claim it didn't take must not be released.
    expect(env.endMatch).not.toHaveBeenCalled();
  });

  it('does not poll buildMatchSummary per iteration — decision uses the cheap predicate', async () => {
    const env = makeEnv();
    vi.mocked(isMatchDecided).mockReturnValue(true); // decided immediately
    vi.mocked(buildMatchSummary).mockResolvedValue({
      match: { decided: true, winner: { id: 'a1' } },
      leaderboard: [{ rank: 1, id: 'a1' }],
    } as never);

    await runMatchToDecision(env as never, []);

    // Exactly one authoritative summary build, at the end — not once per poll.
    expect(buildMatchSummary).toHaveBeenCalledTimes(1);
    expect(isMatchDecided).toHaveBeenCalled();
  });

  // run_match drives the caller's LIVE arena. If the match throws mid-run, the
  // arena must not be left stranded at the unbounded speed (0) we set — the
  // finally must restore it (and release the match claim).
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
    // The claim is released even when the match throws.
    expect(env.endMatch).toHaveBeenCalled();
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
