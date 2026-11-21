import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// Personal tournaments (GitHub #119), run against a real pg-mem database rather
// than a mocked pool: the board is a JOIN over app/account/tournament_member, so
// what matters is that the SQL itself filters and orders correctly.
vi.mock('../src/util/db', async () => {
  const { newDb } = await import('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return { default: new Pool() };
});

// Resolve the acting user from a test header instead of a Google cookie, with
// the real gate semantics: auth(true) 401s an anonymous request, auth(false)
// lets it through.
vi.mock('../src/middleware/auth', () => ({
  default:
    (required: boolean) =>
    (
      req: { headers: Record<string, string>; user?: unknown },
      res: { status: (n: number) => { json: (b: unknown) => void } },
      next: () => void
    ) => {
      const id = req.headers['x-test-user'];
      if (id) req.user = { getId: () => id };
      else if (required) {
        res.status(401).json({ error: 'Sign in required.' });
        return;
      }
      next();
    },
}));

import pool from '../src/util/db';
import tournamentRouter from '../src/api/tournament';
import tournamentService, {
  DEFAULT_SETTINGS,
} from '../src/services/TournamentService';
import { MAX_TOURNAMENTS_PER_USER } from '../src/util/limits';
import appService from '../src/services/AppService';

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const CAROL = '33333333-3333-3333-3333-333333333333';
const MISSING = '99999999-9999-9999-9999-999999999999';

let appSeq = 0;
const addApp = async (
  userId: string,
  name: string,
  rating: number,
  games = 10
) => {
  appSeq += 1;
  const id = `aaaaaaaa-0000-0000-0000-${String(appSeq).padStart(12, '0')}`;
  await pool.query({
    text: 'INSERT INTO app(id, userId, name, source, rating, ratingGames, ratingWins) VALUES($1,$2,$3,$4,$5,$6,$7)',
    values: [id, userId, name, '// code', rating, games, Math.floor(games / 2)],
  });
  return id;
};

beforeAll(async () => {
  // app and ranked_match come from their services' own DDL at import; account
  // belongs to UserService, which this test doesn't import.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS account (
      id UUID PRIMARY KEY, name text, picture text, email text,
      lastActiveAt timestamp, createdTimestamp timestamp default CURRENT_TIMESTAMP)`);
  await pool.query({
    text: 'INSERT INTO account(id, name) VALUES($1,$2),($3,$4),($5,$6)',
    values: [ALICE, 'Alice Archer', BOB, 'Bob Baker', CAROL, 'Carol Cooper'],
  });
});

beforeEach(async () => {
  await pool.query('DELETE FROM tournament_member');
  await pool.query('DELETE FROM tournament');
  await pool.query('DELETE FROM app');
});

// Mount the router behind a JSON body parser, as index.ts does.
const server = express();
server.use(express.json());
server.use(tournamentRouter);
const api = (userId?: string) => {
  const agent = request(server);
  const w = (r: request.Test) => (userId ? r.set('x-test-user', userId) : r);
  return {
    get: (p: string) => w(agent.get(p)),
    post: (p: string, body?: object) => w(agent.post(p)).send(body ?? {}),
    put: (p: string) => w(agent.put(p)),
    patch: (p: string, body?: object) => w(agent.patch(p)).send(body ?? {}),
    delete: (p: string) => w(agent.delete(p)),
  };
};

describe('tournament board', () => {
  it('ranks only members’ apps, every app (no per-owner cap), renumbered 1..N', async () => {
    // Alice has four rated apps — the global board would cap her at three.
    await addApp(ALICE, 'A1', 1800);
    await addApp(ALICE, 'A2', 1700);
    await addApp(ALICE, 'A3', 1600);
    await addApp(ALICE, 'A4', 1550);
    await addApp(BOB, 'B1', 1650);
    // Carol is the global #1 but not a member.
    await addApp(CAROL, 'C1', 1900);

    const t = await tournamentService.create(ALICE, 'Club');
    await tournamentService.join(t.id, BOB);

    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Club');
    expect(res.body.memberCount).toBe(2);
    // The member roster is owner-only.
    expect(res.body.members).toBeUndefined();
    expect(res.body.ownerName).toBe('Alice A.');
    expect(
      res.body.entries.map((e: { rank: number; name: string }) => [
        e.rank,
        e.name,
      ])
    ).toEqual([
      [1, 'A1'],
      [2, 'A2'],
      [3, 'B1'],
      [4, 'A3'],
      [5, 'A4'],
    ]);
    // Anonymous viewer: no app ids, no join state.
    expect(res.body.entries.every((e: { appId?: string }) => !e.appId)).toBe(
      true
    );
    expect(res.body.joined).toBe(false);
    expect(res.body.isOwner).toBe(false);
    // Member user ids never leave the server.
    expect(JSON.stringify(res.body)).not.toContain(BOB);
  });

  it('leaves the global board unchanged (cap of three, everyone ranked)', async () => {
    await addApp(ALICE, 'A1', 1800);
    await addApp(ALICE, 'A2', 1700);
    await addApp(ALICE, 'A3', 1600);
    await addApp(ALICE, 'A4', 1550);
    await addApp(CAROL, 'C1', 1900);
    const board = await appService.getLeaderboard(20);
    expect(board.map((e) => e.name)).toEqual(['C1', 'A1', 'A2', 'A3']);
  });

  it('marks the viewer’s own rows and membership', async () => {
    const a1 = await addApp(ALICE, 'A1', 1800);
    await addApp(BOB, 'B1', 1650);
    const t = await tournamentService.create(ALICE, 'Club');
    await tournamentService.join(t.id, BOB);

    const res = await api(ALICE).get(`/api/tournaments/${t.id}`);
    expect(res.body.isOwner).toBe(true);
    expect(res.body.members).toEqual(['Alice A.', 'Bob B.']);
    // A member who isn't the creator doesn't get the roster.
    const bob = await api(BOB).get(`/api/tournaments/${t.id}`);
    expect(bob.body.isOwner).toBe(false);
    expect(bob.body.joined).toBe(true);
    expect(bob.body.members).toBeUndefined();
    expect(res.body.joined).toBe(true);
    const mine = res.body.entries.filter((e: { appId?: string }) => e.appId);
    expect(mine.map((e: { appId: string }) => e.appId)).toEqual([a1]);
  });

  it('carries an app’s public flag (and so its id) through both boards', async () => {
    // GitHub #478 regression: the candidate SQL once omitted the isPublic
    // column, so every board row read as private and the rankings never linked
    // a public bot to its source, even though the flag was stored. This runs
    // the real query, where a mocked pool can't notice a missing column.
    const a1 = await addApp(ALICE, 'Open', 1800);
    await addApp(BOB, 'Closed', 1650);
    const app = await appService.get(a1);
    await app!.setPublic(true);

    const board = await appService.getLeaderboard(20); // anonymous viewer
    expect(
      board.map((e) => [e.name, e.public, e.appId ?? null, e.own])
    ).toEqual([
      ['Open', true, a1, false],
      ['Closed', false, null, false],
    ]);

    const t = await tournamentService.create(ALICE, 'Club');
    await tournamentService.join(t.id, BOB);
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(
      res.body.entries.map(
        (e: { name: string; public: boolean; appId?: string }) => [
          e.name,
          e.public,
          e.appId ?? null,
        ]
      )
    ).toEqual([
      ['Open', true, a1],
      ['Closed', false, null],
    ]);
  });

  it('400s a malformed id and 404s an unknown one', async () => {
    expect((await api().get('/api/tournaments/not-a-uuid')).status).toBe(400);
    expect((await api().get(`/api/tournaments/${MISSING}`)).status).toBe(404);
  });
});

describe('tournament settings', () => {
  const names = (res: {
    body: { entries: { rank: number; name: string }[] };
  }) => res.body.entries.map((e) => [e.rank, e.name]);

  // Alice has four rated apps, Bob two; Carol is not a member.
  const seed = async () => {
    await addApp(ALICE, 'A1', 1800);
    await addApp(ALICE, 'A2', 1700);
    await addApp(ALICE, 'A3', 1600);
    await addApp(ALICE, 'A4', 1550);
    await addApp(BOB, 'B1', 1650);
    await addApp(BOB, 'B2', 1500);
    await addApp(CAROL, 'C1', 1900);
    const t = await tournamentService.create(ALICE, 'Club');
    await tournamentService.join(t.id, BOB);
    return t;
  };

  it('defaults to no limits and reports them with their ceilings', async () => {
    const t = await seed();
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.settings).toEqual(DEFAULT_SETTINGS);
    expect(res.body.settingsLimits).toEqual({
      maxAppsPerMember: 20,
      maxEntries: 100,
      minGames: 10000,
    });
    expect(res.body.ended).toBe(false);
    expect(res.body.joinClosed).toBeUndefined();
    expect(res.body.entries).toHaveLength(6);
    // Owner names show by default.
    expect(res.body.entries[0].ownerName).toBe('Alice A.');
  });

  it('a per-member cap keeps each member’s highest-rated bots and renumbers', async () => {
    const t = await seed();
    const patched = await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      maxAppsPerMember: 2,
    });
    expect(patched.status).toBe(200);
    expect(patched.body).toMatchObject({
      name: 'Club',
      settings: { ...DEFAULT_SETTINGS, maxAppsPerMember: 2 },
      updated: true,
    });

    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.settings.maxAppsPerMember).toBe(2);
    expect(names(res)).toEqual([
      [1, 'A1'],
      [2, 'A2'],
      [3, 'B1'],
      [4, 'B2'],
    ]);
  });

  it('a row cap truncates the ranked board', async () => {
    const t = await seed();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { maxEntries: 3 });
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(names(res)).toEqual([
      [1, 'A1'],
      [2, 'A2'],
      [3, 'B1'],
    ]);
  });

  it('applies both caps together, and null clears one', async () => {
    const t = await seed();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      maxAppsPerMember: 1,
      maxEntries: 1,
    });
    expect(names(await api().get(`/api/tournaments/${t.id}`))).toEqual([
      [1, 'A1'],
    ]);

    // Clearing the row cap leaves the per-member cap in place.
    const cleared = await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      maxEntries: null,
    });
    expect(cleared.body.settings).toEqual({
      ...DEFAULT_SETTINGS,
      maxAppsPerMember: 1,
    });
    expect(names(await api().get(`/api/tournaments/${t.id}`))).toEqual([
      [1, 'A1'],
      [2, 'B1'],
    ]);
  });

  it('renames and changes settings in one request, or either alone', async () => {
    const t = await seed();
    const both = await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      name: 'Top Two',
      maxAppsPerMember: 2,
    });
    expect(both.body).toMatchObject({
      name: 'Top Two',
      settings: { maxAppsPerMember: 2 },
    });
    // A settings-only PATCH leaves the name alone.
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { maxEntries: 5 });
    const stored = await tournamentService.get(t.id);
    expect(stored).toMatchObject({
      name: 'Top Two',
      maxAppsPerMember: 2,
      maxEntries: 5,
    });
  });

  it('rejects out-of-range, non-integer, and empty updates', async () => {
    const t = await seed();
    for (const body of [
      { maxAppsPerMember: 0 },
      { maxAppsPerMember: 21 },
      { maxAppsPerMember: 2.5 },
      { maxAppsPerMember: '3' },
      { maxEntries: 0 },
      { maxEntries: 101 },
      { minGames: 0 },
      { minGames: 10001 },
      { rankBy: 'owners' },
      { hideOwners: 'yes' },
      { publicOnly: 1 },
      { joinLocked: null },
      { endsAt: 'tomorrow-ish' },
      { endsAt: 1700000000 },
      { editedSince: '' },
      {},
      { unrelated: true },
    ]) {
      const res = await api(ALICE).patch(`/api/tournaments/${t.id}`, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // A bad name rejects the whole request — the valid cap beside it is not
    // written.
    const half = await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      name: '   ',
      maxEntries: 3,
    });
    expect(half.status).toBe(400);
    expect((await tournamentService.get(t.id))?.maxEntries).toBeNull();
  });

  it('lets only the creator change settings', async () => {
    const t = await seed();
    const res = await api(BOB).patch(`/api/tournaments/${t.id}`, {
      maxAppsPerMember: 1,
    });
    expect(res.status).toBe(403);
    expect((await tournamentService.get(t.id))?.maxAppsPerMember).toBeNull();
  });

  it('a games floor hides lightly-played bots', async () => {
    const t = await seed();
    // B2 has only 2 games; everyone else has the default 10.
    await pool.query(
      `UPDATE app SET ratingGames = 2, ratingWins = 1 WHERE name = 'B2'`
    );
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { minGames: 5 });
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(names(res).map(([, n]) => n)).toEqual([
      'A1',
      'A2',
      'B1',
      'A3',
      'A4',
    ]);
  });

  it('ranking players shows one row per member, their best bot', async () => {
    const t = await seed();
    // Any per-member cap is moot in players mode.
    await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      rankBy: 'members',
      maxAppsPerMember: 3,
    });
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.settings.rankBy).toBe('members');
    expect(names(res)).toEqual([
      [1, 'A1'],
      [2, 'B1'],
    ]);
  });

  it('hiding owners leaves ownerName off every row, including the creator’s', async () => {
    const t = await seed();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { hideOwners: true });
    const res = await api(BOB).get(`/api/tournaments/${t.id}`);
    expect(res.body.entries).toHaveLength(6);
    for (const e of res.body.entries) expect(e).not.toHaveProperty('ownerName');
    // The viewer still recognises their own rows.
    expect(
      res.body.entries
        .filter((e: { own: boolean }) => e.own)
        .map((e: { name: string }) => e.name)
    ).toEqual(['B1', 'B2']);
    expect(JSON.stringify(res.body.entries)).not.toContain('Alice');
  });

  it('public-only keeps just the bots whose source is public', async () => {
    const t = await seed();
    await pool.query(
      `UPDATE app SET isPublic = true WHERE name IN ('A2', 'B2')`
    );
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { publicOnly: true });
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(names(res)).toEqual([
      [1, 'A2'],
      [2, 'B2'],
    ]);
    // Every row shown is public, so every row carries its id.
    expect(res.body.entries.every((e: { appId?: string }) => e.appId)).toBe(
      true
    );
  });

  it('edited-since counts only bots touched at or after the date', async () => {
    const t = await seed();
    await pool.query(
      `UPDATE app SET updatedTimestamp = '2026-01-01T00:00:00Z' WHERE name IN ('A1', 'B1')`
    );
    await pool.query(
      `UPDATE app SET updatedTimestamp = '2026-03-01T00:00:00Z' WHERE name NOT IN ('A1', 'B1')`
    );
    await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      editedSince: '2026-02-01T00:00:00Z',
    });
    const res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.settings.editedSince).toBe('2026-02-01T00:00:00.000Z');
    expect(names(res).map(([, n]) => n)).toEqual(['A2', 'A3', 'A4', 'B2']);
  });

  it('closing joining turns newcomers away but not members', async () => {
    const t = await seed();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { joinLocked: true });
    const board = await api(CAROL).get(`/api/tournaments/${t.id}`);
    expect(board.body.joinClosed).toMatch(/not accepting/);

    const refused = await api(CAROL).put(`/api/tournaments/${t.id}/members/me`);
    expect(refused.status).toBe(409);
    expect(await tournamentService.isMember(t.id, CAROL)).toBe(false);
    // Re-joining as an existing member stays idempotent, and leaving works.
    expect(
      (await api(BOB).put(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(200);
    expect(
      (await api(BOB).delete(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(200);

    await api(ALICE).patch(`/api/tournaments/${t.id}`, { joinLocked: false });
    expect(
      (await api(CAROL).put(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(200);
  });

  it('an end date freezes the standings once it passes', async () => {
    const t = await seed();
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { endsAt: future });
    let res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.ended).toBe(false);
    expect(res.body.joinClosed).toBeUndefined();
    expect(res.body.settings.endsAt).toBe(future);

    // Deadline passes: the next read records the final standings...
    const past = new Date(Date.now() - 1000).toISOString();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { endsAt: past });
    res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.ended).toBe(true);
    expect(res.body.joinClosed).toMatch(/ended/);
    const finalNames = names(res);
    expect(finalNames[0]).toEqual([1, 'A1']);
    expect((await tournamentService.get(t.id))?.finalBoard).toHaveLength(6);

    // ...and the board no longer follows the live ratings or the roster.
    await pool.query(`UPDATE app SET rating = 2500 WHERE name = 'B2'`);
    await tournamentService.leave(t.id, ALICE);
    res = await api().get(`/api/tournaments/${t.id}`);
    expect(names(res)).toEqual(finalNames);
    // Frozen rows show no movement.
    expect(
      res.body.entries.every(
        (e: { rank: number; previousRank?: number }) =>
          e.previousRank === e.rank
      )
    ).toBe(true);
    // Nobody new can join an ended tournament.
    expect(
      (await api(CAROL).put(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(409);
    // The viewer's own rows are still theirs on a frozen board.
    const asBob = await api(BOB).get(`/api/tournaments/${t.id}`);
    expect(
      asBob.body.entries.filter((e: { own: boolean }) => e.own)
    ).toHaveLength(2);

    // Clearing the end date reopens the board: live ratings again.
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { endsAt: null });
    res = await api().get(`/api/tournaments/${t.id}`);
    expect(res.body.ended).toBe(false);
    expect(names(res)).toEqual([
      [1, 'B2'],
      [2, 'B1'],
    ]);
    expect((await tournamentService.get(t.id))?.finalBoard).toBeNull();
  });

  it('a settings change other than the end date leaves final standings alone', async () => {
    const t = await seed();
    const past = new Date(Date.now() - 1000).toISOString();
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { endsAt: past });
    await api().get(`/api/tournaments/${t.id}`);
    await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      name: 'Done',
      maxEntries: 2,
    });
    const res = await api().get(`/api/tournaments/${t.id}`);
    // Still the six frozen rows, not a re-ranked top two.
    expect(res.body.entries).toHaveLength(6);
    expect(res.body.name).toBe('Done');
    // Hiding owners is presentation, so it does apply to a frozen board.
    await api(ALICE).patch(`/api/tournaments/${t.id}`, { hideOwners: true });
    const hidden = await api().get(`/api/tournaments/${t.id}`);
    expect(hidden.body.entries[0]).not.toHaveProperty('ownerName');
  });
});

describe('tournament membership', () => {
  it('join adds all the member’s apps; leave removes them', async () => {
    await addApp(ALICE, 'A1', 1800);
    await addApp(BOB, 'B1', 1650);
    await addApp(BOB, 'B2', 1600);
    const t = await tournamentService.create(ALICE, 'Club');
    const names = async () =>
      (await api().get(`/api/tournaments/${t.id}`)).body.entries.map(
        (e: { name: string }) => e.name
      );

    expect(await names()).toEqual(['A1']);

    const join = await api(BOB).put(`/api/tournaments/${t.id}/members/me`);
    expect(join.status).toBe(200);
    expect(join.body.joined).toBe(true);
    // Idempotent.
    expect(
      (await api(BOB).put(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(200);
    expect(await names()).toEqual(['A1', 'B1', 'B2']);

    const leave = await api(BOB).delete(`/api/tournaments/${t.id}/members/me`);
    expect(leave.body.left).toBe(true);
    expect(await names()).toEqual(['A1']);
  });

  it('requires sign-in to join', async () => {
    const t = await tournamentService.create(ALICE, 'Club');
    expect(
      (await api().put(`/api/tournaments/${t.id}/members/me`)).status
    ).toBe(401);
  });

  it('lists the tournaments a user created or joined', async () => {
    const mine = await tournamentService.create(ALICE, 'Mine');
    const theirs = await tournamentService.create(BOB, 'Theirs');
    await tournamentService.create(CAROL, 'Not mine');
    await tournamentService.join(theirs.id, ALICE);

    const res = await api(ALICE).get('/api/tournaments');
    expect(res.status).toBe(200);
    const byName = Object.fromEntries(
      res.body.map((t: { name: string }) => [t.name, t])
    );
    expect(Object.keys(byName).sort()).toEqual(['Mine', 'Theirs']);
    expect(byName.Mine).toMatchObject({
      id: mine.id,
      isOwner: true,
      joined: true,
      memberCount: 1,
    });
    expect(byName.Theirs).toMatchObject({
      isOwner: false,
      joined: true,
      memberCount: 2,
    });
    expect((await api().get('/api/tournaments')).status).toBe(401);
  });

  it('still lists a created tournament after its creator leaves it', async () => {
    const t = await tournamentService.create(ALICE, 'Mine');
    await tournamentService.leave(t.id, ALICE);
    const res = await api(ALICE).get('/api/tournaments');
    expect(res.body).toEqual([
      expect.objectContaining({ id: t.id, isOwner: true, joined: false }),
    ]);
  });
});

describe('tournament management', () => {
  it('creates with a sanitized name and auto-joins the creator', async () => {
    const res = await api(ALICE).post('/api/tournaments', {
      name: '  Friday‮   Club  ',
    });
    expect(res.status).toBe(201);
    expect(res.body.name).toBe('Friday Club');
    expect(await tournamentService.isMember(res.body.id, ALICE)).toBe(true);
  });

  it('rejects an empty name', async () => {
    const res = await api(ALICE).post('/api/tournaments', { name: '   ' });
    expect(res.status).toBe(400);
  });

  it('caps how many tournaments one user can create', async () => {
    for (let i = 0; i < MAX_TOURNAMENTS_PER_USER; i++)
      await tournamentService.create(ALICE, `T${i}`);
    const res = await api(ALICE).post('/api/tournaments', { name: 'One more' });
    expect(res.status).toBe(409);
  });

  it('lets only the creator rename or delete', async () => {
    const t = await tournamentService.create(ALICE, 'Club');
    await tournamentService.join(t.id, BOB);

    expect(
      (await api(BOB).patch(`/api/tournaments/${t.id}`, { name: 'Mine now' }))
        .status
    ).toBe(403);
    expect((await api(BOB).delete(`/api/tournaments/${t.id}`)).status).toBe(
      403
    );

    const renamed = await api(ALICE).patch(`/api/tournaments/${t.id}`, {
      name: 'Renamed',
    });
    expect(renamed.body).toMatchObject({ name: 'Renamed', updated: true });

    const del = await api(ALICE).delete(`/api/tournaments/${t.id}`);
    expect(del.body.deleted).toBe(true);
    expect((await api().get(`/api/tournaments/${t.id}`)).status).toBe(404);
    expect(await tournamentService.memberCount(t.id)).toBe(0);
  });
});
