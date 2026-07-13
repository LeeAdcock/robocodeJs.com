import { Link } from 'react-router-dom';
import { publishedPosts, formatDate, BlogPostMeta } from './blogPosts';

// The /blog index. Renders the post manifest (blogPosts.ts) filtered to posts
// whose date has arrived, so future-dated posts can ship in a deploy and appear
// on schedule. Uses the client clock — good enough for an embargo whose content
// is already in the public bundle. `now` is injectable for tests.
export default function BlogIndexPage(props: { now?: Date }) {
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
      <h1>Blog</h1>
      <p>
        Notes from building RobocodeJs: strategy for your bots, the odd
        debugging war story, how the game works under the hood, and what it's
        like to build and run a small game on the side. Some posts are for
        players, some are for the curious, and a few are just me thinking out
        loud. New here? The <Link to="/about">About page</Link> is a good place
        to start, or jump straight into the{' '}
        <Link to="/learn">Learn course</Link>.
      </p>
      <hr />
      {byYear.map(([year, yearPosts]) => (
        <div key={year}>
          <h2>{year}</h2>
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
