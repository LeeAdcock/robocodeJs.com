// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import NavBar from '../src/components/navbar';
import { getDarkMode, setDarkMode } from '../src/util/theme';

const noop = () => undefined;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const baseProps: any = {
  apps: [],
  user: null,
  arena: { clock: { time: 0 }, apps: [] },
  isPaused: true,
  doPause: noop,
  doResume: noop,
  doRestart: noop,
  doSave: noop,
  doCreateApp: noop,
};

describe('NavBar night-mode toggle', () => {
  beforeEach(() => {
    localStorage.clear();
    setDarkMode(false);
  });
  afterEach(cleanup);

  it('flips the theme from the header and reflects the new state', () => {
    render(
      <MemoryRouter>
        <NavBar {...baseProps} />
      </MemoryRouter>
    );

    const toggle = screen.getByLabelText('Switch to night mode');
    expect(getDarkMode()).toBe(false);

    fireEvent.click(toggle);
    expect(getDarkMode()).toBe(true);
    // The control now offers the inverse action.
    expect(screen.getByLabelText('Switch to light mode')).toBeTruthy();
  });
});

describe('NavBar collapsed menu', () => {
  afterEach(cleanup);

  // Regression: on a phone the collapsed (hamburger) menu used to stay open
  // after tapping a link, covering the page you just navigated to. The menu is
  // now controlled and a useLocation effect closes it on every route change.
  it('closes the open menu when navigation changes the route', async () => {
    const Harness = () => {
      const navigate = useNavigate();
      return (
        <>
          <NavBar {...baseProps} />
          <button onClick={() => navigate('/examples')}>go</button>
        </>
      );
    };
    render(
      <MemoryRouter initialEntries={['/']}>
        <Harness />
      </MemoryRouter>
    );

    const toggle = screen.getByRole('button', { name: /toggle navigation/i });
    // react-bootstrap reflects the collapsed state as a `collapsed` class on the
    // toggle button (present when closed, removed when open).
    const isOpen = () => !toggle.classList.contains('collapsed');
    expect(isOpen()).toBe(false);

    // Open the hamburger menu.
    fireEvent.click(toggle);
    expect(isOpen()).toBe(true);

    // Navigating to a new route should collapse it again.
    fireEvent.click(screen.getByText('go'));
    await waitFor(() => expect(isOpen()).toBe(false));
  });
});

describe('NavBar search', () => {
  afterEach(cleanup);

  it('clears the query and drops focus after navigating', async () => {
    vi.mocked(axios.get).mockResolvedValueOnce({
      data: { answer: '/examples' },
    } as never);
    render(
      <MemoryRouter>
        <NavBar {...baseProps} />
      </MemoryRouter>
    );

    const search = screen.getByLabelText('Search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'how do I fire' } });
    search.focus();
    expect(search.value).toBe('how do I fire');

    fireEvent.keyDown(search, { key: 'Enter' });

    // Once the answer resolves and we navigate, the box empties and blurs.
    await waitFor(() => expect(search.value).toBe(''));
    expect(document.activeElement).not.toBe(search);
  });
});
