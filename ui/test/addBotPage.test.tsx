// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({
  default: { get: vi.fn(), put: vi.fn() },
}));
import axios from 'axios';
import AddBotPage from '../src/page/arena/addBotPage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const user: any = { id: 'u1', name: 'Me', apps: [] };

const renderAt = (
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  props: any
) =>
  render(
    <MemoryRouter initialEntries={['/add-bot/xyz']}>
      <Routes>
        <Route path="/add-bot/:appId" element={<AddBotPage {...props} />} />
        <Route path="/" element={<div>home</div>} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(axios.get).mockResolvedValue({
    data: { name: 'shared bot' },
  } as never);
  vi.mocked(axios.put).mockResolvedValue({ data: {} } as never);
});
afterEach(cleanup);

describe('AddBotPage', () => {
  it('prompts to sign in when signed out', async () => {
    renderAt({ user: null });
    expect(await screen.findByText(/sign in/i)).toBeTruthy();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('previews the bot name and adds it on confirm', async () => {
    renderAt({ user });
    // Metadata resolved for the confirm prompt.
    await waitFor(() => expect(axios.get).toHaveBeenCalledWith('/api/app/xyz'));
    expect(await screen.findByText(/Shared Bot/i)).toBeTruthy();

    fireEvent.click(screen.getByText(/Add to my arena/i));
    await waitFor(() =>
      expect(axios.put).toHaveBeenCalledWith('/api/user/u1/arena/app/xyz')
    );
  });
});
