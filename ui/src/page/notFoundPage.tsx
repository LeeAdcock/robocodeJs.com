import { Link } from 'react-router-dom';
import { brandTitle, useDocumentTitle } from '../util/useDocumentTitle';

// Catch-all for unmatched routes (the `path="*"` Route in App.tsx). Without it,
// an unknown URL rendered nothing — an empty content area inside the app chrome.
// Reuses the shared `markdown` styling so it matches the doc pages. The server
// already marks unknown routes noindex (util/seo.ts), so this is a friendly
// client-side landing, not an indexable page.
export default function NotFoundPage() {
  useDocumentTitle(brandTitle('Page not found'));

  return (
    <div className="markdown">
      <h1>Page not found</h1>
      <p>
        That link took a wrong turn and drove straight into a wall. The link may
        be broken, or the page may have moved.
      </p>
      <p>Here are some good places to go instead:</p>
      <ul>
        <li>
          <Link to="/">Home</Link>. Jump back to the arena.
        </li>
        <li>
          <Link to="/learn">Learn course</Link>. Go from zero to a thinking bot.
        </li>
        <li>
          <Link to="/examples">Example bots</Link>. Read, run, and remix
          complete strategies.
        </li>
        <li>
          <Link to="/blog">Blog</Link>. Notes from building RobocodeJs.
        </li>
      </ul>
    </div>
  );
}
