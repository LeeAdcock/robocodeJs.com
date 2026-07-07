import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the pg pool. Services (and the domain types they build) call pool.query;
// here we feed it canned result sets and assert the row -> object mapping.
vi.mock('../src/util/db', () => ({ default: { query: vi.fn() } }));

import pool from '../src/util/db';
import appService from '../src/services/AppService';
import arenaService from '../src/services/ArenaService';
import arenaMemberService from '../src/services/ArenaMemberService';

const query = vi.mocked(pool.query);

beforeEach(() => {
  vi.clearAllMocks();
  query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
});

describe('AppService', () => {
  it('get() returns undefined when no row matches', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    expect(await appService.get('missing')).toBeUndefined();
  });

  it('get() maps a row to a App', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'Cool Bot', source: '// code' }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getId()).toBe('a1');
    expect(app?.getUserId()).toBe('u1');
    expect(app?.getName()).toBe('Cool Bot');
    expect(app?.getSource()).toBe('// code');
    // hydration must not write back to the database (only the SELECT runs)
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('getForUser() maps each row to a App', async () => {
    query.mockResolvedValue({
      rows: [
        { appId: 'a1', name: 'N1', source: 's1' },
        { appId: 'a2', name: 'N2', source: 's2' },
      ],
      rowCount: 2,
    } as never);
    const apps = await appService.getForUser('u1');
    expect(apps.map((a) => a.getId())).toEqual(['a1', 'a2']);
    expect(apps.map((a) => a.getName())).toEqual(['N1', 'N2']);
  });

  it('get() coerces a NULL source (legacy rows) to an empty string', async () => {
    query.mockResolvedValue({
      rows: [{ userId: 'u1', name: 'Cool Bot', source: null }],
      rowCount: 1,
    } as never);
    const app = await appService.get('a1');
    expect(app?.getSource()).toBe('');
  });

  it('create() inserts and returns an app owned by the user', async () => {
    const app = await appService.create('u1');
    expect(app.getUserId()).toBe('u1');
    expect(typeof app.getId()).toBe('string');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining('INSERT INTO app'),
      })
    );
  });

  it('create() inserts a non-NULL empty-string source, not NULL', async () => {
    await appService.create('u1');
    const insert = query.mock.calls.find(([arg]) =>
      (arg as { text?: string }).text?.includes('INSERT INTO app')
    );
    expect(insert).toBeDefined();
    const { text, values } = insert![0] as { text: string; values: unknown[] };
    // source is now an explicit column in the insert, and its value is '' (never NULL)
    expect(text).toContain('source');
    expect(values).toContain('');
  });
});

describe('ArenaService', () => {
  it('get() returns undefined when no row matches', async () => {
    query.mockResolvedValue({ rows: [], rowCount: 0 } as never);
    expect(await arenaService.get('missing')).toBeUndefined();
  });

  it('get() maps a row to an Arena with default dimensions', async () => {
    query.mockResolvedValue({ rows: [{ userId: 'u1' }], rowCount: 1 } as never);
    const arena = await arenaService.get('ar1');
    expect(arena?.getId()).toBe('ar1');
    expect(arena?.getUserId()).toBe('u1');
    expect(arena?.getWidth()).toBe(750);
    expect(arena?.getHeight()).toBe(750);
  });

  it('getDefaultForUser() returns the first arena for the user', async () => {
    query.mockResolvedValue({
      rows: [{ arenaId: 'ar1' }, { arenaId: 'ar2' }],
      rowCount: 2,
    } as never);
    const arena = await arenaService.getDefaultForUser('u1');
    expect(arena.getId()).toBe('ar1');
    expect(arena.getUserId()).toBe('u1');
  });
});

describe('ArenaMemberService', () => {
  it('getForApp() maps rows to members (appId, arenaId, timestamp)', async () => {
    query.mockResolvedValue({
      rows: [{ arenaId: 'ar1', createdTimestamp: 1700000000000 }],
      rowCount: 1,
    } as never);
    const [member] = await arenaMemberService.getForApp('app1');
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('ar1');
    expect(member.getTimestamp()).toBe(1700000000000);
  });

  it('getForArena() maps rows to members', async () => {
    query.mockResolvedValue({
      rows: [{ appId: 'app1', createdTimestamp: 1700000000000 }],
      rowCount: 1,
    } as never);
    const [member] = await arenaMemberService.getForArena('ar1');
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('ar1');
  });

  it('create() inserts the row and returns a member with the correct ids', async () => {
    const member = await arenaMemberService.create('arena1', 'app1');
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({ values: ['arena1', 'app1', true] })
    );
    expect(member.getAppId()).toBe('app1');
    expect(member.getArenaId()).toBe('arena1');
  });
});
