// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import AdminPage from '../src/page/admin/adminPage';
import NavBar from '../src/components/navbar';
import { fetchIsAdmin, timeAgo } from '../src/util/admin';

// The admin panel (GitHub #469). The server never tells a non-admin "no": it
// answers /api/admin/* like an unknown path, i.e. with the SPA's HTML shell and
// a 200. So the property that matters most here is that the UI treats anything
// but the admin API's JSON as "not an admin" and shows the ordinary not-found
// page.

const SHELL = '<!doctype html><html><body><div id="root"></div></body></html>';
const NOW = Date.now();
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const OVERVIEW = {
  instance: {
    hostname: 'ip-10-0-0-1',
    version: '1.2.143',
    uptimeSec: 7200,
    node: 'v24.1.0',
  },
  metrics: {
    arenas: 3,
    runningArenas: 2,
    idlePausedArenas: 1,
    isolates: 9,
    maxAvgTickMs: 2.5,
    rssMB: 300,
    heapUsedMB: 120,
  },
  counts: {
    users: {
      total: 42,
      signups: { day: 1, week: 4, month: 9 },
      active: { day: 7, week: 15, month: 30 },
    },
    apps: { total: 120, updatedWeek: 11 },
    arenas: { total: 50 },
    mcp: { users: 5 },
  },
  ladder: { enabled: true, loopRunning: true, matchesDay: 200, unratedDay: 10 },
};

const USER_ROW = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Ada Lovelace',
  email: 'ada@example.com',
  picture: null,
  createdTimestamp: ago(30 * 86400_000),
  lastActiveAt: ago(3600_000),
  apps: 4,
  editedApps: 2,
  lastAppEdit: null,
  arenas: 1,
  mcpClients: 1,
};

const USERS = {
  total: 1,
  offset: 0,
  limit: 50,
  users: [USER_ROW],
  limits: { appsPerUser: 20, arenasPerUser: 10 },
};

const DETAIL = {
  account: USER_ROW,
  identities: [{ source: 'google', createdTimestamp: ago(1000) }],
  apps: [
    {
      id: 'a1',
      name: 'Crusher',
      createdTimestamp: ago(1000),
      updatedTimestamp: ago(1000),
      rating: 1620,
      ratingGames: 30,
      ratingWins: 20,
      broken: true,
      starter: false,
      empty: false,
    },
  ],
  arenas: [
    {
      id: 'aaaaaaaa-0000-0000-0000-000000000001',
      createdTimestamp: ago(1000),
      members: 3,
      enabledMembers: 2,
    },
  ],
  achievements: [{ id: 'first-kill', unlockedTimestamp: ago(1000) }],
  counters: { kills: 12 },
  tokens: [
    {
      clientName: 'VS Code',
      kind: 'refresh',
      createdTimestamp: ago(1000),
      expiresAt: ago(-86400_000),
    },
  ],
};

const LADDER = {
  instance: OVERVIEW.instance,
  enabled: true,
  loopRunning: false,
  config: {
    concurrency: 1,
    matchIntervalMs: 30000,
    idleMs: 60000,
    maxLiveIsolates: 40,
    timeoutMs: 120000,
    matchSpeed: 20,
    retentionDays: 90,
    pairMatchCap: 10,
  },
  throughput: {
    hour: { total: 4, unrated: 1 },
    day: { total: 80, unrated: 8 },
  },
  pool: [
    {
      appId: 'a',
      name: 'Alpha',
      ownerName: 'Ann',
      rating: 1700,
      games: 40,
      wins: 30,
      updatedTimestamp: ago(1000),
    },
    {
      appId: 'b',
      name: 'Beta',
      ownerName: 'Ben',
      rating: 1500,
      games: 40,
      wins: 10,
      updatedTimestamp: ago(1000),
    },
  ],
  pairs: [{ appA: 'a', appB: 'b', matches: 10, saturated: true }],
  pairSummary: { total: 1, saturated: 1, open: 0 },
  claims: [{ appId: 'a', name: 'Alpha', ownerName: 'Ann' }],
  broken: [{ appId: 'c', name: 'Crashy', ownerName: 'Cy' }],
  ineligible: {
    total: 3,
    reasons: { broken: 1, starter: 2 },
    apps: [
      {
        appId: 'c',
        name: 'Crashy',
        ownerName: 'Cy',
        updatedTimestamp: ago(1000),
        reasons: ['broken'],
      },
    ],
  },
};

const get = vi.mocked(axios.get);

// Route each admin endpoint to a fixture; `admin` decides what /me returns.
const serve = (admin: 'json' | 'shell' | 'error') =>
  get.mockImplementation((async (url: string) => {
    if (url === '/api/admin/me') {
      if (admin === 'error') throw new Error('network');
      return { data: admin === 'json' ? { admin: true } : SHELL };
    }
    if (url === '/api/admin/overview') return { data: OVERVIEW };
    if (url === '/api/admin/users') return { data: USERS };
    if (url === '/api/admin/signups')
      return {
        data: {
          days: [
            { date: '2026-10-30', count: 2 },
            { date: '2026-10-31', count: 0 },
          ],
        },
      };
    if (url.startsWith('/api/admin/users/')) return { data: DETAIL };
    if (url === '/api/admin/ladder') return { data: LADDER };
    throw new Error(`unexpected ${url}`);
  }) as never);

let location = '';
function LocationProbe() {
  location = useLocation().search;
  return null;
}

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/admin"
          element={
            <>
              <AdminPage />
              <LocationProbe />
            </>
          }
        />
      </Routes>
    </MemoryRouter>
  );

// Braces matter: vitest runs a function returned from beforeEach as teardown,
// and mockReset() returns the mock itself.
beforeEach(() => {
  get.mockReset();
});
afterEach(cleanup);

describe('AdminPage gate', () => {
  it('shows the ordinary not-found page when the server answers with the HTML shell', async () => {
    serve('shell');
    renderAt('/admin');
    expect(await screen.findByText('Page not found')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
    // No admin data is requested by a non-admin.
    expect(get.mock.calls.map((c) => c[0])).toEqual(['/api/admin/me']);
  });

  it('shows not-found when the probe fails outright', async () => {
    serve('error');
    renderAt('/admin');
    expect(await screen.findByText('Page not found')).toBeTruthy();
  });

  it('renders nothing while still checking, so the panel never flashes', () => {
    get.mockReturnValue(new Promise(() => undefined) as never);
    const { container } = renderAt('/admin');
    expect(container.textContent).toBe('');
  });

  it('fetchIsAdmin only accepts the admin API’s JSON', async () => {
    get.mockResolvedValueOnce({ data: SHELL } as never);
    expect(await fetchIsAdmin()).toBe(false);
    get.mockResolvedValueOnce({ data: { admin: 'yes' } } as never);
    expect(await fetchIsAdmin()).toBe(false);
    get.mockResolvedValueOnce({ data: { admin: true } } as never);
    expect(await fetchIsAdmin()).toBe(true);
  });
});

describe('AdminPage tabs', () => {
  it('opens on the overview, labelling the live gauges with their instance', async () => {
    serve('json');
    renderAt('/admin');
    expect(await screen.findByText('42')).toBeTruthy(); // users
    expect(
      screen.getByText('Users', { selector: '.admin-tile-label' })
    ).toBeTruthy();
    expect(screen.getByText('ip-10-0-0-1')).toBeTruthy();
    expect(screen.getByText('5% unrated')).toBeTruthy();
  });

  it('switches tabs through the URL', async () => {
    serve('json');
    renderAt('/admin');
    await screen.findByText('42');
    fireEvent.click(screen.getByRole('button', { name: 'Ladder' }));
    expect(await screen.findByText('Eligible pool')).toBeTruthy();
    expect(location).toBe('?tab=ladder');
  });

  it('lists users, filters through the query, and opens a user’s detail', async () => {
    serve('json');
    renderAt('/admin?tab=users');
    expect(await screen.findByText('Ada Lovelace')).toBeTruthy();
    expect(screen.getByText('2 / 4')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Dormant' }));
    await waitFor(() =>
      expect(get).toHaveBeenCalledWith('/api/admin/users', {
        params: expect.objectContaining({ filter: 'dormant', offset: 0 }),
      })
    );
    expect(location).toContain('filter=dormant');

    fireEvent.click(screen.getByText('Ada Lovelace'));
    expect(await screen.findByText('Crusher')).toBeTruthy();
    expect(screen.getByText('broken')).toBeTruthy();
    expect(screen.getByText('VS Code')).toBeTruthy();
    expect(
      screen.getByText('Source is never shown here.', { exact: false })
    ).toBeTruthy();
    expect(get).toHaveBeenCalledWith(`/api/admin/users/${USER_ROW.id}`, {
      params: undefined,
    });
    expect(
      screen.getByRole('link', { name: 'Watch' }).getAttribute('href')
    ).toBe('/watch/aaaaaaaa-0000-0000-0000-000000000001');

    fireEvent.click(screen.getByRole('button', { name: '← All users' }));
    expect(await screen.findByText('Accounts')).toBeTruthy();
  });

  it('renders the signups chart with a table fallback', async () => {
    serve('json');
    renderAt('/admin?tab=users');
    expect(
      await screen.findByRole('img', {
        name: /Signups per day, 2 over the last 2 days/,
      })
    ).toBeTruthy();
    expect(screen.getByText('Show as table')).toBeTruthy();
  });

  it('shows ladder saturation, claims and ineligibility reasons', async () => {
    serve('json');
    renderAt('/admin?tab=ladder');
    expect(await screen.findByText('10 ✓')).toBeTruthy();
    expect(screen.getByText('in a match')).toBeTruthy();
    expect(screen.getByText('Untouched starter')).toBeTruthy();
    expect(
      screen.getAllByText('Broken (crashed in a ranked match)').length
    ).toBeGreaterThan(0);
    expect(screen.getByText('stopped')).toBeTruthy();
  });
});

describe('NavBar admin link', () => {
  const baseProps: any = {
    apps: [],
    user: { id: 'u1', name: 'Ada', picture: '', email: '', apps: [] },
    arena: { clock: { time: 0 }, apps: [] },
    isPaused: true,
    doPause: () => undefined,
    doResume: () => undefined,
    doRestart: () => undefined,
    doSave: () => undefined,
    doCreateApp: () => undefined,
  };
  const open = () =>
    fireEvent.click(document.getElementById('user-nav-dropdown')!);

  it('appears once the server confirms an admin', async () => {
    serve('json');
    render(
      <MemoryRouter>
        <NavBar {...baseProps} />
      </MemoryRouter>
    );
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/admin/me'));
    open();
    expect(await screen.findByText('Admin')).toBeTruthy();
  });

  it('stays hidden for a non-admin', async () => {
    serve('shell');
    render(
      <MemoryRouter>
        <NavBar {...baseProps} />
      </MemoryRouter>
    );
    await waitFor(() => expect(get).toHaveBeenCalledWith('/api/admin/me'));
    open();
    expect(await screen.findByText('Your badges')).toBeTruthy();
    expect(screen.queryByText('Admin')).toBeNull();
  });

  it('never probes while signed out', () => {
    serve('json');
    render(
      <MemoryRouter>
        <NavBar {...baseProps} user={null} />
      </MemoryRouter>
    );
    expect(get).not.toHaveBeenCalledWith('/api/admin/me');
  });
});

describe('timeAgo', () => {
  it('reads naturally across scales', () => {
    const now = Date.parse('2026-10-31T12:00:00Z');
    expect(timeAgo(null, now)).toBe('never');
    expect(timeAgo('2026-10-31T11:59:30Z', now)).toBe('just now');
    expect(timeAgo('2026-10-31T11:45:00Z', now)).toBe('15 min ago');
    expect(timeAgo('2026-10-30T12:00:00Z', now)).toBe('24 h ago');
    expect(timeAgo('2026-10-21T12:00:00Z', now)).toBe('10 d ago');
    expect(timeAgo('2026-01-31T12:00:00Z', now)).toBe('9 mo ago');
  });
});
