import { describe, it, expect, vi, beforeEach } from 'vitest';

// User home leases (GitHub #444), run against a real pg-mem database rather
// than a mocked pool, because what matters is that the SQL itself behaves: a
// live lease can't be stolen, an expired one can, a takeover bumps the epoch,
// and each instance only ever touches its own rows.
vi.mock('../src/util/db', async () => {
  const { newDb } = await import('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return { default: new Pool() };
});

import pool from '../src/util/db';
import {
  HomeService,
  LEASE_MS,
  REMOTE_CACHE_MS,
} from '../src/services/HomeService';

const U1 = '11111111-1111-1111-1111-111111111111';
const U2 = '22222222-2222-2222-2222-222222222222';

const instance = (id: string) =>
  new HomeService(() => Promise.resolve({ id, address: `http://${id}:8080` }));

const holder = async (userId: string) => {
  const res = await pool.query({
    text: 'SELECT instance_id, epoch FROM user_home WHERE user_id = $1',
    values: [userId],
  });
  const row = res.rows[0];
  return row ? { instanceId: row.instance_id, epoch: Number(row.epoch) } : null;
};

const T0 = Date.parse('2026-10-31T12:00:00Z');

beforeEach(async () => {
  await pool.query('DELETE FROM user_home');
});

describe('HomeService.claim', () => {
  it('claims a user with no home', async () => {
    const a = instance('a');
    const home = await a.claim(U1, T0);
    expect(home).toMatchObject({
      instanceId: 'a',
      address: 'http://a:8080',
      epoch: 1,
      local: true,
    });
    expect(a.metrics()).toMatchObject({ homeUsers: 1, leaseTakeovers: 0 });
  });

  it("leaves another instance's live lease alone and reports it", async () => {
    const a = instance('a');
    const b = instance('b');
    await a.claim(U1, T0);
    const home = await b.claim(U1, T0 + 1000);
    expect(home).toMatchObject({ instanceId: 'a', local: false });
    expect(await holder(U1)).toEqual({ instanceId: 'a', epoch: 1 });
    expect(b.metrics()).toMatchObject({ homeUsers: 0, leaseConflicts: 1 });
  });

  it('re-claiming its own lease extends it without bumping the epoch', async () => {
    const a = instance('a');
    await a.claim(U1, T0);
    // Even past expiry, the holder renews its own row in place.
    await a.claim(U1, T0 + LEASE_MS + 1000);
    expect(await holder(U1)).toEqual({ instanceId: 'a', epoch: 1 });
    expect(a.metrics().leaseTakeovers).toBe(0);
  });

  it('takes over an expired lease and bumps the epoch', async () => {
    const a = instance('a');
    const b = instance('b');
    await a.claim(U1, T0);
    const home = await b.claim(U1, T0 + LEASE_MS + 1);
    expect(home).toMatchObject({ instanceId: 'b', epoch: 2, local: true });
    expect(b.metrics()).toMatchObject({ homeUsers: 1, leaseTakeovers: 1 });
  });

  it('never throws; a database error resolves to null', async () => {
    const a = instance('a');
    const spy = vi
      .spyOn(pool, 'query')
      .mockRejectedValueOnce(new Error('down'));
    await expect(a.claim(U1, T0)).resolves.toBeNull();
    spy.mockRestore();
  });
});

describe('HomeService.reconcile', () => {
  it('renews the leases it still wants', async () => {
    const a = instance('a');
    const b = instance('b');
    await a.claim(U1, T0);
    // Renewed at T0 + 20s, so the lease runs to T0 + 50s and b can't take it
    // at T0 + 40s, after the original expiry.
    expect(await a.reconcile(() => new Set([U1]), T0 + 20_000)).toEqual([]);
    await b.claim(U1, T0 + 40_000);
    expect(await holder(U1)).toEqual({ instanceId: 'a', epoch: 1 });
  });

  it('claims wanted users it has no lease for yet', async () => {
    const a = instance('a');
    await a.reconcile(() => new Set([U1, U2]), T0);
    expect(await holder(U1)).toMatchObject({ instanceId: 'a' });
    expect(await holder(U2)).toMatchObject({ instanceId: 'a' });
    expect(a.metrics().homeUsers).toBe(2);
  });

  it('releases users it no longer has arenas for', async () => {
    const a = instance('a');
    await a.claim(U1, T0);
    await a.claim(U2, T0);
    await a.reconcile(() => new Set([U2]), T0 + 10_000);
    expect(await holder(U1)).toBeNull();
    expect(await holder(U2)).toMatchObject({ instanceId: 'a' });
    expect(a.metrics().homeUsers).toBe(1);
  });

  it('reports a lease another instance took over as lost', async () => {
    const a = instance('a');
    const b = instance('b');
    await a.claim(U1, T0);
    // a stalls past expiry and b takes the user over.
    await b.claim(U1, T0 + LEASE_MS + 1);
    expect(await a.reconcile(() => new Set([U1]), T0 + LEASE_MS + 2)).toEqual([
      U1,
    ]);
    expect(a.metrics()).toMatchObject({ homeUsers: 0, leasesLost: 1 });
    expect(await holder(U1)).toMatchObject({ instanceId: 'b', epoch: 2 });
  });

  it('does not report a user it never held as lost', async () => {
    const a = instance('a');
    const b = instance('b');
    await b.claim(U1, T0);
    expect(await a.reconcile(() => new Set([U1]), T0 + 1000)).toEqual([]);
    expect(a.metrics()).toMatchObject({ leasesLost: 0, leaseConflicts: 1 });
  });

  it('keeps every lease and reports nothing lost when the database errors', async () => {
    const a = instance('a');
    await a.claim(U1, T0);
    const spy = vi.spyOn(pool, 'query').mockRejectedValue(new Error('down'));
    expect(await a.reconcile(() => new Set([U1]), T0 + 10_000)).toEqual([]);
    spy.mockRestore();
    expect(a.metrics().homeUsers).toBe(1);
  });
});

describe('HomeService conflicts', () => {
  it('counts and logs a conflict once per episode, not per pass', async () => {
    const a = instance('a');
    const b = instance('b');
    await b.claim(U1, T0);
    for (let i = 1; i <= 6; i++) {
      await a.reconcile(() => new Set([U1]), T0 + i * 1000);
    }
    expect(a.metrics()).toMatchObject({
      leaseConflicts: 1,
      conflictedUsers: 1,
    });
  });

  it('ends the episode when this instance stops serving the user', async () => {
    const a = instance('a');
    const b = instance('b');
    await b.claim(U1, T0);
    await a.claim(U1, T0);
    await a.reconcile(() => new Set(), T0 + 10_000);
    expect(a.metrics().conflictedUsers).toBe(0);
    // A later conflict is a new episode.
    await a.claim(U1, T0 + 20_000);
    expect(a.metrics().leaseConflicts).toBe(2);
  });

  it('ends the episode when this instance takes the user over', async () => {
    const a = instance('a');
    const b = instance('b');
    await b.claim(U1, T0);
    await a.claim(U1, T0);
    await a.claim(U1, T0 + LEASE_MS + 1);
    expect(a.metrics()).toMatchObject({
      conflictedUsers: 0,
      homeUsers: 1,
      leaseTakeovers: 1,
    });
  });
});

describe('HomeService.reconcile — user returns mid-release', () => {
  it('keeps the lease of a user whose arena was rebuilt during the release', async () => {
    const a = instance('a');
    await a.claim(U1, T0);
    // owners() reports no arenas when the pass decides to release, and the
    // rebuilt arena by the time the delete has gone through.
    let calls = 0;
    const owners = () => (calls++ === 0 ? new Set<string>() : new Set([U1]));
    await a.reconcile(owners, T0 + 10_000);
    expect(await holder(U1)).toMatchObject({ instanceId: 'a' });
    expect(a.metrics().homeUsers).toBe(1);
  });
});

describe('HomeService.resolve', () => {
  it('answers from memory for a user homed here', async () => {
    const a = instance('a');
    await a.claim(U1, T0);
    const spy = vi.spyOn(pool, 'query');
    expect(await a.resolve(U1, T0 + 1000)).toMatchObject({
      instanceId: 'a',
      local: true,
    });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it('claims a user nobody holds', async () => {
    const a = instance('a');
    expect(await a.resolve(U1, T0)).toMatchObject({ local: true });
    expect(await holder(U1)).toMatchObject({ instanceId: 'a' });
  });

  it('caches a remote home briefly, and forget drops it', async () => {
    const a = instance('a');
    const b = instance('b');
    await b.claim(U1, T0);
    expect(await a.resolve(U1, T0)).toMatchObject({
      instanceId: 'b',
      address: 'http://b:8080',
      local: false,
    });

    const spy = vi.spyOn(pool, 'query');
    await a.resolve(U1, T0 + REMOTE_CACHE_MS - 1);
    expect(spy).not.toHaveBeenCalled();
    a.forget(U1);
    await a.resolve(U1, T0 + REMOTE_CACHE_MS - 1);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('looks again once the cache expires, and follows a takeover', async () => {
    const a = instance('a');
    const b = instance('b');
    const c = instance('c');
    await b.claim(U1, T0);
    await a.resolve(U1, T0);
    // b dies; c takes the user over after the lease lapses.
    await c.claim(U1, T0 + LEASE_MS + 1);
    expect(await a.resolve(U1, T0 + LEASE_MS + 2)).toMatchObject({
      instanceId: 'c',
      epoch: 2,
    });
  });
});

describe('HomeService.releaseAll', () => {
  it("deletes only this instance's rows and claims nothing afterwards", async () => {
    const a = instance('a');
    const b = instance('b');
    await a.claim(U1, T0);
    await b.claim(U2, T0);
    expect(await a.releaseAll()).toBe(1);
    expect(await holder(U1)).toBeNull();
    expect(await holder(U2)).toMatchObject({ instanceId: 'b' });

    expect(await a.claim(U1, T0 + 1000)).toBeNull();
    expect(await a.reconcile(() => new Set([U1]), T0 + 1000)).toEqual([]);
    expect(await holder(U1)).toBeNull();
  });
});
