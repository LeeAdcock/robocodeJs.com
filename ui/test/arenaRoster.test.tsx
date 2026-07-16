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

// Route GET mocks by URL: the roster (members), the user's own apps (the
// one-click pick-list), and the single-app metadata lookup the add-by-id preview
// uses. Defaults: the two members, and no own apps offered.
const setApi = (opts: { members?: unknown[]; apps?: unknown[] } = {}) =>
  vi.mocked(axios.get).mockImplementation((url: string) => {
    if (url.endsWith('/arena/members'))
      return Promise.resolve({ data: opts.members ?? members } as never);
    if (url.endsWith('/apps'))
      return Promise.resolve({ data: opts.apps ?? [] } as never);
    return Promise.resolve({ data: {} } as never); // /api/app/:id preview
  });

beforeEach(() => {
  vi.clearAllMocks();
  setApi();
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

  it('renders in a stable order (add-time, then appId) regardless of server order', async () => {
    // Same addedTimestamp (a tie) and returned out of appId order — the roster
    // must still render deterministically so toggles never reshuffle.
    const tied = [
      { ...members[1], appId: 'z9', name: 'zeta', addedTimestamp: 5 },
      { ...members[0], appId: 'a0', name: 'alpha', addedTimestamp: 5 },
    ];
    setApi({ members: tied });
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const names = screen.getAllByText(/Alpha|Zeta/).map((el) => el.textContent);
    expect(names).toEqual(['Alpha', 'Zeta']);
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

    fireEvent.click(screen.getByLabelText('Unlink alpha from the arena'));
    await waitFor(() =>
      expect(axios.delete).toHaveBeenCalledWith('/api/user/u1/arena/app/a1')
    );
  });

  it('adds an existing app by pasted id', async () => {
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    const id = 'b'.repeat(36);
    fireEvent.change(screen.getByLabelText('App id'), {
      target: { value: id },
    });
    fireEvent.click(screen.getByText('Add'));
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith(`/api/user/u1/arena/app/${id}`)
    );
  });

  it('offers your own apps not already in the arena and adds one on click', async () => {
    // a1 is already in the arena (a member); a3 is not.
    setApi({
      apps: [
        { id: 'a1', name: 'alpha' },
        { id: 'a3', name: 'gamma' },
      ],
    });
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    expect(axios.get).toHaveBeenCalledWith('/api/user/u1/apps');
    // gamma (not a member) is offered; alpha (already a member) is not re-offered.
    const addGamma = await screen.findByLabelText('Add gamma to the arena');
    expect(screen.queryByLabelText('Add alpha to the arena')).toBeNull();

    fireEvent.click(addGamma);
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith('/api/user/u1/arena/app/a3')
    );
  });

  it('creates a new app (create + add) from the New app button', async () => {
    vi.mocked(axios.post).mockResolvedValueOnce({
      data: { appId: 'new1' },
    } as never);
    renderRoster();
    await waitFor(() => expect(screen.getByText('Alpha')).toBeTruthy());

    fireEvent.click(screen.getByText('New app'));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith('/api/user/u1/app')
    );
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith('/api/user/u1/arena/app/new1')
    );
  });
});
