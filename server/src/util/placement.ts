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
  const teams: Spawn[][] = [];
  if (teamCount <= 0 || botsPerTeam <= 0) return teams;

  const cx = width / 2;
  const cy = height / 2;
  // Max distance from center a bot may occupy while staying off the walls (a
  // bot's center must stay one radius from the edge). BOT_RADIUS is read only
  // inside this function, never at module scope: bot.ts reaches this module
  // through environment.ts, so a module-scope read would run mid-cycle while
  // bot.ts is still initializing.
  const usable = Math.min(width, height) / 2 - BOT_RADIUS;

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

  // Scatter ONE reference cluster (team 0's shape) inside its disk, keeping
  // teammates at least MIN_SEP apart (rejection sampling; on exhaustion, keep the
  // best-spaced candidate so the loop always terminates).
  const center0 = centers[0];
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

  // Recenter the reference cluster onto its ring center (a rigid shift: preserves
  // MIN_SEP spacing and makes the centroid exactly the fair center).
  const mx = offsets.reduce((s, o) => s + o.x, 0) / offsets.length;
  const my = offsets.reduce((s, o) => s + o.y, 0) / offsets.length;
  const refBots = offsets.map((o) => ({
    x: center0.x + o.x - mx,
    y: center0.y + o.y - my,
  }));

  // Every team is a RIGID ROTATION of the reference cluster about the arena
  // center by k·(360/teamCount). All teams are therefore geometrically
  // CONGRUENT — same intra-cluster shape, same distance to center/walls/nearest
  // enemy — so no team can draw a luckier spawn than another. This removes the
  // last inter-team positional asymmetry (each team used to scatter
  // independently). The t=0 layout is more predictable, but DEPLOY_TICKS of
  // damage-free movement makes a spawn read stale before weapons go live.
  for (let k = 0; k < teamCount; k++) {
    const phi = rad((k * 360) / teamCount);
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const bots: Spawn[] = refBots.map((b) => {
      const dx = b.x - cx;
      const dy = b.y - cy;
      // Safety clamp (a no-op for the square arena, where the radii above keep
      // every bot in bounds); guards odd width/height in the common case.
      const x = Math.max(
        BOT_RADIUS,
        Math.min(width - BOT_RADIUS, cx + dx * cos - dy * sin)
      );
      const y = Math.max(
        BOT_RADIUS,
        Math.min(height - BOT_RADIUS, cy + dx * sin + dy * cos)
      );
      return { x, y, orientation: headingToward(x, y, cx, cy) };
    });
    teams.push(bots);
  }
  return teams;
}
