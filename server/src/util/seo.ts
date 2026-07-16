// Per-page SEO metadata for the public (unauthenticated) pages.
//
// The UI is a client-rendered SPA: every route returns the same index.html
// shell, so without this a crawler (and every social link-preview scraper that
// does not run JS) sees one generic <title> and an empty description for the
// homepage, every doc, every lesson, and every blog post. This module computes
// per-route <title>/description/canonical/Open-Graph/Twitter/JSON-LD and the SPA
// fallback injects it into the shell before sending (see index.ts).
//
// It is intentionally dependency-injected (blogIndex, readDoc, now, origin) so
// it can be unit-tested without a filesystem or a running server.

export interface BlogEntry {
  slug: string;
  title: string;
  date: string; // YYYY-MM-DD
  summary: string;
}

export interface PageMeta {
  title: string;
  description: string;
  /** Absolute canonical URL. */
  canonical: string;
  /** 'website' | 'article' — drives og:type. */
  ogType: 'website' | 'article';
  /** ISO date for article:published_time (blog posts only). */
  publishedTime?: string;
  /** When true, emit <meta name="robots" content="noindex,follow">. */
  noindex?: boolean;
  /** Optional JSON-LD object (schema.org) to embed. */
  jsonLd?: Record<string, unknown>;
}

export interface SeoDeps {
  blogIndex: BlogEntry[];
  /** Return the raw markdown for a docs slug (e.g. "learn-radar"), or null. */
  readDoc: (name: string) => string | null;
  /** Current time, injectable for tests. */
  now: () => Date;
  /** Absolute site origin, e.g. "https://robocodejs.com" (no trailing slash). */
  origin: string;
}

const SITE = 'RobocodeJs';
const DEFAULT_DESCRIPTION =
  'RobocodeJs is a free browser game where you write JavaScript bots that ' +
  'battle in a live arena. No install, no setup: write a few lines and watch ' +
  'them fight. Learn to code by building battle bots.';

// Curated titles/descriptions for the top-level pages. Anything not listed and
// not a /blog or /learn route falls back to the site default.
// Titles are brand-first ("RobocodeJs | <page>") so a tab is recognizable at a
// glance when the user has many open; descriptions carry the keyword detail.
const STATIC_PAGES: Record<string, { title: string; description: string }> = {
  '/': {
    title: 'RobocodeJs | Learn to code by building battle bots',
    description: DEFAULT_DESCRIPTION,
  },
  '/about': {
    title: 'RobocodeJs | About',
    description:
      'The story behind RobocodeJs: a browser reimagining of the classic ' +
      'Robocode, built to hand the spark of programming to anyone who has ' +
      'never written a line of code.',
  },
  '/learn': {
    title: 'RobocodeJs | Learn to Code with Robots',
    description:
      'A free, hands-on course that teaches you to code from scratch by ' +
      'building battle bots. No experience needed. Every idea is explained in ' +
      'plain words with examples you can run right away.',
  },
  '/learn/docs': {
    title: 'RobocodeJs | Bot API Reference',
    description:
      'The full developer reference for writing RobocodeJs bots: movement, ' +
      'radar, turret, events, timers, and the arena API.',
  },
  '/rules': {
    title: 'RobocodeJs | Game Rules & Physics',
    description:
      'The numbers behind RobocodeJs: directions, speeds, reload and radar ' +
      'timing, damage, and how combat resolves.',
  },
  '/examples': {
    title: 'RobocodeJs | Example Bots',
    description:
      'Complete bot strategies you can read, run, and remix, from a simple ' +
      'scan-and-fire lighthouse to a shot-leading marksman and a coordinated ' +
      'squad.',
  },
  '/blog': {
    title: 'RobocodeJs | Blog',
    description:
      'Notes from building RobocodeJs: bot strategy, debugging, how the game ' +
      'works under the hood, and what it is like to build and run a small ' +
      'game on the side.',
  },
  '/rankings': {
    title: 'RobocodeJs | How the Global Rankings Work',
    description:
      'Every eligible bot earns a persistent Elo rating from background ' +
      'matches. How the ladder works and why your rating follows your current ' +
      'code.',
  },
  '/leaderboard': {
    title: 'RobocodeJs | Global Rankings',
    description:
      'The top-rated bots across all players, ranked by Elo from head-to-head ' +
      'matches.',
  },
  '/mcp': {
    title: 'RobocodeJs | AI Integration (MCP)',
    description:
      'Connect an AI assistant to RobocodeJs over the Model Context Protocol ' +
      'to write, run, and watch your bots.',
  },
  '/classic': {
    title: 'RobocodeJs | Coming from classic Robocode?',
    description:
      'A migration guide mapping classic (Java) Robocode concepts onto ' +
      'RobocodeJs for players who already know the original game.',
  },
  '/error-codes': {
    title: 'RobocodeJs | Bot Error Codes',
    description:
      'What each E0xx error code in your bot log means, and how to fix it.',
  },
  '/privacy': {
    title: 'RobocodeJs | Privacy',
    description: 'How RobocodeJs handles your data.',
  },
};

const clamp = (s: string, max = 160): string => {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return (
    (lastSpace > 40 ? cut.slice(0, lastSpace) : cut).replace(/[.,;:]$/, '') +
    '…'
  );
};

const flattenMarkdown = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // [text](url) -> text
    .replace(/[*_`]/g, '') // emphasis / code ticks
    .replace(/\s+/g, ' ')
    .trim();

// Pull a plain-text description out of a markdown body. Splits the body into
// blank-line-separated blocks, skips the H1, the italic date line, and leading
// HTML (the headshot <img> block), and takes the first prose block. Special
// case: the Learn lessons all open with "By the end of this lesson…:" followed
// by a bullet list of objectives — when the first block ends in a colon and a
// list follows, the objectives make a far better description than the lead-in.
export const describeMarkdown = (md: string): string | null => {
  const blocks = md
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  const isSkippable = (b: string) =>
    b.startsWith('#') || // heading
    b.startsWith('<') || // HTML (headshot img)
    b.startsWith('```') || // code fence
    /^_[^_].*_$/.test(b); // italic date line

  const isList = (b: string) =>
    b.split('\n').every((l) => /^\s*([-*]|\d+\.)\s+/.test(l.trim()));

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (isSkippable(block) || isList(block)) continue;

    const flat = flattenMarkdown(block);
    if (!flat) continue;

    // Lead-in ending in a colon: build from the following list's items.
    if (flat.endsWith(':') && i + 1 < blocks.length && isList(blocks[i + 1])) {
      const items = blocks[i + 1]
        .split('\n')
        .map((l) => flattenMarkdown(l.replace(/^\s*([-*]|\d+\.)\s+/, '')))
        .filter(Boolean);
      if (items.length) return items.join('. ') + '.';
    }
    return flat;
  }
  return null;
};

const titleOf = (md: string): string | null => {
  const m = md.match(/^#\s+(.+)$/m);
  return m ? m[1].trim() : null;
};

const escapeAttr = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Build the resolver. `resolve(pathname)` returns per-page metadata. */
export const createSeoResolver = (deps: SeoDeps) => {
  const { blogIndex, readDoc, now, origin } = deps;
  const isoNow = () => {
    const d = now();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
      d.getDate()
    ).padStart(2, '0')}`;
  };

  const resolve = (pathname: string): PageMeta => {
    const path = pathname.replace(/\/+$/, '') || '/';
    const canonical = origin + (path === '/' ? '/' : path);

    // Blog post
    const blogMatch = path.match(/^\/blog\/([a-z0-9-]+)$/);
    if (blogMatch) {
      const post = blogIndex.find((p) => p.slug === blogMatch[1]);
      const published = !!post && post.date <= isoNow();
      if (post && published) {
        return {
          // "RobocodeJs | Blog | <title>" so tabs read brand-first and search results
          // (distinct from the /learn lessons and reference docs).
          title: `${SITE} | Blog | ${post.title}`,
          description: clamp(post.summary),
          canonical,
          ogType: 'article',
          publishedTime: post.date,
          jsonLd: {
            '@context': 'https://schema.org',
            '@type': 'BlogPosting',
            headline: post.title,
            description: clamp(post.summary),
            datePublished: post.date,
            author: { '@type': 'Person', name: 'Lee Adcock' },
            publisher: { '@type': 'Organization', name: SITE },
            mainEntityOfPage: canonical,
          },
        };
      }
      // Unknown or not-yet-published post: keep it out of the index.
      return {
        title: `${SITE} | Blog`,
        description: STATIC_PAGES['/blog'].description,
        canonical: origin + '/blog',
        ogType: 'website',
        noindex: true,
      };
    }

    // Learn lesson: derive title/description from the markdown body.
    const learnMatch = path.match(/^\/learn\/([a-z0-9-]+)$/);
    if (learnMatch && learnMatch[1] !== 'docs') {
      const md = readDoc(`learn-${learnMatch[1]}`);
      if (md) {
        const t = titleOf(md);
        const d = describeMarkdown(md);
        return {
          title: t ? `${SITE} | Learn | ${t}` : `${SITE} | Learn`,
          description: d ? clamp(d) : STATIC_PAGES['/learn'].description,
          canonical,
          ogType: 'article',
        };
      }
      return {
        title: `${SITE} | Learn`,
        description: STATIC_PAGES['/learn'].description,
        canonical: origin + '/learn',
        ogType: 'website',
        noindex: true,
      };
    }

    // Sample bot viewer
    const sampleMatch = path.match(/^\/samples\/([a-z0-9-]+)$/);
    if (sampleMatch) {
      const name = sampleMatch[1];
      const pretty = name.charAt(0).toUpperCase() + name.slice(1);
      return {
        title: `${SITE} | Example Bot | ${pretty}`,
        description: `Read the source of the ${pretty} example bot and clone it into your own arena.`,
        canonical,
        ogType: 'article',
      };
    }

    // The signed-in user's own badges (/profile, GitHub #121). Private — there is
    // no public profile — so it must stay out of the index. Listed explicitly for
    // the same reason as /watch below: unknown routes already default to noindex,
    // but they also default to the "Page not found" title, which is wrong on a
    // real page and would flash in the tab before the SPA sets its own.
    if (path === '/profile') {
      return {
        title: `${SITE} | Your badges`,
        description: 'Achievements you have earned in RobocodeJs.',
        canonical,
        ogType: 'website',
        noindex: true,
      };
    }

    // Public "watch" spectator page (/watch/:arenaId). A per-arena, ephemeral
    // view — give it a friendly brand title for the browser tab / link preview,
    // but keep it out of the index (it's transient and has no stable content).
    // Unknown routes already default to noindex; this is explicit so a shared
    // link still shows a sensible title rather than the generic soft-404 one.
    if (/^\/watch\/[^/]+$/.test(path)) {
      return {
        title: `${SITE} | Watch a live match`,
        description: 'Spectate a live RobocodeJs match.',
        canonical,
        ogType: 'website',
        noindex: true,
      };
    }

    const stat = STATIC_PAGES[path];
    if (stat) {
      return {
        title: stat.title,
        description: clamp(stat.description),
        canonical,
        ogType: path === '/' ? 'website' : 'website',
      };
    }

    // Unknown route: soft-404. Title matches the client NotFoundPage (App.tsx
    // `path="*"`) so the tab is consistent on load and after navigation, and
    // don't let soft-404s be indexed.
    return {
      title: `${SITE} | Page not found`,
      description: DEFAULT_DESCRIPTION,
      canonical,
      ogType: 'website',
      noindex: true,
    };
  };

  return { resolve };
};

/**
 * Render the managed <head> block for a page. The shell (index.html) wraps its
 * default title/description/OG tags in <!--SEO:start--> … <!--SEO:end-->; the
 * fallback middleware swaps that whole region for this per-page version.
 */
export const renderHeadTags = (meta: PageMeta, ogImage: string): string => {
  const t = escapeAttr(meta.title);
  const d = escapeAttr(meta.description);
  const url = escapeAttr(meta.canonical);
  const img = escapeAttr(ogImage);
  const lines = [
    `<title>${t}</title>`,
    `<meta name="description" content="${d}" />`,
    `<link rel="canonical" href="${url}" />`,
    `<meta property="og:site_name" content="${SITE}" />`,
    `<meta property="og:type" content="${meta.ogType}" />`,
    `<meta property="og:title" content="${t}" />`,
    `<meta property="og:description" content="${d}" />`,
    `<meta property="og:url" content="${url}" />`,
    `<meta property="og:image" content="${img}" />`,
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${t}" />`,
    `<meta name="twitter:description" content="${d}" />`,
    `<meta name="twitter:image" content="${img}" />`,
  ];
  if (meta.publishedTime) {
    lines.push(
      `<meta property="article:published_time" content="${escapeAttr(
        meta.publishedTime
      )}" />`
    );
  }
  if (meta.noindex) {
    lines.push(`<meta name="robots" content="noindex,follow" />`);
  }
  if (meta.jsonLd) {
    // JSON-LD is escaped only for </script to prevent early tag closure.
    const json = JSON.stringify(meta.jsonLd).replace(/<\//g, '<\\/');
    lines.push(`<script type="application/ld+json">${json}</script>`);
  }
  return lines.join('\n    ');
};

export const SEO_REGION = /<!--SEO:start-->[\s\S]*?<!--SEO:end-->/;
