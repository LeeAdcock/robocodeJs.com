// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('axios', () => ({
  default: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
  },
}));
import axios from 'axios';
import ArenaRoster from '../src/components/arenaRoster';

const members = [
  {
    appId: 'a1',
    name: 'alpha',
    ownerName: 'Me',
    ownerUserId: 'u1',
    enabled: true,
    addedTimestamp: 1,
    isOwn: true,
  },
  {
    appId: 'a2',
    name: 'beta',
    ownerName: 'Bob',
    ownerUserId: 'u2',
    enabled: false,
    addedTimestamp: 2,
    isOwn: false,
  },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arena: any = { clock: { time: 0 }, apps: [{ id: 'a1' }] };

const renderRoster = () =>
  render(
    <MemoryRouter>
      <ArenaRoster
        show={true}
        onHide={() => undefined}
        userId="u1"
        arena={arena}
      />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(axios.get).mockResolvedValue({ data: members } as never);
  vi.mocked(axios.post).mockResolvedValue({ data: {} } as never);
  vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
  vi.mocked(axios.delete).mockResolvedValue({ data: {} } as never);
});
afterEach(cleanup);

describe('ArenaRoster', () => {
  it('lists members with owner labels (including a disabled one)', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());
    expect(screen.getByText('Beta')).toBeTruthy();
    // Own bot shows "you"; another user's bot shows their name.
    expect(screen.getByText('you')).toBeTruthy();
    expect(screen.getByText('Bob')).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith('/api/user/u1/arena/members');
  });

  it('toggling an enabled bot disables it via the enabled endpoint', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Disable alpha'));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        '/api/user/u1/arena/app/a1/enabled',
        { enabled: false }
      )
    );
  });

  it('toggling a disabled bot enables it', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Beta')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Enable beta'));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        '/api/user/u1/arena/app/a2/enabled',
        { enabled: true }
      )
    );
  });

  it('unlinks a bot via DELETE without touching the app', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(screen.getByLabelText('Remove alpha'));
    await waitFor(() =>
      expect(axios.delete).toHaveBeenCalledWith('/api/user/u1/arena/app/a1')
    );
  });

  it('adds an existing bot by pasted id', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const id = 'b'.repeat(36);
    fireEvent.change(screen.getByLabelText('Bot id'), {
      target: { value: id },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith(`/api/user/u1/arena/app/${id}`)
    );
  });

  it('creates a new bot (create + add) from the New bot button', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { appId: 'new1' },
    } as never);
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(screen.getByText('New bot'));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app')
    );
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith('/api/user/u1/arena/app/new1')
    );
  });
});
