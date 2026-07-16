import achievementService, {
  AchievementUnlock,
} from '../services/AchievementService';
import {
  AchievementScope,
  CounterKey,
  LadderFacts,
  counterAchievements,
  testAchievements,
  accountAchievements,
} from './achievements';
import appService from '../services/AppService';
import { isUntouchedStarter } from './starterBots';
import { BotStats } from '../types/botStats';
import { UserId } from '../types/user';
import { AppId } from '../types/app';
import { logger, LogEvent } from './logger';

// Composes the catalog (achievements.ts) with persistence (AchievementService):
// bump the user's lifetime counters, work out what that unlocked, and store it.
// AchievementService stays DB-only, mirroring RankedMatchService; the policy lives
// here.

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// The BotStats counters that feed a lifetime total. Deliberately a subset — there
// is no badge for being shot, and `damageTaken`/`timesHit` as a lifetime "score"
// would reward losing. Every name here exists on both BotStats and CounterKey, so
// the sandbox flush filters rather than translates.
const COMBAT_COUNTERS = [
  'shotsFired',
  'shotsHit',
  'kills',
  'damageDealt',
  'distanceTraveled',
  'messagesSent',
] as const satisfies readonly (keyof BotStats & CounterKey)[];

// Keep only the BotStats keys that map to a lifetime counter.
export const toCounterDeltas = (
  stats: Partial<Record<keyof BotStats, number>>
): Partial<Record<CounterKey, number>> => {
  const deltas: Partial<Record<CounterKey, number>> = {};
  for (const key of COMBAT_COUNTERS) {
    const value = stats[key];
    if (typeof value === 'number' && value > 0) deltas[key] = value;
  }
  return deltas;
};

// Add the deltas, then unlock everything the new totals qualify for plus (when a
// scope with per-match predicates supplies facts) whatever this match earned.
//
// We pass the FULL eligible list every time and let ON CONFLICT DO NOTHING absorb
// the badges already held, rather than diffing against stored state. That's ~15
// no-op rows in one statement per match — nothing next to a real isolate match —
// and it removes an entire class of cache-staleness bug.
//
// Ordering is bump -> evaluate against the returned totals -> unlock. The totals
// come back from the same statement that wrote them, so a threshold is never tested
// against a stale read. A crash between the two loses at most an unlock (the next
// match re-unlocks it) and never a counter — the right direction to fail.
const award = async (
  userId: UserId,
  deltas: Partial<Record<CounterKey, number>>,
  match?: { scope: AchievementScope; facts: LadderFacts; appId?: AppId | null }
): Promise<string[]> => {
  const totals = await achievementService.bump(userId, deltas);

  const unlocks: AchievementUnlock[] = counterAchievements(totals).map((a) => ({
    id: a.id,
    // Counter badges accrue across every app the user owns, so no single app
    // earned them: appId stays null. See AchievementService's table comment.
    appId: null,
  }));

  if (match) {
    for (const a of testAchievements(match.scope, match.facts)) {
      unlocks.push({ id: a.id, appId: match.appId ?? null });
    }
  }

  return achievementService.unlock(userId, unlocks);
};

// Sandbox path: a user's own arena flushed some bot stats. Counter badges only —
// the flush carries summed deltas with no per-app match view, and a sandbox arena
// has no winner concept to predicate on anyway.
//
// Never throws: a badge failure must not take down an arena's lifecycle (this is
// called from restart/dispose/game-over).
export const recordSandboxStats = async (
  userId: UserId,
  stats: Partial<Record<keyof BotStats, number>>
): Promise<void> => {
  const deltas = toCounterDeltas(stats);
  if (Object.keys(deltas).length === 0) return;
  try {
    const unlocked = await award(userId, deltas);
    if (unlocked.length) {
      logger.info(
        {
          event: LogEvent.ACHIEVEMENT_UNLOCKED,
          userId,
          unlocked,
          scope: 'sandbox',
        },
        'achievements unlocked'
      );
    }
  } catch (err) {
    logger.warn({ err, userId }, 'sandbox achievement flush failed');
  }
};

// One user's result in one ladder match, as seen by LadderService.
export interface LadderResult {
  userId: UserId;
  // Summed across whatever apps this user fielded in the match, so a same-owner
  // matchup is recorded once with both sides combined.
  stats: Partial<Record<keyof BotStats, number>>;
  facts: LadderFacts;
  // The app that won it — recorded as the earner on ladder badges. Null when the
  // user didn't win, since nothing is awarded then anyway.
  winningAppId?: AppId | null;
  // Whether the match counted for rating (LadderService's `rate`: decided, and not
  // a double crash). An unrated match still fires shots, so its combat counters are
  // real, but it is NOT a ranked result: no ladderMatchesPlayed/ladderWins and no
  // ladder badge.
  rated: boolean;
}

// Ladder path. Never throws: a badge failure must never fail or slow a ranked
// match.
export const recordLadderResult = async (
  result: LadderResult
): Promise<void> => {
  const deltas = toCounterDeltas(result.stats);
  if (result.rated) {
    deltas.ladderMatchesPlayed = 1;
    if (result.facts.won) deltas.ladderWins = 1;
  }
  if (Object.keys(deltas).length === 0 && !result.rated) return;

  try {
    const unlocked = await award(
      result.userId,
      deltas,
      // Only a rated match may award a ladder badge — that gate is the entire
      // reason ladder badges are worth anything.
      result.rated
        ? {
            scope: 'ladder',
            facts: result.facts,
            appId: result.facts.won ? (result.winningAppId ?? null) : null,
          }
        : undefined
    );
    if (unlocked.length) {
      logger.info(
        {
          event: LogEvent.ACHIEVEMENT_UNLOCKED,
          userId: result.userId,
          unlocked,
          scope: 'ladder',
        },
        'achievements unlocked'
      );
    }
  } catch (err) {
    logger.warn(
      { err, userId: result.userId },
      'ladder achievement award failed'
    );
  }
};

// Award the account-scope badges (GitHub #121) that the user's current state
// earns: bots written, time as a member. Costs one app query plus the account row
// the caller already has, so it is cheap enough to run on every profile load —
// which is what makes it SELF-HEALING. That matters more than it sounds:
// account-veteran has no event at all (nothing happens when a year passes), and a
// missed hook elsewhere heals on the user's next visit rather than losing a badge
// forever.
//
// Edge-triggered account badges (the source-repair and MCP-token moments) leave no
// state to re-derive, so they carry no predicate and are awarded at their event by
// awardEdgeAchievement instead.
//
// Never throws: this runs inside a page load and a save path.
export const evaluateAccountAchievements = async (
  userId: UserId,
  createdTimestamp?: Date
): Promise<string[]> => {
  try {
    const apps = await appService.getForUser(userId);
    // "Authored" excludes an untouched starter for the same reason the ladder
    // benches them: being handed a bot isn't writing one.
    const authoredApps = apps.filter((app) => {
      const source = app.getSource();
      return source.trim().length > 0 && !isUntouchedStarter(source);
    }).length;

    const accountAgeDays = createdTimestamp
      ? Math.floor((Date.now() - createdTimestamp.getTime()) / MS_PER_DAY)
      : 0;

    const earned = accountAchievements({ authoredApps, accountAgeDays });
    if (earned.length === 0) return [];

    // appId stays null: an account badge is about the user, not any one bot.
    const unlocked = await achievementService.unlock(
      userId,
      earned.map((a) => ({ id: a.id, appId: null }))
    );
    if (unlocked.length) {
      logger.info(
        {
          event: LogEvent.ACHIEVEMENT_UNLOCKED,
          userId,
          unlocked,
          scope: 'account',
        },
        'achievements unlocked'
      );
    }
    return unlocked;
  } catch (err) {
    logger.warn({ err, userId }, 'account achievement evaluation failed');
    return [];
  }
};

// Award a single edge-triggered badge at the moment it happens. Idempotent via
// ON CONFLICT DO NOTHING, so a caller never has to check whether it's already held.
// Never throws: none of these moments is worth failing its request over.
export const awardEdgeAchievement = async (
  userId: UserId,
  id: string
): Promise<void> => {
  try {
    const unlocked = await achievementService.unlock(userId, [
      { id, appId: null },
    ]);
    if (unlocked.length) {
      logger.info(
        {
          event: LogEvent.ACHIEVEMENT_UNLOCKED,
          userId,
          unlocked,
          scope: 'account',
        },
        'achievements unlocked'
      );
    }
  } catch (err) {
    logger.warn({ err, userId, id }, 'edge achievement award failed');
  }
};
