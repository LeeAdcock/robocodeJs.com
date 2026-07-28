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
  // The teammate-only subset of timesCollided: contacts that began against a bot
  // of the SAME app. A crowding/formation-quality signal that survives even when
  // the touch is too gentle to deal damage (below COLLISION_MIN_CLOSING_SPEED),
  // which the damage buckets below miss. Enemy collisions = timesCollided minus
  // this.
  timesCollidedTeammate = 0;
  timesHit = 0;
  timesDetected = 0;
  // Enemy bots this bot landed the killing blow on — credited by
  // simulation.applyEliminations under the last-hit rule, and only when the
  // victim belongs to another app (no self-kills, no friendly fire).
  kills = 0;
  // Health actually removed from / lost by a bot, clamped to the victim's
  // remaining health rather than the nominal value: health is allowed to go
  // negative, and several bullets can land in one tick, so the nominal 25 would
  // count damage against an already-dead bot.
  //
  // damageDealt counts every bullet this bot landed, INCLUDING friendly fire
  // (bullets do not discriminate by team — only kill *credit* excludes it, in
  // applyEliminations); damageDealtFriendly breaks out the friendly-fire subset.
  // damageTaken counts every cause; the damageTaken* buckets below decompose it
  // by source and always sum back to it (see simulation.ts `damage()` and the
  // sudden-death decay in environment.ts).
  damageDealt = 0;
  damageDealtFriendly = 0;
  damageTaken = 0;
  // --- damageTaken by source (these seven sum to damageTaken) ---------------
  // Enemy bullets: the clean combat channel — the opponent's aim vs your evasion.
  damageTakenEnemyFire = 0;
  // A teammate's bullets: self-inflicted, a team-coordination failure.
  damageTakenFriendlyFire = 0;
  // Ramming/being rammed by an enemy — mostly incidental positioning.
  damageTakenEnemyCollision = 0;
  // Piling into a teammate — crowding, and partly spawn-cluster luck.
  damageTakenTeammateCollision = 0;
  // Driving into an arena wall — a self-inflicted navigation error.
  damageTakenWall = 0;
  // Sudden-death health decay — the arena grinding everyone down equally (time).
  damageTakenSuddenDeath = 0;
  // The self-penalty for a shot that left the arena without hitting anyone.
  damageTakenSelfMiss = 0;
}

// The numeric per-bot counters aggregated by the match summary and the
// achievement flush. Derived from a fresh BotStats, so both automatically pick up
// any field added above. Lives here rather than in matchSummary.ts because
// environment.ts needs it too, and matchSummary.ts already imports environment.ts
// (SUDDEN_DEATH_TIME) — importing back would cycle.
export const STAT_KEYS = Object.keys(new BotStats()) as (keyof BotStats)[];
