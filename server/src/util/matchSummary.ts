import Environment, { SUDDEN_DEATH_TIME } from '../types/environment';
import ArenaMember from '../types/arenaMember';
import { TankStats } from '../types/tankStats';
import appService from '../services/AppService';

// The numeric per-tank counters we aggregate. Derived from a fresh TankStats so
// the summary automatically picks up any field added to that class.
const STAT_KEYS = Object.keys(new TankStats()) as (keyof TankStats)[];

// Builds the match-summary returned by the REST `/summary` endpoint and the MCP
// `match_summary` tool: an outcome-oriented view (leaderboard, winner, aggregated
// stats, elimination order) over an arena's live state. Companion to
// buildArenaStatus (arenaStatus.ts), which is the per-tank physics snapshot; this
// is the "who's winning / who won" view and is most useful once a match is decided.
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

  // Ordered by join time (same as buildArenaStatus) so per-app aggregation is
  // stable; re-sorted into rank order below.
  const entries = env
    .getProcesses()
    .slice()
    .sort(
      (a, b) =>
        (members.find((m) => m?.getAppId() === a.appId)?.getTimestamp() || 0) -
        (members.find((m) => m?.getAppId() === b.appId)?.getTimestamp() || 0)
    )
    .map((process) => {
      const app = apps.find((a) => a?.getId() === process.appId);
      const tanks = process.tanks;

      // Aggregate every TankStats counter across the app's five tanks. Typed by
      // TankStats key (not a string index) so named fields like shotsHit/shotsFired
      // stay accessible for the accuracy calc and the ranking below.
      const stats = {} as Record<keyof TankStats, number>;
      for (const key of STAT_KEYS) {
        stats[key] = tanks.reduce((sum, t) => sum + (t.stats[key] || 0), 0);
      }
      // Fraction of fired shots that connected (0 when the app never fired).
      const accuracy =
        stats.shotsFired > 0 ? stats.shotsHit / stats.shotsFired : 0;

      const tanksAlive = tanks.filter((t) => t.health > 0).length;
      const alive = tanksAlive > 0;
      // An app is eliminated once all its tanks are dead; its elimination time is
      // when its LAST tank fell (null while any tank still lives).
      const eliminatedAt = alive
        ? null
        : tanks.reduce((max, t) => Math.max(max, t.eliminatedAt ?? 0), 0) ||
          null;

      return {
        id: process.appId,
        name: app?.getName(),
        userId: app?.getUserId(),
        alive,
        eliminatedAt,
        tanksAlive,
        tanksTotal: tanks.length,
        totalHealth: tanks.reduce((sum, t) => sum + t.health, 0),
        crashedCount: tanks.filter((t) => t.appCrashed).length,
        stats: { ...stats, accuracy },
        tanks: tanks.map((t) => ({
          id: t.id,
          health: t.health,
          alive: t.health > 0,
          crashed: t.appCrashed,
          eliminatedAt: t.eliminatedAt,
          stats: Object.fromEntries(STAT_KEYS.map((k) => [k, t.stats[k]])),
        })),
      };
    });

  // Rank by outcome: living apps first (more total health, then more tanks still
  // up, then more hits landed); among the eliminated, whoever died LATER ranks
  // higher (survived longest), then more hits.
  entries.sort((a, b) => {
    if (a.alive !== b.alive) return a.alive ? -1 : 1;
    if (a.alive) {
      if (b.totalHealth !== a.totalHealth) return b.totalHealth - a.totalHealth;
      if (b.tanksAlive !== a.tanksAlive) return b.tanksAlive - a.tanksAlive;
      return b.stats.shotsHit - a.stats.shotsHit;
    }
    if ((b.eliminatedAt ?? 0) !== (a.eliminatedAt ?? 0)) {
      return (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0);
    }
    return b.stats.shotsHit - a.stats.shotsHit;
  });

  const leaderboard = entries.map((entry, i) => ({ rank: i + 1, ...entry }));

  const appCount = leaderboard.length;
  const appsAlive = leaderboard.filter((entry) => entry.alive).length;
  // The outcome is settled once at most one app still has living tanks (and there
  // was a real contest of ≥2 apps): the survivor has won, or — if all are dead —
  // the last one eliminated (rank 1) has.
  const decided = appCount >= 2 && appsAlive <= 1;
  const top = leaderboard[0];
  const winner =
    decided && top ? { id: top.id, name: top.name, userId: top.userId } : null;

  return {
    width: arena.getWidth(),
    height: arena.getHeight(),
    seed: env.getSeed(),
    running: env.isRunning(),
    clock: { time },
    match: {
      durationTicks: time,
      suddenDeathTick: SUDDEN_DEATH_TIME,
      suddenDeath: time > SUDDEN_DEATH_TIME,
      appCount,
      appsAlive,
      decided,
      winner,
    },
    leaderboard,
  };
};
