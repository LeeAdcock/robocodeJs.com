// Shared angle helpers for the client-side arena interpolation. Mirrors the
// server's server/src/util/geometry.ts — keep them in sync.

// Normalizes an angle (in degrees) into the [0, 360) range.
export const normalizeAngle = (x: number): number => {
  x = x % 360;
  while (x < 0) x += 360;
  return x;
};

// The smallest signed rotation (in degrees, within (-180, 180]) to get from one
// angle to another — i.e. the "short way" around. Used so a rotation crossing
// the 0/360 seam animates a couple of degrees instead of spinning ~358° back.
export const shortestAngleDelta = (from: number, to: number): number => {
  return ((((to - from) % 360) + 540) % 360) - 180;
};
