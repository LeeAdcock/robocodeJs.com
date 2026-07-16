// Validates the REAL ui/public/blog-index.json against the shape the server
// casts it to.
//
// Why this exists: seo.test.ts proves the resolver logic with a synthetic BLOG
// fixture, so the actual file ships unverified. The server reads it at runtime
// and blind-casts, swallowing every failure:
//
//   const loadBlogIndex = (): BlogEntry[] => {
//     const raw = readPublic('blog-index.json');
//     if (!raw) return [];                       // missing  -> silently empty
//     try { return JSON.parse(raw) as BlogEntry[] } catch { return [] }
//   };                                           // malformed -> silently empty
//
// A malformed or missing file therefore does not crash or warn — it drops every
// post from /sitemap.xml and every per-post SEO tag, silently. The UI is safe
// (it `import`s the JSON, so tsc checks it against BlogPostMeta), but the
// server's BlogEntry is a separate declaration over the same file, kept in sync
// by hand. This test is the server-side half of that contract.
//
// The `as BlogEntry[]` cast is a compile-time claim about runtime data, and
// tsc cannot check it — so every assertion here is deliberately a runtime one.

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import type { BlogEntry } from '../src/util/seo';

const BLOG_INDEX_PATH = path.join(
  __dirname,
  '..',
  '..',
  'ui',
  'public',
  'blog-index.json'
);
const BLOG_DOCS_DIR = path.join(
  __dirname,
  '..',
  '..',
  'ui',
  'public',
  'docs',
  'blog'
);

// Read and parse exactly as the server does — swallowing failures rather than
// throwing — so a broken file surfaces as a readable assertion below instead of
// a SyntaxError during test collection. The whole point is to describe the
// consequence, not to show a stack trace.
const raw: string | null = (() => {
  try {
    return fs.readFileSync(BLOG_INDEX_PATH, 'utf8');
  } catch {
    return null;
  }
})();

let parseError: string | null = null;
const parsed: unknown = (() => {
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch (err) {
    parseError = err instanceof Error ? err.message : String(err);
    return null;
  }
})();

const entries: BlogEntry[] = Array.isArray(parsed)
  ? (parsed as BlogEntry[])
  : [];

describe('blog-index.json', () => {
  // The canary for the silent-[] path above. Every later test iterates
  // `entries`, so they pass vacuously when this one fails — that is deliberate:
  // this is the failure that matters, and it names the consequence.
  it('parses to a non-empty array', () => {
    expect(raw, `${BLOG_INDEX_PATH} is unreadable`).not.toBeNull();
    expect(
      parseError,
      'blog-index.json does not parse — the server would silently serve a ' +
        'blog-less sitemap and drop every per-post SEO tag'
    ).toBeNull();
    expect(Array.isArray(parsed), 'blog-index.json is not a JSON array').toBe(
      true
    );
    expect(entries.length, 'blog-index.json is empty').toBeGreaterThan(0);
  });

  it('has every field BlogEntry claims, on every entry', () => {
    for (const entry of entries) {
      // Named in the failure message so a bad entry is identifiable without
      // counting array indices.
      const where = `entry ${JSON.stringify(entry.slug ?? entry)}`;
      expect(typeof entry.slug, `${where}: slug`).toBe('string');
      expect(entry.slug.trim(), `${where}: slug non-empty`).not.toBe('');
      expect(typeof entry.title, `${where}: title`).toBe('string');
      expect(entry.title.trim(), `${where}: title non-empty`).not.toBe('');
      expect(typeof entry.summary, `${where}: summary`).toBe('string');
      expect(entry.summary.trim(), `${where}: summary non-empty`).not.toBe('');
      expect(typeof entry.date, `${where}: date`).toBe('string');
    }
  });

  it('carries no fields BlogEntry does not declare', () => {
    // A stray field means the two hand-synced types (server BlogEntry, ui
    // BlogPostMeta) have drifted, or a post is carrying metadata nothing reads.
    const allowed = ['slug', 'title', 'date', 'summary'];
    for (const entry of entries) {
      const extra = Object.keys(entry).filter((k) => !allowed.includes(k));
      expect(extra, `entry "${entry.slug}" has undeclared fields`).toEqual([]);
    }
  });

  it('dates are real YYYY-MM-DD calendar dates', () => {
    for (const entry of entries) {
      expect(entry.date, `entry "${entry.slug}"`).toMatch(
        /^\d{4}-\d{2}-\d{2}$/
      );
      // Guards 2027-13-45: the regex shape passes, the calendar does not. The
      // date drives publish scheduling and sitemap <lastmod>.
      const parsed = new Date(`${entry.date}T00:00:00Z`);
      expect(Number.isNaN(parsed.getTime()), `entry "${entry.slug}"`).toBe(
        false
      );
      expect(parsed.toISOString().slice(0, 10), `entry "${entry.slug}"`).toBe(
        entry.date
      );
    }
  });

  it('slugs are unique', () => {
    // A duplicate slug silently shadows a post: two entries, one reachable URL.
    const slugs = entries.map((e) => e.slug);
    expect(slugs).toEqual([...new Set(slugs)]);
  });

  it('is ordered newest-first', () => {
    // blogPosts.ts documents this ordering as the contract; the index page
    // renders the list as-is rather than sorting it.
    const dates = entries.map((e) => e.date);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  it('every entry has its markdown body on disk', () => {
    // Without this, the post 404s and the sitemap advertises a dead URL.
    for (const entry of entries) {
      const file = path.join(BLOG_DOCS_DIR, `${entry.slug}.md`);
      expect(fs.existsSync(file), `missing ${entry.slug}.md`).toBe(true);
    }
  });

  it('every markdown body has an entry', () => {
    // The reverse orphan: a post that exists but is unreachable and unindexed,
    // because nothing but this file lists it.
    const slugs = new Set(entries.map((e) => e.slug));
    const orphans = fs
      .readdirSync(BLOG_DOCS_DIR)
      .filter((f) => f.endsWith('.md'))
      .map((f) => f.replace(/\.md$/, ''))
      .filter((slug) => !slugs.has(slug));
    expect(orphans, 'markdown posts absent from blog-index.json').toEqual([]);
  });
});
