import { randomUUID } from 'node:crypto';
import pool from '../util/db';
import { AppId } from '../types/app';

// Cross-instance "this app is in a ranked match" claims (GitHub #409).
//
// LadderService already refuses to put one app in two matches at once, but only
// with an in-memory Set, which is per process. Once more than one instance runs
// the ladder (an ASG scale-out, or simply the old and new instance overlapping
// during an Immutable deploy), each has its own Set and nothing stops two
// instances matching the same app concurrently. This table is the shared
// version of that Set: a match claims both of its apps here before it starts and
// releases them when it ends.
//
// A row is a lease, not a lock: `claimedAt` lets a claim left behind by a
// crashed or redeployed instance expire (see staleBefore in the callers) rather
// than benching that app forever.
//
// Same lazy-DDL idiom as the other services (see the accepted "lazy DDL startup"
// risk in CLAUDE.md); Promise.resolve tolerates a mocked pool.query.
Promise.resolve(
  pool.query(`
    CREATE TABLE IF NOT EXISTS ladder_claim (
      appId UUID PRIMARY KEY,
      token text,
      claimedAt timestamp
    )
  `)
).catch(() => undefined);

export interface LadderClaim {
  appIds: [AppId, AppId];
  token: string;
}

class LadderClaimService {
  // Try to claim both apps for one match. Resolves to the claim on success, or
  // null if either app is already claimed by a live (non-expired) match
  // anywhere. All-or-nothing: on a partial win the half we got is released.
  //
  // Success is decided by reading the rows back, NOT from INSERT ... RETURNING:
  // pg-mem (dev/test) returns the conflicting row from RETURNING even under
  // ON CONFLICT DO NOTHING, which would report a claim we never got. The
  // read-back is correct on both, because `token` is unique to this attempt.
  //
  // `now` and `staleBefore` come from the caller's clock rather than the
  // database's so claim times and the expiry cutoff are always on the same
  // clock (instances are NTP-synced; mixing app and DB time is not).
  claim = async (
    appIdA: AppId,
    appIdB: AppId,
    now: Date,
    staleBefore: Date
  ): Promise<LadderClaim | null> => {
    const token = randomUUID();
    // Expire leases from dead or wedged matches first, so a stale row can't
    // block the insert below.
    await pool.query({
      text: 'DELETE FROM ladder_claim WHERE appId IN ($1,$2) AND claimedAt < $3',
      values: [appIdA, appIdB, staleBefore],
    });
    await pool.query({
      text:
        'INSERT INTO ladder_claim(appId, token, claimedAt) VALUES ($1,$3,$4),($2,$3,$4) ' +
        'ON CONFLICT (appId) DO NOTHING',
      values: [appIdA, appIdB, token, now],
    });
    const res = await pool.query({
      text: 'SELECT appId, token FROM ladder_claim WHERE appId IN ($1,$2)',
      values: [appIdA, appIdB],
    });
    const mine = (res?.rows ?? []).filter((row) => row.token === token).length;
    const claim: LadderClaim = { appIds: [appIdA, appIdB], token };
    if (mine === 2) return claim;
    await this.release(claim);
    return null;
  };

  // Release a claim. Scoped by token, so it can only ever delete rows this
  // attempt inserted — never another match's claim on the same app.
  release = async (claim: LadderClaim): Promise<void> => {
    await pool.query({
      text: 'DELETE FROM ladder_claim WHERE appId IN ($1,$2) AND token=$3',
      values: [claim.appIds[0], claim.appIds[1], claim.token],
    });
  };

  // Apps currently claimed by a live match on any instance. Lets matchmaking
  // skip them up front instead of picking a pair it then can't claim.
  claimedApps = async (staleBefore: Date): Promise<Set<AppId>> => {
    const res = await pool.query({
      text: 'SELECT appId FROM ladder_claim WHERE claimedAt >= $1',
      values: [staleBefore],
    });
    return new Set((res?.rows ?? []).map((row) => row.appid as AppId));
  };
}

export default new LadderClaimService();
