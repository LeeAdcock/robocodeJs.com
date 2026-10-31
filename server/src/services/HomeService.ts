import pool from '../util/db';
import { logger, LogEvent } from '../util/logger';
import { instanceIdentity, InstanceIdentity } from '../util/instance';
import { UserId } from '../types/user';

// Per-user home leases (GitHub #444, phase 1). Arena state lives in one
// process's memory, so every request for a user's arenas has to land on the
// instance that holds them. A user's "home" is the instance that holds their
// lease here; once forwarding lands (phase 3) every other instance sends that
// user's requests there. This phase only takes, renews and releases leases, so
// the data shows how often two instances end up serving the same user (a
// conflict) before anything is routed on it.
//
// A row is a lease: a holder that stops renewing (crashed, wedged, or cut off
// from the database) loses it after LEASE_MS, and any instance may then take it
// over. `epoch` counts takeovers, so a stale routing decision can be detected
// later. Times come from the app clock rather than the database's, as in
// LadderClaimService, so expiry is always compared on one clock.
//
// Same lazy-DDL idiom as the other services (see the accepted "lazy DDL startup"
// risk in CLAUDE.md); Promise.resolve tolerates a mocked pool.query.
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS user_home (
      user_id     uuid PRIMARY KEY,
      instance_id text        NOT NULL,
      address     text        NOT NULL,
      epoch       bigint      NOT NULL DEFAULT 1,
      expires_at  timestamptz NOT NULL
    )
  `)
).catch(() => undefined);

export const LEASE_MS = 30_000;
// How long an edge trusts a looked-up remote home before asking again. A stale
// entry costs one misdirected forward (421, then a fresh lookup), so this only
// bounds how often an edge hits the database for a user homed elsewhere.
export const REMOTE_CACHE_MS = 5_000;

export interface Home {
  userId: UserId;
  instanceId: string;
  address: string;
  epoch: number;
  local: boolean;
}

export class HomeService {
  // Users whose lease this instance holds, with the epoch it holds it at.
  private held: Map<UserId, number> = new Map();
  // Set by releaseAll on shutdown so a late claim or renew can't re-take a
  // lease this instance has just handed back.
  private closed = false;
  // Users currently found homed on another instance. A conflict is counted and
  // logged once when it starts, not on every 10 s pass while it lasts, and ends
  // when this instance claims the user or stops holding arenas for them.
  private conflicted: Set<UserId> = new Set();
  // Homes found on other instances, cached briefly for forwarding decisions.
  private remote: Map<UserId, { home: Home; until: number }> = new Map();
  private takeovers = 0;
  private conflicts = 0;
  private lost = 0;

  constructor(
    private identity: () => Promise<InstanceIdentity> = instanceIdentity
  ) {}

  // Claim (or re-claim) the user's home for this instance. Succeeds if there is
  // no row, the row has expired, or it's already ours; otherwise leaves the
  // other instance's lease alone. Resolves to whoever holds the home
  // afterwards, or null if the database couldn't say. Never throws: a lease
  // problem must not stop an arena being served.
  claim = async (userId: UserId, now = Date.now()): Promise<Home | null> => {
    if (this.closed) return null;
    try {
      const me = await this.identity();
      // epoch is assigned first on purpose. Postgres evaluates every SET
      // expression against the old row whatever the order, but pg-mem (dev and
      // tests) applies them in sequence, so with instance_id assigned first the
      // takeover check would compare the new holder with itself.
      await pool.query({
        text: `INSERT INTO user_home (user_id, instance_id, address, expires_at)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (user_id) DO UPDATE SET
            epoch = user_home.epoch +
              CASE WHEN user_home.instance_id = EXCLUDED.instance_id THEN 0 ELSE 1 END,
            instance_id = EXCLUDED.instance_id,
            address = EXCLUDED.address,
            expires_at = EXCLUDED.expires_at
          WHERE user_home.expires_at < $5 OR user_home.instance_id = EXCLUDED.instance_id`,
        values: [
          userId,
          me.id,
          me.address,
          new Date(now + LEASE_MS),
          new Date(now),
        ],
      });
      // Read back rather than trusting RETURNING, which pg-mem doesn't report
      // reliably under ON CONFLICT (see LadderClaimService).
      const res = await pool.query({
        text: 'SELECT instance_id, address, epoch FROM user_home WHERE user_id = $1',
        values: [userId],
      });
      const row = res?.rows?.[0];
      if (!row) return null;
      const home: Home = {
        userId,
        instanceId: row.instance_id,
        address: row.address,
        epoch: Number(row.epoch),
        local: row.instance_id === me.id,
      };
      if (home.local) {
        // A fresh claim that bumped the epoch took the home from another
        // instance whose lease had expired.
        if (!this.held.has(userId) && home.epoch > 1) {
          this.takeovers++;
          logger.info(
            { event: LogEvent.HOME_TAKEOVER, userId, epoch: home.epoch },
            'took over an expired user home'
          );
        }
        this.held.set(userId, home.epoch);
        this.conflicted.delete(userId);
      } else if (!this.conflicted.has(userId)) {
        // Without forwarding this instance serves the user anyway, so two
        // instances now hold arena state for them. Expected while an Immutable
        // deploy overlaps old and new; anything else is what phase 3 fixes.
        this.conflicted.add(userId);
        this.conflicts++;
        logger.info(
          { event: LogEvent.HOME_CONFLICT, userId, home: home.instanceId },
          'user home is held by another instance'
        );
      }
      return home;
    } catch (err) {
      logger.warn(
        { event: LogEvent.HOME_ERROR, err, userId },
        'home claim failed'
      );
      return null;
    }
  };

  // Where should a request for this user be served? Local if this instance
  // holds the lease (no database round trip); a recently seen remote home from
  // the cache; otherwise claim, which takes the home if it's free or expired
  // and reports the holder if not. Resolves to null when the database couldn't
  // say, which callers treat as "serve locally".
  resolve = async (userId: UserId, now = Date.now()): Promise<Home | null> => {
    const epoch = this.held.get(userId);
    if (epoch !== undefined) {
      const me = await this.identity();
      return {
        userId,
        instanceId: me.id,
        address: me.address,
        epoch,
        local: true,
      };
    }
    const cached = this.remote.get(userId);
    if (cached && cached.until > now) return cached.home;
    const home = await this.claim(userId, now);
    if (home && !home.local) {
      this.remote.set(userId, { home, until: now + REMOTE_CACHE_MS });
    } else {
      this.remote.delete(userId);
    }
    return home;
  };

  // Drop a cached remote home, after it answered 421 (it no longer holds the
  // user) or couldn't be reached.
  forget = (userId: UserId): void => {
    this.remote.delete(userId);
  };

  // Bring the leases in line with the users this instance has arenas for:
  // renew those, claim any it doesn't hold yet, and release the rest.
  // `owners` is a function rather than a snapshot because a user can come back
  // while a pass is waiting on the database: it's re-read before each release
  // and again before renewing, so an arena rebuilt mid-pass keeps (or re-takes)
  // its lease instead of running unleased until the next pass. Resolves
  // to the users whose home was taken by another instance since the last
  // reconcile; the caller drops their local arenas, since requests for them
  // now go to the new home. A database error keeps every
  // lease as it was and reports nothing lost, because no other instance can
  // claim without the database either.
  reconcile = async (
    owners: () => Set<UserId>,
    now = Date.now()
  ): Promise<UserId[]> => {
    if (this.closed) return [];
    try {
      const me = await this.identity();
      for (const userId of [...this.conflicted]) {
        if (!owners().has(userId)) this.conflicted.delete(userId);
      }
      for (const userId of [...this.held.keys()]) {
        if (owners().has(userId)) continue;
        await pool.query({
          text: 'DELETE FROM user_home WHERE user_id = $1 AND instance_id = $2',
          values: [userId, me.id],
        });
        this.held.delete(userId);
      }
      // Re-read after the releases: a user rebuilt while a delete was in
      // flight is wanted again and gets re-claimed below.
      const wanted = owners();
      if (wanted.size === 0) return [];

      // One statement renews every lease still ours. pg-mem has no working
      // `= ANY($1)`, so the ids go in as a placeholder list.
      const ids = [...wanted];
      const placeholders = (offset: number) =>
        ids.map((_, i) => `$${i + 1 + offset}`).join(', ');
      await pool.query({
        text: `UPDATE user_home SET expires_at = $1
          WHERE instance_id = $2 AND user_id IN (${placeholders(2)})`,
        values: [new Date(now + LEASE_MS), me.id, ...ids],
      });
      const res = await pool.query({
        text: `SELECT user_id, instance_id FROM user_home
          WHERE user_id IN (${placeholders(0)})`,
        values: ids,
      });
      const holders = new Map<UserId, string>(
        (res?.rows ?? []).map((row) => [row.user_id, row.instance_id])
      );

      const lost: UserId[] = [];
      for (const userId of ids) {
        if (holders.get(userId) === me.id) continue;
        // Missing (never claimed, or the claim at arena build failed) or held
        // elsewhere: try to claim. Losing that only counts as a lost lease if
        // this instance held it before.
        const wasHeld = this.held.has(userId);
        const home = await this.claim(userId, now);
        if (home && !home.local && wasHeld) {
          this.held.delete(userId);
          this.lost++;
          lost.push(userId);
          logger.warn(
            { event: LogEvent.HOME_LOST, userId, home: home.instanceId },
            'user home was taken by another instance'
          );
        }
      }
      return lost;
    } catch (err) {
      logger.warn({ event: LogEvent.HOME_ERROR, err }, 'home renew failed');
      return [];
    }
  };

  // Hand back every lease this instance holds, so returning users can be
  // placed on another instance straight away instead of after LEASE_MS. Called
  // at the start of graceful shutdown; nothing is claimed after it.
  //
  // Accepted race: a claim whose upsert is already on the wire when this runs
  // can land after the delete and leave one row behind. Covering it would mean
  // tracking every in-flight claim; the row just expires after LEASE_MS.
  releaseAll = async (): Promise<number> => {
    this.closed = true;
    const count = this.held.size;
    this.held.clear();
    try {
      const me = await this.identity();
      await pool.query({
        text: 'DELETE FROM user_home WHERE instance_id = $1',
        values: [me.id],
      });
    } catch (err) {
      logger.warn({ event: LogEvent.HOME_ERROR, err }, 'home release failed');
    }
    return count;
  };

  //   homeUsers       users whose home lease this instance holds
  //   leaseTakeovers  expired homes this instance took from another
  //   leaseConflicts  times a user was found homed on another instance (once
  //                   per episode, not per pass)
  //   conflictedUsers users homed elsewhere that this instance also serves now
  //   leasesLost      leases another instance took from this one
  metrics = () => ({
    homeUsers: this.held.size,
    leaseTakeovers: this.takeovers,
    leaseConflicts: this.conflicts,
    conflictedUsers: this.conflicted.size,
    leasesLost: this.lost,
  });
}

export default new HomeService();
