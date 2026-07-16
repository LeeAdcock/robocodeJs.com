// Builds sitemap.xml from the public routes: the curated top-level pages, the
// published blog posts (future-dated ones are excluded), and the Learn lessons.
// Dependency-injected for testability (see test/seo.test.ts).

import type { BlogEntry } from './seo';

export interface SitemapDeps {
  blogIndex: BlogEntry[];
  /** Learn lesson slugs (from learn-<slug>.md files). */
  lessonSlugs: string[];
  now: () => Date;
  origin: string;
}

// Static public routes worth listing. (/leaderboard and /samples/* are dynamic
// or numerous; the crawler finds them via in-page links.)
const STATIC_ROUTES = [
  '/',
  '/about',
  '/blog',
  '/learn',
  '/learn/docs',
  '/rules',
  '/faq',
  '/examples',
  '/rankings',
  '/leaderboard',
  '/mcp',
  '/classic',
  '/error-codes',
];

const isoNow = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;

export const buildSitemap = (deps: SitemapDeps): string => {
  const { blogIndex, lessonSlugs, now, origin } = deps;
  const today = isoNow(now());

  const urls: { loc: string; lastmod?: string }[] = [];
  for (const r of STATIC_ROUTES) urls.push({ loc: origin + r });
  for (const slug of lessonSlugs) urls.push({ loc: `${origin}/learn/${slug}` });
  for (const post of blogIndex) {
    if (post.date <= today) {
      urls.push({ loc: `${origin}/blog/${post.slug}`, lastmod: post.date });
    }
  }

  const body = urls
    .map((u) => {
      const lastmod = u.lastmod ? `\n    <lastmod>${u.lastmod}</lastmod>` : '';
      return `  <url>\n    <loc>${u.loc}</loc>${lastmod}\n  </url>`;
    })
    .join('\n');

  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    body +
    '\n</urlset>\n'
  );
};
