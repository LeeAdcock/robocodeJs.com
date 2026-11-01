// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import LeaderboardPage from '../src/page/leaderboard/leaderboardPage';

// Wire shape: every row has a sprite `color`; `own` marks the viewer's rows and
// a real `appId` rides along on own and public rows (server-authoritative). Row
// 1 is the viewer's (private), row 2 is someone else's private bot.
const rows = [
  {
    rank: 1,
    color: 'blue',
    appId: 'a1',
    own: true,
    public: false,
    name: 'Overlord',
    ownerName: 'Lee A.',
    rating: 1712,
    games: 40,
    wins: 30,
    winRate: 0.75,
  },
  {
    rank: 2,
    color: 'red',
    own: false,
    public: false,
    name: 'Skirmisher',
    ownerName: 'Dana K.',
    rating: 1655,
    games: 20,
    wins: 9,
    winRate: 0.45,
  },
];

describe('LeaderboardPage', () => {
  afterEach(cleanup);
  beforeEach(() => vi.mocked(axios.get).mockReset());

  it('fetches and renders the ranked rows with owner and rating', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: rows } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    );

    expect(axios.get).toHaveBeenCalledWith('/api/leaderboard');
    // getByText throws if the node is absent, so these assert presence.
    await screen.findByText('Overlord');
    expect(screen.getByText('Lee A.')).toBeTruthy();
    expect(screen.getByText('1712')).toBeTruthy();
    expect(screen.getByText('Skirmisher')).toBeTruthy();
    // A little tank sprite renders next to each bot, using the row's color.
    const imgs = document.querySelectorAll('img[src^="/sprites/tank_"]');
    expect(imgs.length).toBe(2);
    expect(imgs[0].getAttribute('src')).toBe('/sprites/tank_blue.png');
    expect(imgs[1].getAttribute('src')).toBe('/sprites/tank_red.png');
    // Podium markers: trophy for #1, silver for #2 (the two rows in the fixture).
    expect(screen.getByLabelText('First place').textContent).toBe('🏆');
    expect(screen.getByLabelText('Second place').textContent).toBe('🥈');
  });

  it('bolds rows for bots the viewer owns and leaves others normal', async () => {
    // Ownership is server-authoritative: the `own` flag (row 1 here), so no
    // client prop is needed.
    vi.mocked(axios.get).mockResolvedValue({ data: rows } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    );
    const ownRow = (await screen.findByText('Overlord')).closest('tr')!;
    const otherRow = screen.getByText('Skirmisher').closest('tr')!;
    expect(ownRow.style.fontWeight).toBe('700');
    expect(otherRow.style.fontWeight).toBe('400');
  });

  it('links a public bot to its read-only source and leaves private bots plain', async () => {
    // GitHub #117: a public row carries the appId its link needs; a private
    // row (even the viewer's own) has no source page to link to.
    const withPublic = [rows[0], { ...rows[1], appId: 'a2', public: true }];
    vi.mocked(axios.get).mockResolvedValue({ data: withPublic } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    );
    const link = (await screen.findByText('Skirmisher')).closest('a');
    expect(link?.getAttribute('href')).toBe('/app/a2');
    expect(screen.getByText('Overlord').closest('a')).toBeNull();
    // Public does not make a foreign row read as the viewer's own.
    expect(screen.getByText('Skirmisher').closest('tr')!.style.fontWeight).toBe(
      '400'
    );
  });

  it('renders movement: rank change plus new-and-winning, nothing otherwise', async () => {
    const moveRows = [
      { ...rows[0], rank: 1, previousRank: 3 }, // climbed two places → ▲
      { ...rows[1], rank: 2, previousRank: 2 }, // unchanged → no marker
      {
        rank: 3,
        color: 'green',
        name: 'Slipper',
        ownerName: 'Sam T.',
        rating: 1600,
        games: 15,
        wins: 6,
        winRate: 0.4,
        previousRank: 1, // dropped two places → ▼
      },
      {
        rank: 4,
        color: 'sand',
        name: 'Rookie',
        ownerName: 'Nia P.',
        rating: 1550, // new entrant above the 1500 start → ▲
        games: 3,
        wins: 2,
        winRate: 0.67,
      },
      {
        rank: 5,
        color: 'dark',
        name: 'Greenhorn',
        ownerName: 'Ola B.',
        rating: 1460, // new entrant at/below the start → no marker
        games: 2,
        wins: 0,
        winRate: 0,
      },
    ];
    vi.mocked(axios.get).mockResolvedValue({ data: moveRows } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    );
    await screen.findByText('Overlord');
    expect(
      screen.getByLabelText('Up 2 places since yesterday').textContent
    ).toBe('▲');
    expect(
      screen.getByLabelText('Down 2 places since yesterday').textContent
    ).toBe('▼');
    // New + above the starting rating gets a ▲ (already winning).
    expect(
      screen.getByLabelText(/New, already above the 1500 starting rating/)
        .textContent
    ).toBe('▲');
    // Unchanged and new-but-not-winning rows get no marker: exactly 2 ▲, 1 ▼.
    expect(screen.getAllByText('▲')).toHaveLength(2);
    expect(screen.getAllByText('▼')).toHaveLength(1);
    expect(screen.queryByText('–')).toBeNull();
  });

  it('shows an empty-state message when there are no ranked bots', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: [] } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage />
      </MemoryRouter>
    );
    await screen.findByText(/No ranked matches yet/i);
  });
});
