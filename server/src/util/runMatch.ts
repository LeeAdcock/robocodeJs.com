import Environment from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { buildMatchSummary, isMatchDecided } from './matchSummary';

// Thrown by runMatchToDecision when the target arena already has a driven match
// in flight. The MCP run_match tool turns this into a clean "arena busy" result
// instead of corrupting the running match (see api/mcp.ts).
export class ArenaBusyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArenaBusyError';
  }
}

// Run one match in an arena to a decision (or a timeout) and return its match
// summary. Optionally reseeds first, then runs unbounded ("as fast as the bots
// can be driven"): it restarts the arena — re-firing every bot's START — and
// resumes it (restart() alone silently leaves the arena PAUSED), polls until at
// most one app still has living bots (`match.decided`) or the arena stops (all
// dead) or the wall-clock timeout elapses, then pauses and restores the arena's
// prior speed.
//
// Two guarantees matter here because run_match drives the caller's LIVE arena:
//
//  1. Mutual exclusion. env.beginMatch() claims the arena up front and throws
//     ArenaBusyError if another match is already driving it — a second concurrent
//     match would stomp this one's restart/seed/speed state (the corruption seen
//     when a slow run_match timed out client-side and the client retried). The
//     claim is released in a `finally`.
//
//  2. Wall-clock bound. The timeout deadline is fixed BEFORE restart() and the
//     poll loop tests a cheap synchronous predicate (isMatchDecided — no
//     per-iteration DB/summary build), so `timeoutMs` bounds the whole operation
//     (restart + settle + polling), not just the loop. Previously the deadline
//     was set after restart and each poll rebuilt the full summary, so on a
//     loaded box a "60s" match could run well past that.
//
// The pause + prior-speed restore also run in a `finally`: if restart() or the
// final buildMatchSummary throws mid-match, the arena must not be left running at
// the unbounded speed we set (a CPU-pinning state on the small prod box) — it has
// to be returned to its prior speed and paused regardless of how this exits.
//
// Shared by the MCP run_match tool (api/mcp.ts) and the global ladder
// (services/LadderService.ts) so the two drive a match identically.
export const DEFAULT_MATCH_TIMEOUT_MS = 60000;

export const runMatchToDecision = async (
  env: Environment,
  members: ArenaMember[],
  opts: { seed?: number; timeoutMs?: number } = {}
): Promise<Awaited<ReturnType<typeof buildMatchSummary>>> => {
  if (!env.beginMatch()) {
    throw new ArenaBusyError(
      'This arena already has a match running; wait for it to finish before starting another.'
    );
  }
  try {
    if (opts.seed !== undefined) env.setSeed(opts.seed);
    const priorSpeed = env.getSpeed();
    env.setSpeed(0); // unbounded — decide the match as quickly as possible

    // Fix the deadline before any of the driven work (restart + settling) begins
    // so timeoutMs bounds the whole operation, not just the poll loop below.
    const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS);
    try {
      await env.restart();
      env.resume(); // restart() does not resume

      // Poll a cheap synchronous predicate (no DB/summary build per iteration) so
      // the loop cost stays negligible and the deadline actually bounds wall clock.
      while (!isMatchDecided(env) && env.isRunning() && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }

      env.pause();
      // Build the authoritative summary once, at the end (its `match.decided`
      // flag is what the caller reports as timedOut when false).
      return await buildMatchSummary(env, members);
    } finally {
      // Always leave the arena paused at its prior speed, even if the match threw
      // — otherwise a failed match strands the live arena at unbounded speed.
      env.pause();
      env.setSpeed(priorSpeed);
    }
  } finally {
    env.endMatch();
  }
};
