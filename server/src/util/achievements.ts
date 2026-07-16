// The achievement catalog (GitHub #121): the single declarative table of every
// badge a user can earn, plus the pure predicates that decide when one is earned.
//
// Adding a badge is a data change — one entry below — not a code change: the
// evaluator walks this list, and the profile API ships it to the UI, so neither
// side holds any per-badge knowledge. Deliberately free of DB and Environment
// imports so it stays trivially unit-testable and safe to import anywhere.

// Where a badge can be earned. The scope is a promise to the user about how much
// it is worth:
//   ladder  — prestige. Only ever awarded from a RATED global-ladder match
//             (LadderService): a real opponent, a real Elo stake, a server-run
//             match. These cannot be farmed.
//   sandbox — cumulative combat feats, fed by BOTH ladder and the user's own
//             arenas. Grindable by design, so cosmetic/onboarding only.
//   account — user behavior rather than bot behavior (bots written, API token
//             created, time as a member).
export type AchievementScope = 'ladder' | 'sandbox' | 'account';

// The lifetime per-user totals in `user_counter`. The combat keys deliberately
// mirror BotStats field names 1:1, so the sandbox flush can select them with a
// filter instead of a translation table. The two ladder-only keys have no BotStats
// equivalent — they count matches, not in-match events.
//
// `ladderMatchesPlayed` and `ladderWins` are what make a COUNTER-based ladder badge
// (Contender, Champion) un-farmable: they are not BotStats fields, so the sandbox
// flush cannot reach them, and awardAchievements only writes them from a RATED
// ladder match. The un-farmability lives in who may WRITE the counter — not in who
// may evaluate the badge.
export type CounterKey =
  | 'shotsFired'
  | 'shotsHit'
  | 'kills'
  | 'damageDealt'
  | 'distanceTraveled'
  | 'messagesSent'
  | 'ladderMatchesPlayed'
  | 'ladderWins';

// One user's outcome in one rated ladder match, aggregated across whatever apps
// they fielded in it. Everything here is already computed by buildMatchSummary and
// in hand at the LadderService hook, so no ladder badge costs a query.
export interface LadderFacts {
  won: boolean;
  myRatingBefore: number;
  opponentRatingBefore: number;
  // Bullet hits taken across the user's bots (friendly fire included — being shot
  // by your own teammate still means you were shot).
  timesHit: number;
  botsAlive: number;
  botsTotal: number;
}

export interface Achievement {
  // Stable slug. PERSISTED in the achievement table — never rename one; retire it
  // and add a new id instead, or you silently revoke everyone's badge.
  id: string;
  scope: AchievementScope;
  name: string;
  description: string;
  // Emoji, rendered as the badge icon.
  icon: string;
  // A badge is earned in exactly one of two ways:
  //   counter + threshold — unlocks when the user's lifetime counter reaches it.
  //     Evaluated on EVERY counter bump regardless of which scope fed it.
  //   test — a predicate over a single rated ladder match. Ladder scope only; see
  //     the note on SANDBOX below for why.
  counter?: CounterKey;
  threshold?: number;
  test?: (facts: LadderFacts) => boolean;
}

// Rating gap that makes a win a genuine upset rather than a coin flip.
const UPSET_MARGIN = 150;

export const ACHIEVEMENTS: Achievement[] = [
  // ── ladder: prestige, un-farmable ───────────────────────────────────────────
  {
    id: 'ladder-first-win',
    scope: 'ladder',
    name: 'First Blood',
    description: 'Win a ranked ladder match.',
    icon: '🥇',
    test: (f) => f.won,
  },
  {
    id: 'ladder-flawless',
    scope: 'ladder',
    name: 'Flawless Victory',
    description:
      'Win a ranked match without a single one of your bots being hit.',
    icon: '✨',
    test: (f) => f.won && f.timesHit === 0,
  },
  {
    id: 'ladder-untouchable',
    scope: 'ladder',
    name: 'Untouchable',
    description: 'Win a ranked match with your whole squad still standing.',
    icon: '🛡️',
    test: (f) => f.won && f.botsAlive === f.botsTotal,
  },
  {
    id: 'ladder-giant-slayer',
    scope: 'ladder',
    name: 'Giant Slayer',
    description: `Beat a ranked opponent rated ${UPSET_MARGIN}+ points above you.`,
    icon: '🐉',
    test: (f) =>
      f.won && f.opponentRatingBefore - f.myRatingBefore >= UPSET_MARGIN,
  },
  {
    id: 'ladder-wins-10',
    scope: 'ladder',
    name: 'Contender',
    description: 'Win 10 ranked matches.',
    icon: '🏅',
    counter: 'ladderWins',
    threshold: 10,
  },
  {
    id: 'ladder-wins-50',
    scope: 'ladder',
    name: 'Champion',
    description: 'Win 50 ranked matches.',
    icon: '👑',
    counter: 'ladderWins',
    threshold: 50,
  },
  {
    id: 'ladder-rated-100',
    scope: 'ladder',
    name: 'Veteran of the Ladder',
    description: 'Play 100 ranked matches.',
    icon: '🎖️',
    counter: 'ladderMatchesPlayed',
    threshold: 100,
  },

  // ── sandbox: cumulative, grindable, cosmetic ────────────────────────────────
  // All counter-based, and deliberately so: these are fed by an arena-level flush
  // that carries only summed deltas, and a sandbox arena has no winner concept at
  // all (its game-over fires when EVERY app is dead, not when one survives), so a
  // per-match `test` is not expressible here. Enforced by achievements.test.ts.
  {
    id: 'first-kill',
    scope: 'sandbox',
    name: 'First Kill',
    description: 'Destroy an enemy bot.',
    icon: '💥',
    counter: 'kills',
    threshold: 1,
  },
  {
    id: 'kills-100',
    scope: 'sandbox',
    name: 'Centurion',
    description: 'Destroy 100 enemy bots.',
    icon: '☠️',
    counter: 'kills',
    threshold: 100,
  },
  {
    id: 'shots-1000',
    scope: 'sandbox',
    name: 'Trigger Happy',
    description: 'Fire 1,000 shots.',
    icon: '🔫',
    counter: 'shotsFired',
    threshold: 1000,
  },
  {
    id: 'shots-10000',
    scope: 'sandbox',
    name: 'Ammo Dump',
    description: 'Fire 10,000 shots.',
    icon: '🧨',
    counter: 'shotsFired',
    threshold: 10000,
  },
  {
    id: 'hits-1000',
    scope: 'sandbox',
    name: 'Marksman',
    description: 'Land 1,000 shots.',
    icon: '🎯',
    counter: 'shotsHit',
    threshold: 1000,
  },
  {
    id: 'damage-10000',
    scope: 'sandbox',
    name: 'Heavy Hitter',
    description: 'Deal 10,000 damage.',
    icon: '💢',
    counter: 'damageDealt',
    threshold: 10000,
  },
  {
    id: 'distance-100000',
    scope: 'sandbox',
    name: 'Road Warrior',
    description: 'Drive 100,000 units.',
    icon: '🛞',
    counter: 'distanceTraveled',
    threshold: 100000,
  },
  {
    id: 'messages-1000',
    scope: 'sandbox',
    name: 'Chatterbox',
    description: 'Send 1,000 messages between your bots.',
    icon: '📡',
    counter: 'messagesSent',
    threshold: 1000,
  },
];

// Every badge whose lifetime counter has reached its threshold. Counter badges are
// cross-scope by design (both the ladder and a user's own arenas feed the same
// counters), so this is evaluated on every bump no matter which path produced it.
export const counterAchievements = (
  counters: Partial<Record<CounterKey, number>>
): Achievement[] =>
  ACHIEVEMENTS.filter(
    (a) =>
      a.counter !== undefined &&
      (counters[a.counter] ?? 0) >= (a.threshold ?? Infinity)
  );

// Every `test` badge in `scope` that this match satisfies. Scope-pinned: a ladder
// predicate must never be evaluated against anything but a rated ladder match, or
// the badge stops meaning what it says.
export const testAchievements = (
  scope: AchievementScope,
  facts: LadderFacts
): Achievement[] =>
  ACHIEVEMENTS.filter(
    (a) => a.scope === scope && a.test !== undefined && a.test(facts)
  );
