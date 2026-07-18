export class BotStats {
  distanceTraveled = 0;
  scansCompleted = 0;
  scansDetected = 0;
  shotsFired = 0;
  shotsHit = 0;
  messagesSent = 0;
  messagesReceived = 0;
  // Collisions (with a bot or a wall) counted once per contact, on the tick it
  // begins — the same rising edge that fires the COLLIDED handler — not every
  // tick two bodies stay pressed together, so a sustained shove counts as one.
  timesCollided = 0;
  timesHit = 0;
  timesDetected = 0;
  // Enemy bots this bot landed the killing blow on — credited by
  // simulation.applyEliminations under the last-hit rule, and only when the
  // victim belongs to another app (no self-kills, no friendly fire).
  kills = 0;
  // Health actually removed from / lost by a bot, clamped to the victim's
  // remaining health rather than the nominal value: health is allowed to go
  // negative, and several bullets can land in one tick, so the nominal 25 would
  // count damage against an already-dead bot. damageDealt counts only enemy
  // bullets (the only attributable source); damageTaken counts every cause,
  // including collisions, self-inflicted misses and sudden-death decay.
  damageDealt = 0;
  damageTaken = 0;
}

// The numeric per-bot counters aggregated by the match summary and the
// achievement flush. Derived from a fresh BotStats, so both automatically pick up
// any field added above. Lives here rather than in matchSummary.ts because
// environment.ts needs it too, and matchSummary.ts already imports environment.ts
// (SUDDEN_DEATH_TIME) — importing back would cycle.
export const STAT_KEYS = Object.keys(new BotStats()) as (keyof BotStats)[];
