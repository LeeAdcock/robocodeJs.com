// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import MarkdownPage from '../src/page/markdownPage';

const md = [
  '[sample](/samples/lighthouse.js)',
  '[external](https://example.com/x)',
  '[types](/ts/robocode.d.ts)',
  '[internal](/dev)',
].join('\n\n');

describe('MarkdownPage', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockResolvedValue({ data: md } as never);
  });
  afterEach(cleanup);

  it('fetches and renders the requested doc', async () => {
    render(
      <MemoryRouter>
        <MarkdownPage path="examples" />
      </MemoryRouter>
    );
    await screen.findByText('sample');
    expect(axios.get).toHaveBeenCalledWith('/docs/examples.md');
  });

  it('opens sample-source and external links in a new tab, but not in-app links', async () => {
    render(
      <MemoryRouter>
        <MarkdownPage path="examples" />
      </MemoryRouter>
    );

    const sample = await screen.findByText('sample');
    const external = screen.getByText('external');
    const types = screen.getByText('types');
    const internal = screen.getByText('internal');

    expect(sample.getAttribute('target')).toBe('_blank');
    expect(sample.getAttribute('rel')).toContain('noopener');
    expect(external.getAttribute('target')).toBe('_blank');
    expect(types.getAttribute('target')).toBe('_blank');
    expect(internal.getAttribute('target')).toBeNull();
  });

  it('navigates in-app links through the router (no full reload)', async () => {
    const LocationEcho = () => (
      <div data-testid="loc">{useLocation().pathname}</div>
    );

    render(
      <MemoryRouter initialEntries={['/examples']}>
        <LocationEcho />
        <Routes>
          <Route path="*" element={<MarkdownPage path="examples" />} />
        </Routes>
      </MemoryRouter>
    );

    const internal = await screen.findByText('internal');
    expect(internal.tagName).toBe('A');
    expect(internal.getAttribute('href')).toBe('/dev');

    // A client-side navigation updates the router location in place. A plain
    // <a> reload would never change MemoryRouter's location, so this confirms
    // the link is a router <Link>.
    fireEvent.click(internal);
    expect(screen.getByTestId('loc').textContent).toBe('/dev');
  });
});
