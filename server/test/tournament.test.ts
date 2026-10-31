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
  MAX_TOURNAMENTS_PER_USER,
} from '../src/services/TournamentService';
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
    expect(res.body.members).toEqual(['Alice A.', 'Bob B.']);
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
    expect(res.body.joined).toBe(true);
    const mine = res.body.entries.filter((e: { appId?: string }) => e.appId);
    expect(mine.map((e: { appId: string }) => e.appId)).toEqual([a1]);
  });

  it('400s a malformed id and 404s an unknown one', async () => {
    expect((await api().get('/api/tournaments/not-a-uuid')).status).toBe(400);
    expect((await api().get(`/api/tournaments/${MISSING}`)).status).toBe(404);
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
