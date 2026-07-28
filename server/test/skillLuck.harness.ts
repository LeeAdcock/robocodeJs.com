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
//   npm run skill-luck                       # from server/, default settings
//   HARNESS_SEEDS=40 npm run skill-luck      # more seeds = tighter estimates
//   HARNESS_MATCHUPS=marksman:survivor npm run skill-luck   # one matchup
//
// It reuses the exact engine path a ranked ladder match takes — a throwaway,
// non-persisted Environment with two Processes, run through runMatchToDecision
// on a pinned seed — so the numbers it reports are the game's real luck floor,
// not an approximation.
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
import Environment, { Process } from '../src/types/environment';
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
// the harness measures real, non-trivial strategies. Override the roster with
// HARNESS_MATCHUPS.
// ---------------------------------------------------------------------------
const SAMPLES_DIR = join(__dirname, '..', '..', 'ui', 'public', 'samples');

const loadSample = (name: string): string => {
  const path = join(SAMPLES_DIR, `${name}.js`);
  if (!existsSync(path)) {
    throw new Error(
      `sample bot "${name}" not found at ${path} — check HARNESS_MATCHUPS names`
    );
  }
  return readFileSync(path, 'utf8');
};

// Default roster: a self-mirror (the pure luck floor), a skilled-vs-weak pairing
// (expected high decisiveness), and two skilled-vs-skilled pairings.
const DEFAULT_MATCHUPS: [string, string][] = [
  ['marksman', 'marksman'], // self-mirror -> engine luck floor
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
const MATCH_TIMEOUT_MS = Number(process.env.HARNESS_MATCH_TIMEOUT_MS ?? 30000);

// ---------------------------------------------------------------------------
// One match, run the way the ladder runs it. Returns just what the metrics need.
// ---------------------------------------------------------------------------
type Outcome = {
  winner: 'A' | 'B' | null; // A = process 0, B = process 1
  decided: boolean;
  suddenDeath: boolean;
  ticks: number;
  healthA: number;
  healthB: number;
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
    });
    const entryA = summary.leaderboard.find((e) => e.id === appIdA);
    const entryB = summary.leaderboard.find((e) => e.id === appIdB);
    const winnerId = summary.match.decided
      ? (summary.match.winner?.id ?? null)
      : null;
    return {
      winner: winnerId === appIdA ? 'A' : winnerId === appIdB ? 'B' : null,
      decided: summary.match.decided,
      suddenDeath: summary.match.suddenDeath,
      ticks: summary.clock.time,
      healthA: entryA?.totalHealth ?? 0,
      healthB: entryB?.totalHealth ?? 0,
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
        `SKILL vs LUCK — ${SEEDS} seeds/order, timeout ${MATCH_TIMEOUT_MS}ms`
      );
      log('='.repeat(72));

      for (const [nameA, nameB] of matchups) {
        const a: Entry = { name: nameA, source: loadSample(nameA) };
        const b: Entry = { name: nameB, source: loadSample(nameB) };
        const selfMirror = nameA === nameB;

        // Seeds 1..SEEDS. Every seed is run in BOTH orders (A as team 0 / B as
        // team 0) so we can measure positional luck (the seed-swap flip) and
        // neutralize it in the aggregate win-rate.
        let aWins = 0; // A's wins across both orders (2*SEEDS games)
        let games = 0;
        let flips = 0; // seeds where swapping sides flipped the winner
        let team0Wins = 0; // process-0 wins, position bias signal
        let team0Games = 0;
        let suddenDeaths = 0;
        let timeouts = 0;
        let ticksSum = 0;

        for (let s = 1; s <= SEEDS; s++) {
          const fwd = await runMatch(a, b, s); // A=team0, B=team1
          const rev = await runMatch(b, a, s); // B=team0, A=team1

          for (const r of [fwd, rev]) {
            if (!r.decided) timeouts++;
            if (r.suddenDeath) suddenDeaths++;
            ticksSum += r.ticks;
            if (r.winner) {
              team0Games++;
              if (r.winner === 'A') team0Wins++; // team0 == process0
            }
          }

          // A's result in each order (A is winner 'A' in fwd, winner 'B' in rev).
          const aWonFwd = fwd.winner === 'A';
          const aWonRev = rev.winner === 'B';
          if (fwd.decided) {
            games++;
            if (aWonFwd) aWins++;
          }
          if (rev.decided) {
            games++;
            if (aWonRev) aWins++;
          }

          // Flip: same seed, both decided, but the winning SIDE (team 0 vs team
          // 1) changed when we swapped who sat on team 0. team0 winner fwd is A
          // iff aWonFwd; team0 winner rev is B iff !aWonRev... express via winner
          // labels directly: fwd team0 winner = fwd.winner==='A'; rev team0
          // winner = rev.winner==='B' (B is team0 in rev). Flip when they differ.
          if (fwd.decided && rev.decided) {
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
          `  sudden-death rate   ${pct(suddenDeaths / totalGames)}   ` +
            `avg length ${avgTicks} ticks   timeouts ${timeouts}`
        );
      }

      log('');
      log('='.repeat(72));
      log('Reading the results:');
      log('  * LUCK FLOOR team-0 rate far from 50% => structural side bias.');
      log('  * high flip rate => start position, not play, decides matches.');
      log('  * low decisiveness / high "games to confirm" => the ladder needs');
      log('    many games to see a real skill gap (luck is drowning skill).');
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
