// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({
  default: { get: vi.fn(), put: vi.fn(), post: vi.fn(), delete: vi.fn() },
}));
// The Ace editor is heavy/DOM-hungry; stub it so we test the page's wiring
// (loading source, rendering the editor + toolbar) rather than Ace itself.
vi.mock('../src/page/app/appEditor', () => ({
  default: (props: { code: string }) => (
    <textarea data-testid="editor" defaultValue={props.code} />
  ),
}));
import axios from 'axios';
import AppPage from '../src/page/app/appPage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const emitter = { addListener: vi.fn(), removeListener: vi.fn() } as any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const arena = { clock: { time: 0 }, apps: [] } as any;

describe('AppPage (bot editor)', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockImplementation((url: string) =>
      url.endsWith('/source')
        ? (Promise.resolve({ data: 'bot.setName("x")' }) as never)
        : (Promise.resolve({ data: { id: 'a1', name: 'My Bot' } }) as never)
    );
  });
  afterEach(cleanup);

  it('mounts, loads the bot source, and renders the editor', async () => {
    render(
      <MemoryRouter initialEntries={['/user/u1/app/a1']}>
        <Routes>
          <Route
            path="/user/:userId/app/:appId"
            element={
              <AppPage
                arena={arena}
                doDelete={() => undefined}
                emitter={emitter}
              />
            }
          />
        </Routes>
      </MemoryRouter>
    );

    const editor = (await screen.findByTestId('editor')) as HTMLTextAreaElement;
    expect(editor).toBeTruthy();
    expect(axios.get).toHaveBeenCalledWith('/api/user/u1/app/a1/source');
  });
});
