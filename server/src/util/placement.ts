// Fair, low-variance match starts — with randomized (unpredictable) positions.
//
// History: the original placement dropped every bot at a uniform-random point, so
// one team could clump in a corner while another got the open center — and that
// positional luck, not skill, decided most matches. We then moved to a fully
// symmetric formation: fair, but a bot could read its own position and the arena
// size and, since only a single global rotation varied, analytically reconstruct
// every enemy's spot at t=0 without ever scanning.
//
// This version keeps the fairness but restores the unpredictability. Team CLUSTER
// CENTERS still sit on a rotationally symmetric ring (every team the same distance
// from center, walls, and nearest enemy cluster), but each team's bots are
// scattered RANDOMLY within their cluster and then recentered so the cluster's
// centroid lands exactly on its symmetric center. Recentering is a rigid
// translation, so it preserves teammate spacing while keeping centroid-level
// fairness exact — yet the individual spots are random, so opponents have to be
// found with radar rather than predicted. A seeded team->slot shuffle keeps team
// creation order from mapping to a fixed angular position.
//
// Determinism: every random choice draws from the passed [0,1) rng in a fixed
// order, so a fixed seed reproduces the layout exactly. The rejection sampler
// draws a variable-but-seed-deterministic number of values; because the same
// arena rng also seeds each bot's in-isolate Math.random afterward, changing the
// draw count here changes which reproducible match a given seed maps to — not
// reproducibility itself.
//
// Pure (takes width/height and a [0,1) rng, plus one shared geometry constant)
// so it is trivially unit-testable and reproducible.

import { BOT_RADIUS } from '../types/bot';

export interface Spawn {
  x: number;
  y: number;
  orientation: number; // absolute compass heading, 0 = north, clockwise
}

// Minimum spacing between a team's own bots, and the retry budget the rejection
// sampler gets before it falls back to the best-spaced candidate it has seen.
const MIN_SEP = 40;
const MAX_TRIES = 64;

const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;
const rad = (deg: number): number => (deg * Math.PI) / 180;

// Absolute heading that points from (x,y) toward (tx,ty) in the game's compass
// frame (0 = north/-y, 90 = east/+x): forward is (sin H, -cos H).
const headingToward = (x: number, y: number, tx: number, ty: number): number =>
  normalizeDeg((Math.atan2(tx - x, y - ty) * 180) / Math.PI);

// Returns spawns[team][slot]. Team cluster centers are evenly spaced on a circle
// around the arena center (symmetric → fair); each team's bots are scattered at
// random within their cluster (unpredictable) and recentered so the cluster
// centroid sits exactly on the symmetric center (fair by construction). Every bot
// faces the center.
export function computeSpawns(
  teamCount: number,
  botsPerTeam: number,
  width: number,
  height: number,
  rng: () => number
): Spawn[][] {
  // Keep bots off the walls: a bot's center must stay one radius from the edge.
  // Read lazily (inside the function, not at module scope): bot.ts reaches this
  // module through environment.ts, so a module-scope read of BOT_RADIUS would
  // run mid-cycle while bot.ts is still initializing.
  const MARGIN = BOT_RADIUS;
  const teams: Spawn[][] = [];
  if (teamCount <= 0 || botsPerTeam <= 0) return teams;

  const cx = width / 2;
  const cy = height / 2;
  // Max distance from center a bot may occupy while staying off the walls.
  const usable = Math.min(width, height) / 2 - MARGIN;

  // Radius a team's bots scatter within, and how far each team's center sits from
  // the arena center. Sized (as the old formation was) so clusters stay inside the
  // arena and never overlap, keeping symmetry exact.
  const clusterR = Math.min(teamCount > 1 ? 75 : 95, usable * 0.35);
  const teamR = teamCount <= 1 ? 0 : Math.min(usable - clusterR, usable * 0.62);

  // Single global rotation of the whole formation — the first draw, advantaging
  // no team.
  const rotation = rng() * 360;

  // The symmetric center points, one per slot around the ring.
  const centers: { x: number; y: number }[] = [];
  for (let i = 0; i < teamCount; i++) {
    const a = rotation + (i * 360) / teamCount;
    centers.push({
      x: cx + teamR * Math.sin(rad(a)),
      y: cy - teamR * Math.cos(rad(a)),
    });
  }

  // Fisher–Yates shuffle of the slot indices, so team creation order doesn't map
  // to a fixed angular slot a bot could exploit.
  const order = centers.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (let i = 0; i < teamCount; i++) {
    const center = centers[order[i]];

    // Scatter the team's offsets inside the cluster disk, keeping teammates at
    // least MIN_SEP apart (rejection sampling; on exhaustion, keep the best-spaced
    // candidate so the loop always terminates).
    const offsets: { x: number; y: number }[] = [];
    for (let j = 0; j < botsPerTeam; j++) {
      let best = { x: 0, y: 0 };
      let bestSep = -1;
      for (let t = 0; t < MAX_TRIES; t++) {
        const ang = rng() * 360;
        const r = clusterR * Math.sqrt(rng()); // uniform over the disk
        const cand = { x: r * Math.sin(rad(ang)), y: -r * Math.cos(rad(ang)) };
        let sep = Infinity;
        for (const o of offsets) {
          sep = Math.min(sep, Math.hypot(cand.x - o.x, cand.y - o.y));
        }
        if (sep >= MIN_SEP) {
          best = cand;
          break;
        }
        if (sep > bestSep) {
          bestSep = sep;
          best = cand;
        }
      }
      offsets.push(best);
    }

    // Recenter the cluster onto its symmetric center (a rigid shift: preserves the
    // MIN_SEP spacing above, and makes the team centroid exactly the fair center).
    const mx = offsets.reduce((s, o) => s + o.x, 0) / offsets.length;
    const my = offsets.reduce((s, o) => s + o.y, 0) / offsets.length;

    const bots: Spawn[] = offsets.map((o) => {
      // Safety clamp (a no-op for the square arena, where the radii above keep
      // every bot in bounds); guards odd width/height in the common case.
      const x = Math.max(MARGIN, Math.min(width - MARGIN, center.x + o.x - mx));
      const y = Math.max(
        MARGIN,
        Math.min(height - MARGIN, center.y + o.y - my)
      );
      return { x, y, orientation: headingToward(x, y, cx, cy) };
    });
    teams.push(bots);
  }
  return teams;
}
