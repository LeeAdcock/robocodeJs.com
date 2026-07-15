import { Link } from 'react-router-dom';
import { publishedPosts, formatDate, BlogPostMeta } from './blogPosts';
import { brandTitle, useDocumentTitle } from '../util/useDocumentTitle';

// The /blog index. Renders the post manifest (blogPosts.ts) filtered to posts
// whose date has arrived, so future-dated posts can ship in a deploy and appear
// on schedule. Uses the client clock — good enough for an embargo whose content
// is already in the public bundle. `now` is injectable for tests.
export default function BlogIndexPage(props: { now?: Date }) {
  useDocumentTitle(brandTitle('Blog'));
  const posts = publishedPosts(props.now ?? new Date());

  // Group by year for the section headers, preserving newest-first order.
  const byYear = posts.reduce((years: [string, BlogPostMeta[]][], post) => {
    const year = post.date.slice(0, 4);
    const last = years[years.length - 1];
    if (last && last[0] === year) last[1].push(post);
    else years.push([year, [post]]);
    return years;
  }, []);

  return (
    // Reuse the shared markdown styling so the page matches the doc pages.
    <div className="markdown">
      <p>
        RobocodeJs first launched back in 2022 as a small browser reimagining of
        the classic Robocode, and it has been quietly evolving ever since. Over
        the last several years it has grown from a bare arena into a full game:
        an in-browser editor, a sandboxed engine, a Learn course, global
        rankings, and an MCP integration that lets an AI write and battle bots
        alongside you. These posts chart that journey, part strategy guide for
        your bots, part debugging war story, and part running diary of building
        and evolving a small game on the side.
      </p>
      {byYear.map(([year, yearPosts]) => (
        <div key={year}>
          <h1>{year}</h1>
          <ul>
            {yearPosts.map((post) => (
              <li key={post.slug} style={{ marginBottom: '0.75em' }}>
                <strong>
                  <Link to={`/blog/${post.slug}`}>{post.title}</Link>
                </strong>{' '}
                <em>({formatDate(post.date)})</em> {post.summary}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
