import { describe, it, expect, vi } from 'vitest';
import { computeSpawns } from '../src/util/placement';
import { mulberry32 } from '../src/util/random';

// placement now imports BOT_RADIUS from types/bot, whose module graph reaches
// AppService's CREATE TABLE query at import; stub the pool so these pure
// geometry tests never reach for a real Postgres.
vi.mock('../src/util/db', () => ({
  default: { query: () => Promise.resolve({ rows: [], rowCount: 0 }) },
}));

const W = 750;
const H = 750;
const CX = W / 2;
const CY = H / 2;

const dist = (
  a: { x: number; y: number },
  b: { x: number; y: number }
): number => Math.hypot(a.x - b.x, a.y - b.y);

const centroid = (bots: { x: number; y: number }[]) => ({
  x: bots.reduce((s, t) => s + t.x, 0) / bots.length,
  y: bots.reduce((s, t) => s + t.y, 0) / bots.length,
});

// Min distance from any of team i's bots to any bot of a different team.
const nearestEnemy = (
  teams: { x: number; y: number }[][],
  i: number
): number => {
  let min = Infinity;
  teams[i].forEach((t) => {
    teams.forEach((other, j) => {
      if (j === i) return;
      other.forEach((e) => (min = Math.min(min, dist(t, e))));
    });
  });
  return min;
};

// Min distance from team i's centroid to any other team's centroid.
const nearestEnemyCentroid = (
  centroids: { x: number; y: number }[],
  i: number
): number => {
  let min = Infinity;
  centroids.forEach((c, j) => {
    if (j !== i) min = Math.min(min, dist(centroids[i], c));
  });
  return min;
};

describe('computeSpawns', () => {
  for (const teamCount of [2, 3, 4, 5]) {
    it(`lays ${teamCount} teams out in fair, scattered clusters`, () => {
      const spawns = computeSpawns(teamCount, 5, W, H, mulberry32(42));

      expect(spawns).toHaveLength(teamCount);
      spawns.forEach((team) => expect(team).toHaveLength(5));

      // In-bounds (16u inset) and valid orientations.
      spawns.flat().forEach((s) => {
        expect(s.x).toBeGreaterThanOrEqual(16);
        expect(s.x).toBeLessThanOrEqual(W - 16);
        expect(s.y).toBeGreaterThanOrEqual(16);
        expect(s.y).toBeLessThanOrEqual(H - 16);
        expect(s.orientation).toBeGreaterThanOrEqual(0);
        expect(s.orientation).toBeLessThan(360);
      });

      // No clumping: a team's own bots stay at least MIN_SEP (40u) apart.
      spawns.forEach((team) => {
        for (let a = 0; a < team.length; a++) {
          for (let b = a + 1; b < team.length; b++) {
            expect(dist(team[a], team[b])).toBeGreaterThanOrEqual(40);
          }
        }
      });

      // Clustered: every bot is near its team's centroid, not spread arena-wide.
      const centroids = spawns.map((team) => centroid(team));
      spawns.forEach((team, i) => {
        team.forEach((s) => expect(dist(s, centroids[i])).toBeLessThan(150));
      });

      // Fair by construction: recentering puts every team's centroid on the
      // symmetric ring, so all teams are equidistant from the arena center and
      // have the same nearest-enemy-CENTROID distance (positions are randomized,
      // so this fairness now holds at the cluster level, not per bot).
      const centerDists = centroids.map((c) => dist(c, { x: CX, y: CY }));
      centerDists.forEach((d) => expect(d).toBeCloseTo(centerDists[0], 4));
      const nearestC = centroids.map((_, i) =>
        nearestEnemyCentroid(centroids, i)
      );
      nearestC.forEach((n) => expect(n).toBeCloseTo(nearestC[0], 4));
      // ...and no team's bots start inside point-blank range of another's.
      const nearest = spawns.map((_, i) => nearestEnemy(spawns, i));
      expect(Math.min(...nearest)).toBeGreaterThan(40);

      // Randomized, not a fixed ring: a team's bots are NOT all at the same radius
      // from their centroid (the old formation put them on an exact ring).
      spawns.forEach((team, i) => {
        const radii = team.map((s) => dist(s, centroids[i]));
        expect(Math.max(...radii) - Math.min(...radii)).toBeGreaterThan(5);
      });

      // Bots face inward (moving forward reduces distance to center).
      spawns.flat().forEach((s) => {
        const r = (s.orientation * Math.PI) / 180;
        const fx = Math.sin(r); // forward vector in the game's compass frame
        const fy = -Math.cos(r);
        const toCenter = { x: CX - s.x, y: CY - s.y };
        expect(fx * toCenter.x + fy * toCenter.y).toBeGreaterThan(0);
      });
    });
  }

  it('is deterministic for a fixed seed and varies with the seed', () => {
    const a = computeSpawns(4, 5, W, H, mulberry32(7));
    const b = computeSpawns(4, 5, W, H, mulberry32(7));
    const c = computeSpawns(4, 5, W, H, mulberry32(8));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
    // Different seeds produce different intra-cluster geometry, not just a
    // different global rotation of the same shape.
    const shapeA = a[0].map((s) => dist(s, centroid(a[0]))).sort();
    const shapeC = c[0].map((s) => dist(s, centroid(c[0]))).sort();
    expect(shapeA).not.toEqual(shapeC);
  });

  it('centers a lone team and handles empty input', () => {
    const one = computeSpawns(1, 5, W, H, mulberry32(1));
    expect(one).toHaveLength(1);
    // A single team's cluster is centered on the arena.
    expect(dist(centroid(one[0]), { x: CX, y: CY })).toBeCloseTo(0, 4);
    expect(computeSpawns(0, 5, W, H, mulberry32(1))).toEqual([]);
  });
});
