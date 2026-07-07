import { describe, it, expect } from 'vitest';
import { computeSpawns } from '../src/util/placement';
import { mulberry32 } from '../src/util/random';

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

describe('computeSpawns', () => {
  for (const teamCount of [2, 3, 4, 5]) {
    it(`lays ${teamCount} teams out symmetrically and in-bounds`, () => {
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

      // No clumping: a team's own bots are spread apart.
      spawns.forEach((team) => {
        for (let a = 0; a < team.length; a++) {
          for (let b = a + 1; b < team.length; b++) {
            expect(dist(team[a], team[b])).toBeGreaterThanOrEqual(40);
          }
        }
      });

      // Fair by construction: every team is equidistant from center and has the
      // same nearest-enemy distance (rotational symmetry).
      const centerDists = spawns.map((team) =>
        dist(centroid(team), { x: CX, y: CY })
      );
      const nearest = spawns.map((_, i) => nearestEnemy(spawns, i));
      centerDists.forEach((d) => expect(d).toBeCloseTo(centerDists[0], 4));
      nearest.forEach((n) => expect(n).toBeCloseTo(nearest[0], 4));
      // ...and no team starts inside point-blank range of another.
      expect(Math.min(...nearest)).toBeGreaterThan(40);

      // Bots face inward (moving forward reduces distance to center).
      spawns.flat().forEach((s) => {
        const rad = (s.orientation * Math.PI) / 180;
        const fx = Math.sin(rad); // forward vector in the game's compass frame
        const fy = -Math.cos(rad);
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
  });

  it('centers a lone team and handles empty input', () => {
    const one = computeSpawns(1, 5, W, H, mulberry32(1));
    expect(one).toHaveLength(1);
    // A single team's formation is centered on the arena.
    expect(dist(centroid(one[0]), { x: CX, y: CY })).toBeCloseTo(0, 4);
    expect(computeSpawns(0, 5, W, H, mulberry32(1))).toEqual([]);
  });
});
