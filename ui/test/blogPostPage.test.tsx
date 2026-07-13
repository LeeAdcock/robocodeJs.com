// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

vi.mock('axios', () => ({ default: { get: vi.fn() } }));
import axios from 'axios';
import BlogPostPage from '../src/page/blogPostPage';

// The /blog/:slug route maps to the markdown file blog/<slug>.md, gated on the
// blogPosts manifest so future-dated posts stay hidden until their date.
describe('BlogPostPage', () => {
  beforeEach(() => {
    vi.mocked(axios.get).mockResolvedValue({ data: '# Post' } as never);
  });
  afterEach(() => {
    cleanup();
    vi.mocked(axios.get).mockClear();
  });

  const renderAt = (slug: string, now: Date) =>
    render(
      <MemoryRouter initialEntries={[`/blog/${slug}`]}>
        <Routes>
          <Route path="/blog/:slug" element={<BlogPostPage now={now} />} />
        </Routes>
      </MemoryRouter>
    );

  it('loads the markdown file for a published post', async () => {
    // 'stationary-bots-die' is dated 2024-01-16; view it well afterwards.
    renderAt('stationary-bots-die', new Date(2025, 0, 1));
    await screen.findByText('Post');
    expect(axios.get).toHaveBeenCalledWith('/docs/blog/stationary-bots-die.md');
  });

  it('hides a future-dated post and names its publish date', () => {
    // 'launching-global-rankings' is dated 2026-07-12; view it a year early.
    renderAt('launching-global-rankings', new Date(2025, 6, 12));
    expect(
      screen.getByText(/isn't published yet. Check back on July 12, 2026/)
    ).toBeTruthy();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('shows a not-found notice for an unknown slug', () => {
    renderAt('no-such-post', new Date(2100, 0, 1));
    expect(screen.getByText("There's no post here.")).toBeTruthy();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('sets the tab title for a published post', () => {
    renderAt('stationary-bots-die', new Date(2025, 0, 1));
    expect(document.title).toBe('RobocodeJs | Blog | Stationary bots die');
  });

  it('falls back to the blog title for an unpublished post', () => {
    renderAt('launching-global-rankings', new Date(2025, 6, 12));
    expect(document.title).toBe('RobocodeJs | Blog');
  });
});
