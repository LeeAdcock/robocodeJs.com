import { describe, it, expect } from 'vitest';
import {
  createSeoResolver,
  renderHeadTags,
  describeMarkdown,
  SEO_REGION,
  type BlogEntry,
} from '../src/util/seo';
import { buildSitemap } from '../src/util/sitemap';

const BLOG: BlogEntry[] = [
  {
    slug: 'published-post',
    title: 'A Published Post',
    date: '2025-01-01',
    summary: 'This one is live and should be indexed.',
  },
  {
    slug: 'future-post',
    title: 'A Future Post',
    date: '2099-01-01',
    summary: 'This one is scheduled and must not be indexed yet.',
  },
];

const LESSON_MD = `# Move!

_a lesson_

<img src="/x.png" />

Driving your bot around the arena is the first real skill. Here is how you get
a bot moving in a straight line and stop where you want.

## Next
`;

const resolver = () =>
  createSeoResolver({
    blogIndex: BLOG,
    readDoc: (name) => (name === 'learn-move' ? LESSON_MD : null),
    now: () => new Date('2025-06-15T00:00:00Z'),
    origin: 'https://example.test',
  });

describe('seo resolver', () => {
  it('gives a published blog post article metadata + JSON-LD', () => {
    const m = resolver().resolve('/blog/published-post');
    expect(m.title).toBe('A Published Post — RobocodeJs Blog');
    expect(m.description).toBe('This one is live and should be indexed.');
    expect(m.canonical).toBe('https://example.test/blog/published-post');
    expect(m.ogType).toBe('article');
    expect(m.publishedTime).toBe('2025-01-01');
    expect(m.noindex).toBeFalsy();
    expect(m.jsonLd?.['@type']).toBe('BlogPosting');
  });

  it('noindexes a not-yet-published post and points canonical at /blog', () => {
    const m = resolver().resolve('/blog/future-post');
    expect(m.noindex).toBe(true);
    expect(m.canonical).toBe('https://example.test/blog');
  });

  it('noindexes an unknown blog slug', () => {
    expect(resolver().resolve('/blog/nope').noindex).toBe(true);
  });

  it('derives lesson metadata from the markdown', () => {
    const m = resolver().resolve('/learn/move');
    expect(m.title).toBe('Move! — Learn — RobocodeJs');
    expect(m.description).toMatch(/^Driving your bot around the arena/);
    expect(m.description).not.toContain('#');
    expect(m.noindex).toBeFalsy();
  });

  it('serves curated static-page metadata', () => {
    const home = resolver().resolve('/');
    expect(home.title).toContain('RobocodeJs');
    expect(home.canonical).toBe('https://example.test/');
    const about = resolver().resolve('/about');
    expect(about.title).toBe('About RobocodeJs');
  });

  it('noindexes unknown routes (soft-404s)', () => {
    expect(resolver().resolve('/no/such/page').noindex).toBe(true);
  });

  it('ignores a trailing slash', () => {
    expect(resolver().resolve('/about/').canonical).toBe(
      'https://example.test/about'
    );
  });
});

describe('describeMarkdown', () => {
  it('builds from the objectives list when the lead-in ends in a colon', () => {
    const md = `# Lesson 3: Move!

**By the end of this lesson you'll be able to:**

- Drive your robot around the arena
- Ask your robot **where** it is

## The idea
`;
    expect(describeMarkdown(md)).toBe(
      'Drive your robot around the arena. Ask your robot where it is.'
    );
  });

  it('skips heading, date line and html, flattens links', () => {
    const md = `# Title

_July 1, 2025_

<img
  src="/x.png"
/>

Here is the [first real paragraph](/somewhere) with *emphasis* and \`code\`.
`;
    expect(describeMarkdown(md)).toBe(
      'Here is the first real paragraph with emphasis and code.'
    );
  });
});

describe('renderHeadTags', () => {
  it('emits escaped title/description, canonical, og and twitter tags', () => {
    const m = resolver().resolve('/blog/published-post');
    const head = renderHeadTags(m, 'https://example.test/og-card.png');
    expect(head).toContain('<title>A Published Post — RobocodeJs Blog</title>');
    expect(head).toContain('property="og:type" content="article"');
    expect(head).toContain(
      '<link rel="canonical" href="https://example.test/blog/published-post" />'
    );
    expect(head).toContain('name="twitter:card" content="summary_large_image"');
    expect(head).toContain('application/ld+json');
    expect(head).toContain('article:published_time');
  });

  it('emits robots noindex for unpublished posts', () => {
    const m = resolver().resolve('/blog/future-post');
    const head = renderHeadTags(m, 'https://example.test/og-card.png');
    expect(head).toContain('name="robots" content="noindex,follow"');
  });

  it('escapes special characters in metadata', () => {
    const head = renderHeadTags(
      {
        title: 'A & B <c> "d"',
        description: 'x',
        canonical: 'https://example.test/',
        ogType: 'website',
      },
      'https://example.test/og-card.png'
    );
    expect(head).toContain('<title>A &amp; B &lt;c&gt; &quot;d&quot;</title>');
  });
});

describe('the SEO region marker', () => {
  it('matches the shell placeholder and is replaceable', () => {
    const shell = `<head>\n<!--SEO:start-->\n<title>old</title>\n<!--SEO:end-->\n</head>`;
    expect(SEO_REGION.test(shell)).toBe(true);
    const out = shell.replace(SEO_REGION, '<!--SEO:start-->NEW<!--SEO:end-->');
    expect(out).toContain('NEW');
    expect(out).not.toContain('old');
  });
});

describe('buildSitemap', () => {
  const xml = buildSitemap({
    blogIndex: BLOG,
    lessonSlugs: ['move', 'radar'],
    now: () => new Date('2025-06-15T00:00:00Z'),
    origin: 'https://example.test',
  });

  it('lists static routes, lessons, and only published posts', () => {
    expect(xml).toContain('<loc>https://example.test/</loc>');
    expect(xml).toContain('<loc>https://example.test/learn/move</loc>');
    expect(xml).toContain(
      '<loc>https://example.test/blog/published-post</loc>'
    );
    expect(xml).toContain('<lastmod>2025-01-01</lastmod>');
    // future post excluded
    expect(xml).not.toContain('future-post');
  });

  it('is well-formed urlset xml', () => {
    expect(xml).toMatch(/^<\?xml version="1.0" encoding="UTF-8"\?>/);
    expect(xml).toContain(
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'
    );
    expect(xml.trim().endsWith('</urlset>')).toBe(true);
  });
});
