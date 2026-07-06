// Fair, low-variance match starts.
//
// The original placement (Bot constructor) dropped every bot at a uniform-random
// point over the whole arena, so one team could spawn clumped in a corner while
// another got the open center — and that positional luck, not skill, decided most
// matches. computeSpawns replaces it with a ROTATIONALLY SYMMETRIC layout: every
// team sits at the same radius from center, the same distance from the walls, and
// the same distance from the nearest enemy team, so the start is fair by
// construction. The seed only picks a single global rotation, so matches still
// vary — but fairly — and a fixed seed still reproduces the layout exactly.
//
// Pure and dependency-free (takes width/height and a [0,1) rng) so it is trivially
// unit-testable and reproducible.

export interface Spawn {
  x: number;
  y: number;
  orientation: number; // absolute compass heading, 0 = north, clockwise
}

// Keep bots off the walls, matching the 16u inset the old placement used.
const MARGIN = 16;

const normalizeDeg = (deg: number): number => ((deg % 360) + 360) % 360;
const rad = (deg: number): number => (deg * Math.PI) / 180;

// Absolute heading that points from (x,y) toward (tx,ty) in the game's compass
// frame (0 = north/-y, 90 = east/+x): forward is (sin H, -cos H).
const headingToward = (x: number, y: number, tx: number, ty: number): number =>
  normalizeDeg((Math.atan2(tx - x, y - ty) * 180) / Math.PI);

// Returns spawns[team][slot]. Teams are evenly spaced on a circle around the arena
// center; each team's bots sit on a small ring around the team's point (so a team
// is spread out, never clumped), and every bot faces the center for immediate,
// symmetric engagement geometry.
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
  // Max distance from center a bot may occupy while staying off the walls.
  const usable = Math.min(width, height) / 2 - MARGIN;

  // A team's bots spread on a ring of this radius around the team point; kept
  // small enough that the whole formation stays inside `usable`.
  const formR = Math.min(teamCount > 1 ? 70 : 90, usable * 0.35);
  // Distance of each team point from center. 0 for a lone team (centered); for
  // ≥2 teams, pushed out toward the walls but leaving room for the formation, so
  // no bot is ever clamped and symmetry is exact.
  const teamR = teamCount <= 1 ? 0 : Math.min(usable - formR, usable * 0.62);

  // Single global rotation — the only randomness, and it advantages no team.
  const rotation = rng() * 360;

  for (let i = 0; i < teamCount; i++) {
    const teamAngle = rotation + (i * 360) / teamCount;
    const bx = cx + teamR * Math.sin(rad(teamAngle));
    const by = cy - teamR * Math.cos(rad(teamAngle));

    const bots: Spawn[] = [];
    for (let j = 0; j < botsPerTeam; j++) {
      // Offset by half a step so a team's bots don't all line up on the same
      // spoke as the team direction.
      const slotAngle = teamAngle + (j * 360) / botsPerTeam + 180 / botsPerTeam;
      const x = bx + formR * Math.sin(rad(slotAngle));
      const y = by - formR * Math.cos(rad(slotAngle));
      // Safety clamp (a no-op for the square arena, where the radii above keep
      // every bot in bounds); guards odd width/height without breaking symmetry
      // in the common case.
      const cxp = Math.max(MARGIN, Math.min(width - MARGIN, x));
      const cyp = Math.max(MARGIN, Math.min(height - MARGIN, y));
      bots.push({
        x: cxp,
        y: cyp,
        orientation: headingToward(cxp, cyp, cx, cy),
      });
    }
    teams.push(bots);
  }
  return teams;
}
