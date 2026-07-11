// Standard Elo rating math for the global bot ladder (GitHub #151). Pure and
// side-effect free — no DB, no simulation — so it is trivially unit-testable and
// reused wherever a ranked result needs to move two apps' ratings.
//
// The rating unit is the *app* (each ranked match is app-vs-app). A rating lives
// on the app row and is never reset on a source edit, so improving or breaking a
// bot's logic makes its score drift over subsequent matches — the intended
// behavior. See util/ladder / LadderService for how results are produced.

// The rating a brand-new app starts at.
export const DEFAULT_RATING = 1500;

// A bot's first PLACEMENT_GAMES ranked matches use a larger K-factor so it
// converges toward its true strength quickly; afterwards K drops so an
// established rating is stable and moves only gradually.
export const PLACEMENT_GAMES = 10;
const PLACEMENT_K = 40;
const ESTABLISHED_K = 24;

// The minimal rating view Elo needs: current rating and how many ranked games
// the app has already played (drives the placement K-factor).
export interface Rated {
  rating: number;
  games: number;
}

// Which side won. Matches are decisive (sudden death forces a winner), so 'draw'
// is supported for completeness but is not expected in normal ladder play.
export type Outcome = 'a' | 'b' | 'draw';

// The K-factor (maximum rating swing per game) for an app that has played
// `games` ranked matches: boosted during placement, then fixed.
export const kFactor = (games: number): number =>
  games < PLACEMENT_GAMES ? PLACEMENT_K : ESTABLISHED_K;

// Probability that A beats B given their ratings — the logistic Elo expectation.
// A 400-point gap ⇒ the favorite is expected to win ~91% of the time.
export const expectedScore = (ratingA: number, ratingB: number): number =>
  1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));

// The new rating for one app given its expectation and actual score in [0,1].
const nextRating = (r: Rated, expected: number, score: number): number =>
  r.rating + kFactor(r.games) * (score - expected);

export interface EloResult {
  a: { rating: number; delta: number };
  b: { rating: number; delta: number };
}

// Apply one ranked result, returning both apps' new ratings and the signed
// deltas. Each side is updated against its own K-factor, so a placement bot can
// swing more than its established opponent from the same game. Ratings are
// rounded to whole points (what we persist and display); deltas are derived from
// the rounded values so `before + delta === after` always holds.
export const updateRatings = (
  a: Rated,
  b: Rated,
  outcome: Outcome
): EloResult => {
  const expectedA = expectedScore(a.rating, b.rating);
  const scoreA = outcome === 'a' ? 1 : outcome === 'b' ? 0 : 0.5;

  const newA = Math.round(nextRating(a, expectedA, scoreA));
  const newB = Math.round(nextRating(b, 1 - expectedA, 1 - scoreA));

  return {
    a: { rating: newA, delta: newA - a.rating },
    b: { rating: newB, delta: newB - b.rating },
  };
};
