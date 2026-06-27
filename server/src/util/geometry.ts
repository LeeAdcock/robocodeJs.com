// Shared angle helpers. Angles are in degrees.

// Normalizes an angle into the [0, 360) range. Does not round — callers that
// need integer degrees (e.g. the bot-facing getOrientation()) floor explicitly.
export const normalizeAngle = (x: number): number => {
  x = x % 360;
  while (x < 0) x += 360;
  return x;
};
