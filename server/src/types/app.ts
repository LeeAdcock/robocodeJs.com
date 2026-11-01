import pool from '../util/db';
import { UserId } from './user';
import nameFactory from '../util/nameFactory';
import { DEFAULT_RATING } from '../util/elo';
import { sanitizeBotName } from '../util/botName';
import { isNameProfane, NameRejectedError } from '../util/nameFilter';

export type AppId = string & {};

// The subset of ladder fields hydrated from persistence (GitHub #151), plus the
// visibility flag (GitHub #117). Optional so callers that only loaded
// name/source (or a legacy row predating these columns) get sensible defaults.
export interface AppRatingFields {
  rating?: number | null;
  ratingGames?: number | null;
  ratingWins?: number | null;
  broken?: boolean | null;
  isPublic?: boolean | null;
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
  // Whether the owner has opted this app's SOURCE into public view (GitHub
  // #117). Default private: source is owner-only unless this is set. A public
  // app's code is readable by anyone — from the rankings, from an arena roster
  // it was added to, and over the public app route — but it is still only
  // editable by its owner (visibility never widens any write path).
  private publicSource = false;

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
    this.publicSource = ratings?.isPublic ?? false;
    return this;
  };

  getRating = () => this.rating;
  getRatingGames = () => this.ratingGames;
  getRatingWins = () => this.ratingWins;
  isBroken = () => this.broken;

  // Persist one ranked match's result: add the Elo `delta`, count the game, count
  // the win (when this app won), and stamp lastRankedAt, all in one statement.
  //
  // Written as increments relative to the row, never as absolute values
  // (GitHub #409). The delta is computed from the ratings read when the match
  // STARTED, and a match takes ~40 s; writing back an absolute "start + delta"
  // would silently erase any other result for this app that landed in between
  // (another ladder worker or instance). Increments compose, so concurrent
  // results all count. RETURNING syncs the in-memory fields to the row's actual
  // post-update values, which include those concurrent results.
  applyRatingResult = (delta: number, won: boolean): Promise<undefined> => {
    return pool
      .query({
        text:
          'UPDATE app SET rating = COALESCE(rating, 1500) + $2, ' +
          'ratingGames = COALESCE(ratingGames, 0) + 1, ' +
          'ratingWins = COALESCE(ratingWins, 0) + $3, ' +
          'lastRankedAt = CURRENT_TIMESTAMP WHERE id=$1 ' +
          'RETURNING rating as "rating", ratingGames as "ratingGames", ratingWins as "ratingWins"',
        values: [this.getId(), delta, won ? 1 : 0],
      })
      .then((res) => {
        const row = res?.rows?.[0];
        if (row) {
          this.rating = Number(row.rating);
          this.ratingGames = Number(row.ratingGames);
          this.ratingWins = Number(row.ratingWins);
        } else {
          // No row back (app deleted mid-match): keep the in-memory view
          // consistent with what we tried to apply.
          this.rating += delta;
          this.ratingGames += 1;
          if (won) this.ratingWins += 1;
        }
        return undefined;
      });
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

  isPublic = () => this.publicSource;
  // Toggle the app's source between public and private. Deliberately does NOT
  // bump updatedTimestamp: that column is the ladder's "this app's code
  // changed" signal (see setName), and flipping visibility changes no code, so
  // it must not reset pair saturation or re-run ranked matches.
  setPublic = (isPublic: boolean): Promise<undefined> => {
    this.publicSource = isPublic;
    return pool
      .query({
        text: 'UPDATE app SET isPublic=$2 WHERE id=$1',
        values: [this.getId(), isPublic],
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
  // The single persistence chokepoint for a name, so every writer (sandbox
  // bot.setName, MCP create_app, starter seeding) is sanitized by one rule.
  // An all-junk/empty name is ignored rather than blanking the current one.
  setName = (name: string): Promise<undefined> => {
    const clean = sanitizeBotName(name);
    if (clean.length === 0) return Promise.resolve(undefined);
    // Reject (rather than mask/substitute) a name that trips the profanity
    // filter. Direct callers (e.g. MCP) surface this; the sandbox bot.setName
    // path pre-checks and never reaches here with a profane name.
    if (isNameProfane(clean)) return Promise.reject(new NameRejectedError());
    // No-op when the name is already what we'd write. `updatedTimestamp` is the
    // ladder's "this app's code changed" signal (LadderService's per-pair
    // saturation cap keys off it, and getLadderCandidates' 3-month activity gate
    // reads it), so bumping it for a rename that isn't a rename would reset
    // saturation and re-run matches for no reason. Bot.setName already compares
    // before calling — every bot re-asserts its name on each script load, and
    // the ladder boots 10 bots per match — but this is the authoritative
    // chokepoint, so the guard belongs here too rather than only in one caller.
    if (clean === this.name) return Promise.resolve(undefined);
    this.name = clean;
    return pool
      .query({
        text: 'UPDATE app SET name=$2, updatedTimestamp=CURRENT_TIMESTAMP WHERE id=$1',
        values: [this.getId(), clean],
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
