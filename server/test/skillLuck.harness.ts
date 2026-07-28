import { describe, it, vi } from 'vitest';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

// ---------------------------------------------------------------------------
// Skill-vs-luck measurement harness (NOT a CI test).
//
// This file is deliberately named `*.harness.ts`, so the default vitest glob
// (`test/**/*.test.ts`) never picks it up. It is run on demand with its own
// config, which is why it lives here rather than under src/ (it must never ship
// in the server build):
//
//   npm run skill-luck                          # from server/, default settings
//   HARNESS_SEEDS=40 npm run skill-luck         # more seeds = tighter estimates
//   HARNESS_MATCHUPS=marksman:survivor npm run skill-luck   # one matchup
//   HARNESS_FULL_DECISION=1 npm run skill-luck   # slow, ladder-faithful (below)
//
// It reuses the exact engine path a ranked ladder match takes — a throwaway,
// non-persisted Environment with two Processes, run through runMatchToDecision
// on a pinned seed — so the numbers it reports are the game's real luck floor,
// not an approximation.
//
// Sudden-death mode (the DEFAULT): balanced matchups often fail to eliminate
// anyone within SUDDEN_DEATH_TIME and grind through the whole health-decay
// phase, which is slow (a 120-match full-decision sweep exceeded 30 minutes) AND
// decides the match by a low-signal tiebreak (decay removes 1hp per LIVING bot,
// so it rewards health concentration, not combat). This mode stops at the
// sudden-death tick and decides by combat standings (the leaderboard is already
// ranked by total health / bots alive / shots hit) — faster, and arguably a
// cleaner combat-skill signal. HARNESS_FULL_DECISION=1 restores the ladder-exact
// full-decay resolution (keep N small); it is NOT the default because of the
// runtime above.
//
// db is mocked so importing the engine never reaches Postgres (mirrors
// simulationIntegration.test.ts); appService.get is then overridden in-process
// to resolve our bot sources by appId, so no database or DB fixtures are needed.
// ---------------------------------------------------------------------------

vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

import appService from '../src/services/AppService';
import App from '../src/types/app';
import Arena from '../src/types/arena';
import Environment, {
  Process,
  SUDDEN_DEATH_TIME,
} from '../src/types/environment';
import ArenaMember from '../src/types/arenaMember';
import { runMatchToDecision } from '../src/util/runMatch';

// A registry mapping our synthetic appIds -> { name, source }. appService.get is
// overridden to read from here; both restart() and the compiler resolve source
// through appService.get(appId), so this is the single injection point.
type Entry = { name: string; source: string };
const registry = new Map<string, Entry>();
appService.get = ((appId: string) => {
  const e = registry.get(appId);
  if (!e) return Promise.resolve(undefined);
  return Promise.resolve(new App(appId, 'harness').hydrate(e.name, e.source));
}) as typeof appService.get;

// ---------------------------------------------------------------------------
// Bot subjects. Loaded from the shipped sample bots (ui/public/samples/*.js) so
// the harness measures real, non-trivial strategies. Point HARNESS_BOT_DIR at
// another directory of `<name>.js` files to measure your own bots instead (e.g.
// sources pulled from the ladder) — handy because the samples are deliberately
// simple and some are chaotic (self-collide / friendly-fire heavily), which
// makes them poor luck-floor probes. Override the roster with HARNESS_MATCHUPS.
// ---------------------------------------------------------------------------
const SAMPLES_DIR =
  process.env.HARNESS_BOT_DIR ??
  join(__dirname, '..', '..', 'ui', 'public', 'samples');

const loadSample = (name: string): string => {
  const path = join(SAMPLES_DIR, `${name}.js`);
  if (!existsSync(path)) {
    throw new Error(
      `bot "${name}" not found at ${path} — check HARNESS_MATCHUPS names / HARNESS_BOT_DIR`
    );
  }
  return readFileSync(path, 'utf8');
};

// Default roster: a self-mirror (the pure luck floor), a skilled-vs-weak pairing
// (expected high decisiveness), and two skilled-vs-skilled pairings.
//
// The luck-floor mirror must be a bot that reliably ENGAGES — an identical pair
// has to fight to a decision for the 50%-baseline to mean anything. `marksman`
// is a passive camper (it only shoots what wanders into view), so a marksman
// mirror just stares and times out with zero combat; `survivor` moves and
// fights, so its mirror actually resolves.
const DEFAULT_MATCHUPS: [string, string][] = [
  ['survivor', 'survivor'], // self-mirror -> engine luck floor (engages)
  ['marksman', 'firstbot'], // skilled vs weak
  ['marksman', 'survivor'], // skilled vs skilled
  ['squad', 'marksman'], // coordinated vs skilled
];

const parseMatchups = (): [string, string][] => {
  const raw = process.env.HARNESS_MATCHUPS;
  if (!raw) return DEFAULT_MATCHUPS;
  return raw.split(',').map((pair) => {
    const [a, b] = pair.split(':').map((s) => s.trim());
    if (!a || !b) throw new Error(`bad HARNESS_MATCHUPS entry: "${pair}"`);
    return [a, b] as [string, string];
  });
};

const SEEDS = Number(process.env.HARNESS_SEEDS ?? 20);
// 60s so the heaviest 5v5 matches can reach the sudden-death tick (~7500) and be
// decided by standings, rather than timing out mid-combat and going uncounted —
// at unbounded speed the busiest matches only simulate ~5900 ticks in 30s.
const MATCH_TIMEOUT_MS = Number(process.env.HARNESS_MATCH_TIMEOUT_MS ?? 60000);
// Default to stopping at sudden death: full decision is impractically slow at any
// useful N (balanced matchups grind through the whole decay phase — a 120-match
// full-decision sweep exceeded 30 minutes). Set HARNESS_FULL_DECISION=1 for the
// slower, ladder-faithful measurement (best kept to a small N).
const STOP_AT_SUDDEN_DEATH = process.env.HARNESS_FULL_DECISION !== '1';

// ---------------------------------------------------------------------------
// One match, run the way the ladder runs it. Returns what the metrics need,
// including each side's aggregated stats (so the report can decompose damage by
// source). `stats` is the per-app sum the match summary already computes.
// ---------------------------------------------------------------------------
type Stats = Record<string, number>;
type Outcome = {
  winner: 'A' | 'B' | null; // A = process 0, B = process 1
  counted: boolean; // a real result (elimination, or standings at sudden death)
  reachedSuddenDeath: boolean;
  ticks: number;
  statsA: Stats;
  statsB: Stats;
};

const runMatch = async (a: Entry, b: Entry, seed: number): Promise<Outcome> => {
  // Distinct appIds even for a self-mirror, so the two sides are separable.
  const appIdA = randomUUID();
  const appIdB = randomUUID();
  registry.set(appIdA, a);
  registry.set(appIdB, b);

  const arena = new Arena(randomUUID(), 'harness');
  const env = new Environment(arena);
  env.processes.push(new Process(appIdA));
  env.processes.push(new Process(appIdB));
  const members = [
    new ArenaMember(appIdA, arena.getId(), 0, true),
    new ArenaMember(appIdB, arena.getId(), 1, true),
  ];

  try {
    const summary = await runMatchToDecision(env, members, {
      seed,
      timeoutMs: MATCH_TIMEOUT_MS,
      stopAtSuddenDeath: STOP_AT_SUDDEN_DEATH,
    });
    const entryA = summary.leaderboard.find((e) => e.id === appIdA);
    const entryB = summary.leaderboard.find((e) => e.id === appIdB);
    const reachedSuddenDeath = summary.clock.time >= SUDDEN_DEATH_TIME;

    // Resolve the winner. An elimination decision always wins. Otherwise, in
    // sudden-death mode, the standings leader (leaderboard rank 1 — total health,
    // then bots alive, then shots hit) is the combat winner. A match that neither
    // decided nor reached sudden death is a genuine timeout: not counted.
    let winnerId: string | null = null;
    let counted = false;
    if (summary.match.decided) {
      winnerId = summary.match.winner?.id ?? null;
      counted = true;
    } else if (STOP_AT_SUDDEN_DEATH && reachedSuddenDeath) {
      winnerId = summary.leaderboard[0]?.id ?? null;
      counted = true;
    }

    return {
      winner: winnerId === appIdA ? 'A' : winnerId === appIdB ? 'B' : null,
      counted,
      reachedSuddenDeath,
      ticks: summary.clock.time,
      statsA: (entryA?.stats ?? {}) as Stats,
      statsB: (entryB?.stats ?? {}) as Stats,
    };
  } finally {
    // Release every isolate before the next match; nothing here is persisted.
    env.processes.forEach((p) => p.dispose());
    registry.delete(appIdA);
    registry.delete(appIdB);
  }
};

// ---------------------------------------------------------------------------
// Statistics helpers.
// ---------------------------------------------------------------------------

// Wilson 95% score interval for a binomial proportion — better than the normal
// approximation at the small seed counts and near-0/1 rates this harness hits.
const wilson95 = (wins: number, n: number): [number, number] => {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = wins / n;
  const denom = 1 + (z * z) / n;
  const center = (p + (z * z) / (2 * n)) / denom;
  const half =
    (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return [Math.max(0, center - half), Math.min(1, center + half)];
};

// Games needed to distinguish a true win-rate p from a coin flip at 95%
// confidence (normal approximation). Infinity as p -> 0.5: an even matchup is
// never resolvable as skill.
const gamesToConfirm = (p: number): number => {
  const edge = Math.abs(p - 0.5);
  if (edge < 1e-9) return Infinity;
  return Math.ceil((1.96 * 1.96 * p * (1 - p)) / (edge * edge));
};

// Approx Elo gap implied by an expected score p: solve p = 1/(1+10^(-d/400)).
const eloGap = (p: number): number => {
  const clamped = Math.min(0.999, Math.max(0.001, p));
  return Math.round(400 * Math.log10(clamped / (1 - clamped)));
};

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;

// The seven damageTaken source buckets, in report order. These sum to the
// side's total damageTaken (see botStats.ts / simulation.ts `damage()`).
const DAMAGE_SOURCES: [label: string, key: string][] = [
  ['enemyFire', 'damageTakenEnemyFire'],
  ['friendlyFire', 'damageTakenFriendlyFire'],
  ['enemyCollide', 'damageTakenEnemyCollision'],
  ['teamCollide', 'damageTakenTeammateCollision'],
  ['wall', 'damageTakenWall'],
  ['suddenDeath', 'damageTakenSuddenDeath'],
  ['selfMiss', 'damageTakenSelfMiss'],
];

// Accumulate one side's stats across all its games.
const emptySums = (): Stats => ({});
const addStats = (into: Stats, from: Stats) => {
  for (const k of Object.keys(from)) into[k] = (into[k] ?? 0) + (from[k] ?? 0);
};
const g = (s: Stats, k: string) => s[k] ?? 0;

// Render one side's damage decomposition + supporting combat stats.
const sideReport = (name: string, s: Stats, games: number): string[] => {
  const taken = DAMAGE_SOURCES.reduce((sum, [, k]) => sum + g(s, k), 0);
  const share = (k: string) => (taken > 0 ? g(s, k) / taken : 0);
  const combat = share('damageTakenEnemyFire');
  const incidental =
    share('damageTakenEnemyCollision') +
    share('damageTakenTeammateCollision') +
    share('damageTakenWall') +
    share('damageTakenSuddenDeath');
  const selfInflicted =
    share('damageTakenFriendlyFire') +
    share('damageTakenTeammateCollision') +
    share('damageTakenWall') +
    share('damageTakenSelfMiss');

  const breakdown = DAMAGE_SOURCES.map(
    ([label, k]) => `${label} ${pct(share(k))}`
  ).join('  ');

  const shotsFired = g(s, 'shotsFired');
  const accuracy = shotsFired > 0 ? g(s, 'shotsHit') / shotsFired : 0;
  const dealt = g(s, 'damageDealt');
  const friendlyShare = dealt > 0 ? g(s, 'damageDealtFriendly') / dealt : 0;
  const collides = g(s, 'timesCollided');
  const teamCollideShare =
    collides > 0 ? g(s, 'timesCollidedTeammate') / collides : 0;

  return [
    `  ${name}:`,
    `    damage taken   ${Math.round(taken / games)}/game   ` +
      `combat ${pct(combat)} · incidental ${pct(incidental)} · ` +
      `self-inflicted ${pct(selfInflicted)}`,
    `      by source    ${breakdown}`,
    `    damage dealt   ${Math.round(dealt / games)}/game   ` +
      `friendly-fire ${pct(friendlyShare)}   accuracy ${pct(accuracy)}`,
    `    collisions     ${(collides / games).toFixed(1)}/game   ` +
      `teammate ${pct(teamCollideShare)}   ` +
      `travel ${Math.round(g(s, 'distanceTraveled') / games)}/game`,
  ];
};

// ---------------------------------------------------------------------------
// The harness body.
// ---------------------------------------------------------------------------
describe('skill-vs-luck measurement harness', () => {
  it(
    'measures the engine luck floor and per-matchup decisiveness',
    async () => {
      const matchups = parseMatchups();
      const out: string[] = [];
      const log = (line = '') => {
        out.push(line);
      };

      log('');
      log('='.repeat(72));
      log(
        `SKILL vs LUCK — ${SEEDS} seeds/order, timeout ${MATCH_TIMEOUT_MS}ms` +
          (STOP_AT_SUDDEN_DEATH
            ? ', STOP-AT-SUDDEN-DEATH (combat standings)'
            : ', full decision')
      );
      log('='.repeat(72));

      for (const [nameA, nameB] of matchups) {
        const a: Entry = { name: nameA, source: loadSample(nameA) };
        const b: Entry = { name: nameB, source: loadSample(nameB) };
        const selfMirror = nameA === nameB;

        // Seeds 1..SEEDS. Every seed is run in BOTH orders (A as team 0 / B as
        // team 0) so we can measure positional luck (the seed-swap flip) and
        // neutralize it in the aggregate win-rate.
        let aWins = 0; // A's wins across both orders
        let games = 0; // counted (decided) games
        let flips = 0; // seeds where swapping sides flipped the winner
        let team0Wins = 0; // process-0 wins, position bias signal
        let team0Games = 0;
        let suddenDeaths = 0; // matches that reached the sudden-death tick
        let uncounted = 0; // timeouts / undecided
        let ticksSum = 0;
        const sumsA = emptySums();
        const sumsB = emptySums();

        for (let s = 1; s <= SEEDS; s++) {
          const fwd = await runMatch(a, b, s); // A=team0, B=team1
          const rev = await runMatch(b, a, s); // B=team0, A=team1

          // fwd: A's stats are statsA; rev: A is team1, so A's stats are statsB.
          addStats(sumsA, fwd.statsA);
          addStats(sumsA, rev.statsB);
          addStats(sumsB, fwd.statsB);
          addStats(sumsB, rev.statsA);

          for (const r of [fwd, rev]) {
            if (!r.counted) uncounted++;
            if (r.reachedSuddenDeath) suddenDeaths++;
            ticksSum += r.ticks;
            if (r.counted && r.winner) {
              team0Games++;
              if (r.winner === 'A') team0Wins++; // team0 == process0
            }
          }

          const aWonFwd = fwd.winner === 'A';
          const aWonRev = rev.winner === 'B';
          if (fwd.counted) {
            games++;
            if (aWonFwd) aWins++;
          }
          if (rev.counted) {
            games++;
            if (aWonRev) aWins++;
          }

          // Flip: same seed, both decided, but the winning SIDE (team 0 vs team
          // 1) changed when we swapped who sat on team 0.
          if (fwd.counted && rev.counted) {
            const team0WonFwd = fwd.winner === 'A';
            const team0WonRev = rev.winner === 'B';
            if (team0WonFwd !== team0WonRev) flips++;
          }
        }

        const totalGames = 2 * SEEDS;
        const p = games > 0 ? aWins / games : 0.5; // A's neutralized win-rate
        const [lo, hi] = wilson95(aWins, games);
        const decisiveness = Math.abs(2 * p - 1);
        const flipRate = flips / SEEDS;
        const team0Rate = team0Games > 0 ? team0Wins / team0Games : 0.5;
        const [t0lo, t0hi] = wilson95(team0Wins, team0Games);

        log('');
        log('-'.repeat(72));
        if (selfMirror) {
          log(`LUCK FLOOR — ${nameA} vs itself  (${totalGames} games)`);
          log('-'.repeat(72));
          log(
            `  team-0 win-rate     ${pct(team0Rate)}  ` +
              `[95% CI ${pct(t0lo)}–${pct(t0hi)}]`
          );
          log(
            `      -> identical skill, so any deviation from 50% is pure luck.`
          );
          log(
            `         CI width ${pct(t0hi - t0lo)} is the seed noise at this N.`
          );
          log(`  seed-swap flip rate ${pct(flipRate)}  (winner changed sides)`);
          log(`      -> share of matches decided by starting position alone.`);
        } else {
          log(`MATCHUP — ${nameA} (A) vs ${nameB} (B)  (${totalGames} games)`);
          log('-'.repeat(72));
          log(
            `  ${nameA} win-rate    ${pct(p)}  ` +
              `[95% CI ${pct(lo)}–${pct(hi)}]   (position-neutralized)`
          );
          log(
            `  decisiveness        ${decisiveness.toFixed(2)}   ` +
              `(0 = coin flip, 1 = deterministic)`
          );
          log(`  implied Elo gap     ~${eloGap(p)}`);
          const n = gamesToConfirm(p);
          log(
            `  games to confirm    ${
              Number.isFinite(n) ? n : '∞'
            }  (to call skill > luck at 95%)`
          );
          log(`  seed-swap flip rate ${pct(flipRate)}  (positional luck)`);
          log(
            `  team-0 win-rate     ${pct(team0Rate)}  ` +
              `[95% CI ${pct(t0lo)}–${pct(t0hi)}]  (side bias, want ~50%)`
          );
        }
        const avgTicks = Math.round(ticksSum / totalGames);
        log(
          `  reached sudden-death ${pct(suddenDeaths / totalGames)}   ` +
            `avg length ${avgTicks} ticks   uncounted ${uncounted}`
        );
        log('');
        log('  damage sources (per side, aggregated over all games):');
        for (const line of sideReport(nameA, sumsA, totalGames)) log(line);
        for (const line of sideReport(nameB, sumsB, totalGames)) log(line);
      }

      log('');
      log('='.repeat(72));
      log('Reading the results:');
      log('  * LUCK FLOOR team-0 rate far from 50% => structural side bias.');
      log('  * high flip rate => start position, not play, decides matches.');
      log('  * low decisiveness / high "games to confirm" => the ladder needs');
      log('    many games to see a real skill gap (luck is drowning skill).');
      log(
        '  * high "reached sudden-death" => combat rarely resolves the match;'
      );
      log(
        '    the decay tiebreak (a low-skill mechanic) is deciding outcomes.'
      );
      log('  * damage sources: high combat share = skill channel; high');
      log(
        '    incidental/self-inflicted = position/coordination (fixable/luck).'
      );
      log('='.repeat(72));
      log('');

      const report = out.join('\n');
      const reportPath =
        process.env.HARNESS_REPORT ??
        join(__dirname, '..', 'skill-luck-report.txt');
      writeFileSync(reportPath, report + '\n', 'utf8');
      // eslint-disable-next-line no-console
      console.log(report + `\n\n(report written to ${reportPath})`);
    },
    // Generous ceiling: many full 5v5 matches with real isolates.
    30 * 60 * 1000
  );
});
