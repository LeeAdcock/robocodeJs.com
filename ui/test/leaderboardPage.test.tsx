// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import LeaderboardPage from '../src/page/leaderboard/leaderboardPage';

const rows = [
  {
    rank: 1,
    appId: 'a1',
    name: 'Overlord',
    ownerName: 'Lee A.',
    rating: 1712,
    games: 40,
    wins: 30,
    winRate: 0.75,
  },
  {
    rank: 2,
    appId: 'a2',
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

  it('fetches and renders the ranked rows with owner and win%', async () => {
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
    expect(screen.getByText('75%')).toBeTruthy(); // winRate rounded
    expect(screen.getByText('Skirmisher')).toBeTruthy();
    // A little tank sprite renders next to each bot.
    const imgs = document.querySelectorAll('img[src^="/sprites/tank_"]');
    expect(imgs.length).toBe(2);
    // Podium markers: trophy for #1, silver for #2 (the two rows in the fixture).
    expect(screen.getByLabelText('First place').textContent).toBe('🏆');
    expect(screen.getByLabelText('Second place').textContent).toBe('🥈');
  });

  it('bolds rows for bots the viewer owns and leaves others normal', async () => {
    vi.mocked(axios.get).mockResolvedValue({ data: rows } as never);
    render(
      <MemoryRouter>
        <LeaderboardPage ownAppIds={new Set(['a1'])} />
      </MemoryRouter>
    );
    const ownRow = (await screen.findByText('Overlord')).closest('tr')!;
    const otherRow = screen.getByText('Skirmisher').closest('tr')!;
    expect(ownRow.style.fontWeight).toBe('700');
    expect(otherRow.style.fontWeight).toBe('400');
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
