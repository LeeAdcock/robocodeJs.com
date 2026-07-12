// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

import BlogIndexPage from '../src/page/blogIndexPage';
import { BLOG_POSTS, publishedPosts, toISODate } from '../src/page/blogPosts';

// The /blog index is driven by the blogPosts manifest and only shows posts
// whose date has arrived, so future-dated posts can be deployed early and
// appear on schedule.
describe('BlogIndexPage', () => {
  afterEach(cleanup);

  const renderAt = (now: Date) =>
    render(
      <MemoryRouter>
        <BlogIndexPage now={now} />
      </MemoryRouter>
    );

  it('shows published posts and hides future-dated ones', () => {
    // Pick a date in the middle of the archive: mid-2025.
    renderAt(new Date(2025, 5, 1));

    // Published well before then:
    expect(screen.getByText('Stationary bots die')).toBeTruthy();
    // Dated 2025-03-11, so published:
    expect(screen.getByText('Watching a battle, live')).toBeTruthy();
    // Dated 2025-07-08 — still in the future, must be hidden:
    expect(screen.queryByText('Why won’t my bot shoot?')).toBeNull();
    // And so must the scheduled 2026/2027 posts:
    expect(screen.queryByText('Every bot now has a number')).toBeNull();
    expect(screen.queryByText('One brain, five tanks')).toBeNull();
  });

  it('reveals a post on its exact date', () => {
    // 2025-07-08 is the post's own date — it should be visible that day.
    renderAt(new Date(2025, 6, 8));
    expect(screen.getByText('Why won’t my bot shoot?')).toBeTruthy();
  });

  it('links each visible post to its /blog/<slug> page', () => {
    renderAt(new Date(2100, 0, 1)); // far future: everything is visible
    const link = screen.getByText('Every bot now has a number').closest('a');
    expect(link?.getAttribute('href')).toBe('/blog/launching-global-rankings');
  });

  it('shows the whole archive once every date has passed', () => {
    renderAt(new Date(2100, 0, 1));
    for (const post of BLOG_POSTS) {
      expect(screen.getByText(post.title)).toBeTruthy();
    }
  });
});

describe('publishedPosts', () => {
  it('is inclusive of the current local date', () => {
    const post = BLOG_POSTS[0];
    const [y, m, d] = post.date.split('-').map(Number);
    const onTheDay = new Date(y, m - 1, d);
    expect(toISODate(onTheDay)).toBe(post.date);
    expect(publishedPosts(onTheDay)).toContainEqual(post);
    // The local day before, it is not yet published.
    const dayBefore = new Date(y, m - 1, d - 1);
    expect(publishedPosts(dayBefore)).not.toContainEqual(post);
  });
});
