import { describe, it, expect, vi, beforeAll } from 'vitest';

// AdminService (GitHub #469) against a real pg-mem database, not a mocked pool:
// what matters is that its SQL actually runs on the dev/test engine (no FILTER,
// window functions or length()) and that the aggregates come out right. The
// tables mirror the services' own DDL, trimmed to the columns read here, except
// ranked_match, which RankedMatchService creates itself on import.
vi.mock('../src/util/db', async () => {
  const { newDb } = await import('pg-mem');
  const { Pool } = newDb().adapters.createPg();
  return { default: new Pool() };
});

import pool from '../src/util/db';
import adminService from '../src/services/AdminService';
import rankedMatchService from '../src/services/RankedMatchService';
import { DEMO_USER_ID } from '../src/types/user';
import { STARTER_BOTS } from '../src/util/starterBots';

const NOW = new Date('2026-10-31T12:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const ALICE = '11111111-1111-1111-1111-111111111111';
const BOB = '22222222-2222-2222-2222-222222222222';
const ALICE_ARENA = 'aaaaaaaa-0000-0000-0000-000000000001';
const app = (n: number) => `bbbbbbbb-0000-0000-0000-00000000000${n}`;

beforeAll(async () => {
  await pool.query(`
    CREATE TABLE account (id UUID PRIMARY KEY, name text, picture text, email text,
      lastActiveAt timestamp, createdTimestamp timestamp default CURRENT_TIMESTAMP);
    CREATE TABLE app (id UUID PRIMARY KEY, userId UUID, source text default '', name text,
      deleted boolean default false, rating real default 1500, ratingGames integer default 0,
      ratingWins integer default 0, broken boolean default false,
      createdTimestamp timestamp default CURRENT_TIMESTAMP, updatedTimestamp timestamp default CURRENT_TIMESTAMP);
    CREATE TABLE arena (id UUID PRIMARY KEY, userId UUID, createdTimestamp timestamp default CURRENT_TIMESTAMP);
    CREATE TABLE arena_member (arenaId UUID, appId UUID, enabled BOOLEAN NOT NULL DEFAULT true,
      PRIMARY KEY (arenaId, appId));
    CREATE TABLE identity (userId UUID, source text, sourceId text,
      createdTimestamp timestamp default CURRENT_TIMESTAMP, PRIMARY KEY (source, sourceId));
    CREATE TABLE oauth_client (clientId text PRIMARY KEY, info text);
    CREATE TABLE oauth_token (tokenHash text PRIMARY KEY, userId UUID, clientId text, kind text,
      expiresAt bigint, createdTimestamp timestamp default CURRENT_TIMESTAMP);
    CREATE TABLE achievement (userId UUID, achievementId text, appId UUID,
      unlockedTimestamp timestamp default CURRENT_TIMESTAMP, PRIMARY KEY (userId, achievementId));
    CREATE TABLE user_counter (userId UUID, counter text, value bigint default 0, PRIMARY KEY (userId, counter));
  `);

  const q = (text: string, values: unknown[]) => pool.query({ text, values });
  // Alice: active, edited one app; Bob: signed up yesterday, starters only.
  await q(
    'INSERT INTO account(id, name, email, lastActiveAt, createdTimestamp) VALUES ($1,$2,$3,$4,$5)',
    [ALICE, 'Alice', 'alice@x', daysAgo(0.5), daysAgo(20)]
  );
  await q(
    'INSERT INTO account(id, name, email, lastActiveAt, createdTimestamp) VALUES ($1,$2,$3,$4,$5)',
    [BOB, 'Bob', 'bob@x', null, daysAgo(1.5)]
  );
  await q('INSERT INTO account(id, name, createdTimestamp) VALUES ($1,$2,$3)', [
    DEMO_USER_ID,
    'Demo',
    daysAgo(0.1),
  ]);

  const starter = STARTER_BOTS[0].source;
  await q(
    'INSERT INTO app(id, userId, name, source, updatedTimestamp, broken) VALUES ($1,$2,$3,$4,$5,$6)',
    [app(1), ALICE, 'Mine', '// my code', daysAgo(2), true]
  );
  await q(
    'INSERT INTO app(id, userId, name, source, updatedTimestamp) VALUES ($1,$2,$3,$4,$5)',
    [app(2), ALICE, 'Seed', starter, daysAgo(20)]
  );
  await q(
    'INSERT INTO app(id, userId, name, source, deleted) VALUES ($1,$2,$3,$4,true)',
    [app(3), ALICE, 'Gone', '// x']
  );
  await q(
    'INSERT INTO app(id, userId, name, source, updatedTimestamp) VALUES ($1,$2,$3,$4,$5)',
    [app(4), BOB, 'Seed', starter, daysAgo(1.5)]
  );
  await q('INSERT INTO app(id, userId, name, source) VALUES ($1,$2,$3,$4)', [
    app(5),
    DEMO_USER_ID,
    'Demo',
    '// demo',
  ]);

  await q('INSERT INTO arena(id, userId) VALUES ($1,$2)', [ALICE_ARENA, ALICE]);
  await q(
    'INSERT INTO arena_member(arenaId, appId, enabled) VALUES ($1,$2,true),($1,$3,false)',
    [ALICE_ARENA, app(1), app(2)]
  );
  await q('INSERT INTO identity(userId, source, sourceId) VALUES ($1,$2,$3)', [
    ALICE,
    'google',
    'g-alice',
  ]);
  await q('INSERT INTO oauth_client(clientId, info) VALUES ($1,$2)', [
    'c1',
    JSON.stringify({ client_name: 'VS Code', client_secret: 'shh' }),
  ]);
  const future = NOW.getTime() + 86_400_000;
  await q(
    'INSERT INTO oauth_token(tokenHash, userId, clientId, kind, expiresAt) VALUES ($1,$2,$3,$4,$5)',
    ['h1', ALICE, 'c1', 'refresh', future]
  );
  await q(
    'INSERT INTO oauth_token(tokenHash, userId, clientId, kind, expiresAt) VALUES ($1,$2,$3,$4,$5)',
    ['h2', ALICE, 'c1', 'access', future]
  );
  await q(
    'INSERT INTO oauth_token(tokenHash, userId, clientId, kind, expiresAt) VALUES ($1,$2,$3,$4,$5)',
    ['h3', BOB, 'c1', 'refresh', NOW.getTime() - 1]
  );
  await q('INSERT INTO achievement(userId, achievementId) VALUES ($1,$2)', [
    ALICE,
    'first-blood',
  ]);
  await q(
    'INSERT INTO user_counter(userId, counter, value) VALUES ($1,$2,$3)',
    [ALICE, 'kills', 7]
  );
});

describe('AdminService (pg-mem)', () => {
  it('overview counts people, not the demo account', async () => {
    const o = await adminService.overview(NOW);
    expect(o.users).toEqual({
      total: 2,
      signups: { day: 0, week: 1, month: 2 },
      active: { day: 1, week: 1, month: 1 },
    });
    expect(o.apps).toEqual({ total: 3, updatedWeek: 2 });
    expect(o.arenas).toEqual({ total: 1 });
    // Only Alice holds a live refresh token; Bob's has expired.
    expect(o.mcp).toEqual({ users: 1 });
  });

  it('users() folds per-user aggregates, telling edited apps from starters', async () => {
    const users = await adminService.users(NOW);
    const byId = Object.fromEntries(users.map((u) => [u.id, u]));
    expect(Object.keys(byId).sort()).toEqual([ALICE, BOB]);
    expect(byId[ALICE]).toEqual(
      expect.objectContaining({
        apps: 2,
        editedApps: 1,
        arenas: 1,
        mcpClients: 1,
        email: 'alice@x',
      })
    );
    expect(byId[BOB]).toEqual(
      expect.objectContaining({
        apps: 1,
        editedApps: 0,
        arenas: 0,
        mcpClients: 0,
        lastActiveAt: null,
      })
    );
  });

  it('userDetail() returns metadata only: no source, token hash or client secret', async () => {
    const d = await adminService.userDetail(ALICE, NOW);
    expect(d).toBeDefined();
    expect(d!.apps.map((a) => [a.name, a.starter, a.broken]).sort()).toEqual([
      ['Mine', false, true],
      ['Seed', true, false],
    ]);
    expect(d!.arenas).toEqual([
      expect.objectContaining({
        id: ALICE_ARENA,
        members: 2,
        enabledMembers: 1,
      }),
    ]);
    expect(d!.identities.map((i) => i.source)).toEqual(['google']);
    expect(d!.achievements.map((a) => a.id)).toEqual(['first-blood']);
    expect(d!.counters).toEqual({ kills: 7 });
    expect(d!.tokens.map((t) => [t.clientName, t.kind]).sort()).toEqual([
      ['VS Code', 'access'],
      ['VS Code', 'refresh'],
    ]);

    const json = JSON.stringify(d);
    expect(json).not.toContain('// my code');
    expect(json).not.toContain(STARTER_BOTS[0].source.slice(0, 40));
    expect(json).not.toContain('shh');
    expect(json).not.toContain('"h1"');
  });

  it('userDetail() is undefined for an unknown user or the demo account', async () => {
    expect(
      await adminService.userDetail('99999999-9999-9999-9999-999999999999', NOW)
    ).toBeUndefined();
    expect(await adminService.userDetail(DEMO_USER_ID, NOW)).toBeUndefined();
  });

  it('signupsByDay() zero-fills UTC days, oldest first', async () => {
    const days = await adminService.signupsByDay(3, NOW);
    expect(days).toEqual([
      { date: '2026-10-29', count: 0 },
      { date: '2026-10-30', count: 1 }, // Bob, 1.5 days before noon on the 31st
      { date: '2026-10-31', count: 0 },
    ]);
  });

  it('ladderApps() lists live non-demo apps with eligibility inputs', async () => {
    const apps = await adminService.ladderApps();
    const byName = Object.fromEntries(
      apps.map((a) => [`${a.ownerName}/${a.name}`, a])
    );
    expect(Object.keys(byName).sort()).toEqual([
      'Alice/Mine',
      'Alice/Seed',
      'Bob/Seed',
    ]);
    expect(byName['Alice/Mine']).toEqual(
      expect.objectContaining({ broken: true, starter: false, empty: false })
    );
    expect(byName['Bob/Seed']).toEqual(
      expect.objectContaining({ starter: true })
    );
    // Bob was never active, so his signup stands in for activity.
    expect(byName['Bob/Seed'].ownerActiveAt).toBe(daysAgo(1.5).toISOString());
    expect(JSON.stringify(apps)).not.toContain('// my code');
  });

  it('outcomesSince() tells unrated matches from rated wins and draws', async () => {
    const m = (n: number) => `cccccccc-0000-0000-0000-00000000000${n}`;
    const ins = (
      id: string,
      winner: string | null,
      dA: number,
      dB: number,
      at: Date
    ) =>
      pool.query({
        text: 'INSERT INTO ranked_match(id, appA, appB, winnerId, deltaA, deltaB, createdTimestamp) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        values: [id, app(1), app(4), winner, dA, dB, at],
      });
    await ins(m(1), app(1), 12, -12, daysAgo(0.01)); // rated win
    await ins(m(2), null, 3, -3, daysAgo(0.02)); // rated draw (ratings moved)
    await ins(m(3), null, 0, 0, daysAgo(0.03)); // unrated (timeout)
    await ins(m(4), null, 0, 0, daysAgo(3)); // outside the window

    expect(await rankedMatchService.outcomesSince(daysAgo(1))).toEqual({
      total: 3,
      unrated: 1,
    });
    expect(await rankedMatchService.outcomesSince(NOW)).toEqual({
      total: 0,
      unrated: 0,
    });
  });
});
