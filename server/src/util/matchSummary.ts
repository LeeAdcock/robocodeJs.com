import Environment, { SUDDEN_DEATH_TIME } from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { BotStats } from '../types/botStats';
import appService from '../services/AppService';

// The numeric per-bot counters we aggregate. Derived from a fresh BotStats so
// the summary automatically picks up any field added to that class.
const STAT_KEYS = Object.keys(new BotStats()) as (keyof BotStats)[];

// ── Shared ranking / outcome contract ──────────────────────────────────────
// buildMatchSummary (the full "who won and how" view) and buildMatchStatus (the
// lightweight "is it decided / who's ahead" view) MUST agree on rank order, the
// decided flag, and the winner. They share the helpers below so the two can never
// drift apart — the whole point of exposing them as separate, single-purpose
// tools rather than one tool with a verbosity flag.

// Processes ordered by arena join time — the stable base order before the rank
// sort (mirrors buildArenaStatus's ordering).
const byJoinTime =
  (members: ArenaMember[]) => (a: { appId: string }, b: { appId: string }) =>
    (members.find((m) => m?.getAppId() === a.appId)?.getTimestamp() || 0) -
    (members.find((m) => m?.getAppId() === b.appId)?.getTimestamp() || 0);

// The per-app fields the outcome ordering depends on.
type Ranked = {
  alive: boolean;
  totalHealth: number;
  botsAlive: number;
  eliminatedAt: number | null;
  shotsHit: number;
};

// Rank by outcome: living apps first (more total health, then more bots still
// up, then more hits landed); among the eliminated, whoever died LATER ranks
// higher (survived longest), then more hits.
const compareForRank = (a: Ranked, b: Ranked): number => {
  if (a.alive !== b.alive) return a.alive ? -1 : 1;
  if (a.alive) {
    if (b.totalHealth !== a.totalHealth) return b.totalHealth - a.totalHealth;
    if (b.botsAlive !== a.botsAlive) return b.botsAlive - a.botsAlive;
    return b.shotsHit - a.shotsHit;
  }
  if ((b.eliminatedAt ?? 0) !== (a.eliminatedAt ?? 0)) {
    return (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0);
  }
  return b.shotsHit - a.shotsHit;
};

// Sort a list of apps into outcome-rank order. `key` projects each item to the
// ranking view, so callers keep whatever richer shape they emit — the ranking
// inputs are decoupled from the emitted fields.
const rankSort = <T>(items: T[], key: (t: T) => Ranked): T[] =>
  items.slice().sort((a, b) => compareForRank(key(a), key(b)));

// Arena-level match meta (duration, sudden death, counts, decided, winner),
// derived from apps already in rank order (rank 1 first).
const deriveMatch = (
  ranked: { id: string; name?: string; userId?: string; alive: boolean }[],
  time: number
) => {
  const appCount = ranked.length;
  const appsAlive = ranked.filter((e) => e.alive).length;
  // Settled once at most one app still has living bots (and there was a real
  // contest of ≥2 apps): the survivor has won, or — if all are dead — the last
  // one eliminated (rank 1) has.
  const decided = appCount >= 2 && appsAlive <= 1;
  const top = ranked[0];
  const winner =
    decided && top ? { id: top.id, name: top.name, userId: top.userId } : null;
  return {
    durationTicks: time,
    suddenDeathTick: SUDDEN_DEATH_TIME,
    suddenDeath: time > SUDDEN_DEATH_TIME,
    appCount,
    appsAlive,
    decided,
    winner,
  };
};

// Builds the match-summary returned by the REST `/summary` endpoint and the MCP
// `match_summary` tool: an outcome-oriented view (leaderboard, winner, aggregated
// stats, elimination order) over an arena's live state. Companion to
// buildArenaStatus (arenaStatus.ts), the per-bot physics snapshot, and to
// buildMatchStatus below, the lightweight decision/standings view; this is the
// "who won and how" view and is most useful once a match is decided.
//
// Computed live from the in-memory Environment — there is no persistence, so it is
// only meaningful while the arena is still resident (EnvironmentService disposes
// stopped arenas after ~30 minutes).
export const buildMatchSummary = async (
  env: Environment,
  members: ArenaMember[]
) => {
  const arena = env.getArena();
  const apps = await Promise.all(
    members.map((member) => appService.get(member.getAppId()))
  );

  // clock.time resets to 0 on restart, so it is the current match's duration and
  // elimination ticks are already match-relative.
  const time = env.getTime();

  const entries = env
    .getProcesses()
    .slice()
    .sort(byJoinTime(members))
    .map((process) => {
      const app = apps.find((a) => a?.getId() === process.appId);
      const bots = process.bots;

      // Aggregate every BotStats counter across the app's five bots. Typed by
      // BotStats key (not a string index) so named fields like shotsHit/shotsFired
      // stay accessible for the accuracy calc and the ranking below.
      const stats = {} as Record<keyof BotStats, number>;
      for (const key of STAT_KEYS) {
        stats[key] = bots.reduce((sum, t) => sum + (t.stats[key] || 0), 0);
      }
      // Fraction of fired shots that connected (0 when the app never fired).
      const accuracy =
        stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : 0;

      const botsAlive = bots.filter((t) => t.health > 0).length;
      const alive = botsAlive > 0;
      // An app is eliminated once all its bots are dead; its elimination time is
      // when its LAST bot fell (null while any bot still lives).
      const eliminatedAt = alive
        ? null
        : bots.reduce((max, t) => Math.max(max, t.eliminatedAt ?? 0), 0) ||
          null;

      return {
        id: process.appId,
        name: app?.getName(),
        userId: app?.getUserId(),
        alive,
        eliminatedAt,
        botsAlive,
        botsTotal: bots.length,
        totalHealth: bots.reduce((sum, t) => sum + t.health, 0),
        crashedCount: bots.filter((t) => t.appCrashed).length,
        stats: { ...stats, accuracy },
        bots: bots.map((t) => ({
          id: t.id,
          health: t.health,
          alive: t.health > 0,
          crashed: t.appCrashed,
          eliminatedAt: t.eliminatedAt,
          stats: Object.fromEntries(STAT_KEYS.map((k) => [k, t.stats[k]])),
        })),
      };
    });

  const ranked = rankSort(entries, (e) => ({
    alive: e.alive,
    totalHealth: e.totalHealth,
    botsAlive: e.botsAlive,
    eliminatedAt: e.eliminatedAt,
    shotsHit: e.stats.shotsHit,
  }));

  const leaderboard = ranked.map((entry, i) => ({ rank: i + 1, ...entry }));

  return {
    width: arena.getWidth(),
    height: arena.getHeight(),
    seed: env.getSeed(),
    running: env.isRunning(),
    clock: { time },
    match: deriveMatch(leaderboard, time),
    leaderboard,
  };
};

// Builds the lightweight match status returned by the REST `/match-status`
// endpoint and the MCP `match_status` tool: the decision fields plus a coarse
// standings list, with NONE of the per-bot stat blocks or per-bot arrays. It
// answers a different question than its companions — "is the match over, and
// who's ahead?" — so it is cheap to poll repeatedly while a match runs, where
// arena_status (spatial) and match_summary (full stats) are both large. The rank
// order, `decided`, and `winner` are computed by the shared helpers above, so a
// standings row and a leaderboard row always agree.
export const buildMatchStatus = async (
  env: Environment,
  members: ArenaMember[]
) => {
  const apps = await Promise.all(
    members.map((member) => appService.get(member.getAppId()))
  );
  const time = env.getTime();

  const entries = env
    .getProcesses()
    .slice()
    .sort(byJoinTime(members))
    .map((process) => {
      const app = apps.find((a) => a?.getId() === process.appId);
      const bots = process.bots;
      const botsAlive = bots.filter((t) => t.health > 0).length;
      const alive = botsAlive > 0;
      const eliminatedAt = alive
        ? null
        : bots.reduce((max, t) => Math.max(max, t.eliminatedAt ?? 0), 0) ||
          null;
      return {
        id: process.appId,
        name: app?.getName(),
        userId: app?.getUserId(),
        alive,
        eliminatedAt,
        botsAlive,
        totalHealth: bots.reduce((sum, t) => sum + t.health, 0),
        // Ranking tiebreak only — not emitted in the standings.
        shotsHit: bots.reduce((sum, t) => sum + (t.stats.shotsHit || 0), 0),
      };
    });

  const ranked = rankSort(entries, (e) => e);

  const standings = ranked.map((e, i) => ({
    rank: i + 1,
    id: e.id,
    name: e.name,
    alive: e.alive,
    botsAlive: e.botsAlive,
    totalHealth: e.totalHealth,
    eliminatedAt: e.eliminatedAt,
  }));

  return {
    running: env.isRunning(),
    clock: { time },
    match: deriveMatch(ranked, time),
    standings,
  };
};
