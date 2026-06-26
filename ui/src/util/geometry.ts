// Shared angle helpers for the client-side arena interpolation. Mirrors the
// server's server/src/util/geometry.ts — keep them in sync.

// Normalizes an angle (in degrees) into the [0, 360) range.
export const normalizeAngle = (x: number): number => {
  x = x % 360;
  while (x < 0) x += 360;
  return x;
};
