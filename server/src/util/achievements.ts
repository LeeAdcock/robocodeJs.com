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
  // Shots the user's bots fired and landed this match, for the accuracy badge.
  shotsFired: number;
  shotsHit: number;
  // Whether the match ran past SUDDEN_DEATH_TIME into health decay. Match-level,
  // so both sides of a match see the same value.
  suddenDeath: boolean;
}

// Sharpshooter's bar: land at least this share of your shots, over at least this
// many. The minimum matters more than it looks — a match settled by one lucky
// point-blank shot is 100% accuracy, so without a floor the badge would mean
// nothing at all.
const SHARPSHOOTER_ACCURACY = 0.5;
const SHARPSHOOTER_MIN_SHOTS = 10;

// A snapshot of what a user has DONE with their account, as opposed to what their
// bots did in a match. Cheap to gather (one app query plus the account row), so
// the profile page can recompute it on every load — see evaluateAccountAchievements.
export interface AccountState {
  // Apps the user has actually authored: non-deleted, non-empty source, and not an
  // untouched starter bot. Starters are excluded for the same reason the ladder
  // benches them — being given a bot isn't the same as writing one.
  authoredApps: number;
  // Whole days since the account was created.
  accountAgeDays: number;
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
  // A badge is earned in exactly one of these ways — or in none of them, which
  // means it is EDGE-TRIGGERED and awarded by id at the moment it happens (see
  // the account block below; those events leave no state to re-derive later).
  //   counter + threshold — unlocks when the user's lifetime counter reaches it.
  //     Evaluated on EVERY counter bump regardless of which scope fed it.
  //   test — a predicate over a single rated ladder match. Ladder scope only; see
  //     the note on SANDBOX below for why.
  //   accountTest — a predicate over an AccountState snapshot. Re-evaluated on
  //     every profile load, so it is self-healing: a badge whose hook was missed
  //     (or that has no event at all, like an anniversary) still lands.
  //   rankThreshold — unlocks when one of the user's apps REACHES this board rank
  //     or better. Ladder scope only, and not a `test` because a rank isn't a fact
  //     about the match — it's a query against the whole board (AppService.getRanks).
  counter?: CounterKey;
  threshold?: number;
  test?: (facts: LadderFacts) => boolean;
  accountTest?: (state: AccountState) => boolean;
  rankThreshold?: number;
}

// Ranked games an app must have before its rank can earn a badge. Elo applies a
// placement K-boost (util/elo.ts), so a brand-new app's rating swings hard on a
// couple of lucky results — without this gate a transient spike could mint a
// permanent badge. 20 is where the rating starts to reflect the bot rather than
// the draw (CLAUDE.md: effectiveness drifts the score over ~20-40 games).
export const MIN_RANKED_GAMES_FOR_RANK = 20;

// Rating gap that makes a win a genuine upset rather than a coin flip.
const UPSET_MARGIN = 150;

// Ids awarded at the moment of an event rather than derived from state. Exported
// so the award sites name them from the catalog instead of hardcoding a string.
export const ACCOUNT_REPAIR = 'account-repair';
export const ACCOUNT_MCP_TOKEN = 'account-mcp-token';
export const ACCOUNT_SHARED = 'account-shared';
export const ACCOUNT_BORROWED = 'account-borrowed';
export const ACCOUNT_CHECK = 'account-check';

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
  // Land half your shots — over enough of them to mean it. Deliberately the
  // opposite incentive to Trigger Happy: that one rewards volume, this one rewards
  // aim, and a bot optimised for either is a different bot.
  {
    id: 'ladder-sharpshooter',
    scope: 'ladder',
    name: 'Sharpshooter',
    description: `Win a ranked match landing at least half of ${SHARPSHOOTER_MIN_SHOTS}+ shots.`,
    icon: '🏹',
    test: (f) =>
      f.won &&
      f.shotsFired >= SHARPSHOOTER_MIN_SHOTS &&
      f.shotsHit / f.shotsFired >= SHARPSHOOTER_ACCURACY,
  },
  // The grindy matches earn nothing today. This one celebrates them.
  {
    id: 'ladder-sudden-death',
    scope: 'ladder',
    name: 'Sudden Death Survivor',
    description: 'Win a ranked match that ran into sudden death.',
    icon: '⏱️',
    test: (f) => f.won && f.suddenDeath,
  },
  // The emotional opposite of Untouchable: won with the squad all but wiped out.
  // Exactly one left — winning with zero alive is possible (the last bot
  // eliminated takes it), but that's a different, sadder story.
  {
    id: 'ladder-pyrrhic',
    scope: 'ladder',
    name: 'Pyrrhic Victory',
    description: 'Win a ranked match with a single bot left standing.',
    icon: '🩸',
    test: (f) => f.won && f.botsAlive === 1,
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
  // Board-rank badges. "Reach" is deliberate: a rank is a moment, not a state, so
  // these unlock the first time an app touches the threshold and are kept forever
  // — exactly the ON CONFLICT DO NOTHING semantic. Falling back down the board
  // never revokes one.
  //
  // Rank comes from AppService.getRanks, which shares the leaderboard's own
  // candidate query and owner cap, so a badge means precisely what the rankings
  // page shows — no second definition of "top 10" to drift or confuse.
  {
    id: 'ladder-top-10',
    scope: 'ladder',
    name: 'Top Ten',
    description: 'Reach the top 10 of the global ladder.',
    icon: '🔟',
    rankThreshold: 10,
  },
  {
    id: 'ladder-top-3',
    scope: 'ladder',
    name: 'Podium',
    description: 'Reach the top 3 of the global ladder.',
    icon: '🥉',
    rankThreshold: 3,
  },
  {
    id: 'ladder-top-1',
    scope: 'ladder',
    name: 'King of the Hill',
    description: 'Reach number one on the global ladder.',
    icon: '🏆',
    rankThreshold: 1,
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

  // ── account: what you did, not what your bots did ───────────────────────────
  {
    id: 'account-first-bot',
    scope: 'account',
    name: 'Hello, World',
    description: 'Write your first bot.',
    icon: '🤖',
    accountTest: (s) => s.authoredApps >= 1,
  },
  {
    id: 'account-five-bots',
    scope: 'account',
    name: 'Bot Factory',
    description: 'Have five bots of your own on the go.',
    icon: '🏭',
    accountTest: (s) => s.authoredApps >= 5,
  },
  {
    id: 'account-veteran',
    scope: 'account',
    name: 'Anniversary',
    description: 'Be a member for a year.',
    icon: '🎂',
    // No event to hang this on — nothing happens when a year passes. It lands
    // because the profile page re-evaluates account badges on every load.
    accountTest: (s) => s.accountAgeDays >= 365,
  },
  // The two below are EDGE-TRIGGERED: the moment is unrecoverable afterwards, so
  // they carry no predicate and are awarded at their event instead.
  {
    id: ACCOUNT_REPAIR,
    scope: 'account',
    name: 'Field Repair',
    description:
      'Get a bot the ladder had benched for crashing back into the running.',
    icon: '🔧',
  },
  {
    id: ACCOUNT_MCP_TOKEN,
    scope: 'account',
    name: 'Plugged In',
    description: 'Connect an AI assistant to your account.',
    icon: '🔌',
  },
  // The two halves of the share link (/add-app/:appId) — the one social moment in
  // the app, and the only badges earned by two people at once.
  //
  // Edge-triggered like the pair above, though for a subtler reason: the
  // membership row they're derived from is deletable. A bot that was picked up and
  // later dropped was still picked up, and re-deriving from arena_member would
  // silently revoke that. The moment is the truth; the row is only its residue.
  {
    id: ACCOUNT_SHARED,
    scope: 'account',
    name: 'Crowd Pleaser',
    description: 'Someone else added one of your bots to their arena.',
    icon: '👏',
  },
  {
    id: ACCOUNT_BORROWED,
    scope: 'account',
    name: 'Sparring Partner',
    description: "Add someone else's bot to your arena.",
    icon: '🤝',
  },
  // A feature-discovery badge, like Plugged In: it rewards using a tool rather
  // than achieving something. That earns its place when the tool is genuinely
  // useful and genuinely easy to miss — the badge list is where a user finds out
  // the checker exists. Hold that line, or this scope becomes "click every button".
  {
    id: ACCOUNT_CHECK,
    scope: 'account',
    name: 'Sanity Check',
    description: 'Check a bot for errors before running it.',
    icon: '🔍',
  },
];

// Every account badge whose predicate the given state satisfies. Edge-triggered
// entries carry no predicate, so they are naturally skipped here — they can only
// be awarded at their event.
export const accountAchievements = (state: AccountState): Achievement[] =>
  ACHIEVEMENTS.filter(
    (a) => a.accountTest !== undefined && a.accountTest(state)
  );

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

// Every rank badge that a board rank of `rank` earns. Lower is better, so this is
// a <= test — reaching #1 also earns Podium and Top Ten, which is intended: a user
// who joins the ladder already dominant shouldn't be missing the rungs below.
//
// The caller is responsible for the MIN_RANKED_GAMES_FOR_RANK gate; this stays a
// pure function of the rank so it's trivially testable at its boundary.
export const rankAchievements = (rank: number): Achievement[] =>
  ACHIEVEMENTS.filter(
    (a) => a.rankThreshold !== undefined && rank <= a.rankThreshold
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
