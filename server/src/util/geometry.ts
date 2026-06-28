// Shared angle helpers. Angles are in degrees.

// Normalizes an angle into the [0, 360) range. Does not round — callers that
// need integer degrees (e.g. the bot-facing getOrientation()) floor explicitly.
export const normalizeAngle = (x: number): number => {
  x = x % 360;
  while (x < 0) x += 360;
  return x;
};

// The internal engine uses a south-zero compass (0° = +y/down) — an artifact of
// screen coordinates. The bot-facing API uses a north-zero compass (0° = up) to
// match a real compass and classic Robocode. The two differ by exactly 180°, so
// we translate absolute *headings* at the API boundary. (Bearings reported to
// bots are relative to the body and need no compass translation.)
export const toApiHeading = (internal: number): number =>
  normalizeAngle(internal + 180);
export const toInternalHeading = (api: number): number =>
  normalizeAngle(api - 180);

// A body-relative bearing toward an absolute (internal) target angle: the offset
// from the body's heading, convention-independent. Used for scan/HIT/COLLIDED
// bearings so `bot.turret.setOrientation(angle)` / `bot.turn(angle)` aim directly.
export const toRelativeBearing = (
  internalTargetAngle: number,
  internalBodyOrientation: number
): number => normalizeAngle(internalTargetAngle - internalBodyOrientation);
