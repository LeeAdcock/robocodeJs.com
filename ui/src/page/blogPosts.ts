import blogIndex from '../../public/blog-index.json';

// The blog's single source of truth: one entry per post, newest first. The
// index page renders (and date-filters) this list, and the post page uses it
// to hide posts whose date hasn't arrived yet — so future-dated posts can be
// merged/deployed ahead of time and "publish themselves" on schedule. The
// markdown bodies live in public/docs/blog/<slug>.md.
//
// Note this is presentation, not secrecy: the markdown ships in the static
// bundle, so a future post is technically fetchable by URL before its date.

export interface BlogPostMeta {
  slug: string;
  title: string;
  /** ISO date (YYYY-MM-DD); the post becomes visible on this local date. */
  date: string;
  summary: string;
}

/** Local-date ISO stamp (YYYY-MM-DD) — string-comparable against post dates. */
export const toISODate = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export const isPublished = (post: BlogPostMeta, now: Date): boolean =>
  post.date <= toISODate(now);

/** Posts visible as of `now`, newest first. */
export const publishedPosts = (now: Date): BlogPostMeta[] =>
  BLOG_POSTS.filter((p) => isPublished(p, now));

export const findPost = (slug: string): BlogPostMeta | undefined =>
  BLOG_POSTS.find((p) => p.slug === slug);

/** Render an ISO date for display, e.g. "July 12, 2026". */
export const formatDate = (iso: string): string => {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
};

// The data lives in ../../public/blog-index.json so the server can read the same
// manifest (for sitemap.xml and per-page SEO metadata) without importing this
// TypeScript module. Keep JSON edits and this file's type in sync.
export const BLOG_POSTS: BlogPostMeta[] = blogIndex as BlogPostMeta[];
