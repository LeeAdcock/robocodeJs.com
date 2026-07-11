import Environment from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { buildMatchSummary } from './matchSummary';

// Run one match in an arena to a decision (or a timeout) and return its match
// summary. Optionally reseeds first, then runs unbounded ("as fast as the bots
// can be driven"): it restarts the arena — re-firing every bot's START — and
// resumes it (restart() alone silently leaves the arena PAUSED), polls until at
// most one app still has living bots (`match.decided`) or the arena stops (all
// dead) or the wall-clock timeout elapses, then pauses and restores the arena's
// prior speed.
//
// Shared by the MCP run_match / run_tournament tools (api/mcp.ts) and the global
// ladder (services/LadderService.ts) so the two drive a match identically.
export const DEFAULT_MATCH_TIMEOUT_MS = 60000;

export const runMatchToDecision = async (
  env: Environment,
  members: ArenaMember[],
  opts: { seed?: number; timeoutMs?: number } = {}
): Promise<Awaited<ReturnType<typeof buildMatchSummary>>> => {
  if (opts.seed !== undefined) env.setSeed(opts.seed);
  const priorSpeed = env.getSpeed();
  env.setSpeed(0); // unbounded — decide the match as quickly as possible
  await env.restart();
  env.resume(); // restart() does not resume

  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_MATCH_TIMEOUT_MS);
  let summary = await buildMatchSummary(env, members);
  while (!summary.match.decided && env.isRunning() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    summary = await buildMatchSummary(env, members);
  }

  env.pause();
  env.setSpeed(priorSpeed);
  return buildMatchSummary(env, members);
};
