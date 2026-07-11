import pool from '../util/db';
import { UserId } from './user';
import nameFactory from '../util/nameFactory';
import { DEFAULT_RATING } from '../util/elo';

export type AppId = string & {};

// The subset of ladder fields hydrated from persistence (GitHub #151). Optional
// so callers that only loaded name/source (or a legacy row predating the ladder
// columns) get sensible defaults.
export interface AppRatingFields {
  rating?: number | null;
  ratingGames?: number | null;
  ratingWins?: number | null;
  broken?: boolean | null;
}

export default class App {
  private id: AppId;
  private name: string;
  private userId: UserId;
  private source = '';
  // Global-ladder rating state. New apps start at DEFAULT_RATING with no games
  // played; `broken` marks an app that failed to compile/crashed in a ranked
  // match so matchmaking skips it until it is edited again.
  private rating: number = DEFAULT_RATING;
  private ratingGames = 0;
  private ratingWins = 0;
  private broken = false;

  constructor(id: AppId, userId: UserId) {
    this.id = id;
    this.userId = userId;
    this.name = nameFactory();
  }

  getId = () => this.id;
  getUserId = () => this.userId;

  // Populate fields from persistence without writing them back to the database
  // (setName/setSource persist; this is for hydrating a loaded record).
  hydrate = (name: string, source: string, ratings?: AppRatingFields): App => {
    this.name = name;
    // Coerce a NULL/undefined source (legacy rows created before the column
    // defaulted to '') to an empty string so getSource always returns a string.
    this.source = source ?? '';
    // Legacy rows predating the ladder columns read back NULL — fall back to the
    // starting rating / zero games / not-broken.
    this.rating = ratings?.rating ?? DEFAULT_RATING;
    this.ratingGames = ratings?.ratingGames ?? 0;
    this.ratingWins = ratings?.ratingWins ?? 0;
    this.broken = ratings?.broken ?? false;
    return this;
  };

  getRating = () => this.rating;
  getRatingGames = () => this.ratingGames;
  getRatingWins = () => this.ratingWins;
  isBroken = () => this.broken;

  // Persist a ranked-match rating update: the new absolute rating, the
  // incremented game count, a win increment (when this app won), and a fresh
  // lastRankedAt stamp. Kept as one write so they move together. `ratingGames` is
  // the caller-supplied new total; wins increment by one only on a win so the
  // win-rate the leaderboard shows stays consistent with the game count.
  setRating = (
    rating: number,
    ratingGames: number,
    won: boolean
  ): Promise<undefined> => {
    this.rating = rating;
    this.ratingGames = ratingGames;
    if (won) this.ratingWins += 1;
    return pool
      .query({
        text: 'UPDATE app SET rating=$2, ratingGames=$3, ratingWins=ratingWins + $4, lastRankedAt=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), rating, ratingGames, won ? 1 : 0],
      })
      .then(() => undefined);
  };

  // Flag (or clear) an app as broken for ladder purposes — set when it fails to
  // compile or crashes in a ranked match, cleared when its source is edited.
  setBroken = (broken: boolean): Promise<undefined> => {
    this.broken = broken;
    return pool
      .query({
        text: 'UPDATE app SET broken=$2 WHERE id=$1',
        values: [this.getId(), broken],
      })
      .then(() => undefined);
  };

  getSource = () => this.source || '';
  setSource = (source: string): Promise<undefined> => {
    this.source = source;
    // Editing the source clears the ladder `broken` flag so an app that had
    // failed to compile/crashed gets another shot at matchmaking, and bumps
    // updatedTimestamp (which ladder eligibility reads as "actively edited").
    this.broken = false;
    return pool
      .query({
        text: 'UPDATE app SET source=$2, broken=false, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), source],
      })
      .then(() => undefined);
  };

  getName = () => this.name || 'Unnamed';
  setName = (name: string): Promise<undefined> => {
    this.name = name;
    return pool
      .query({
        text: 'UPDATE app SET name=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), name],
      })
      .then(() => undefined);
  };

  delete = (): Promise<undefined> => {
    return pool
      .query({
        text: 'UPDATE app SET deleted=true, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId()],
      })
      .then(() => undefined);
  };
}
