import { useParams, Link } from 'react-router-dom';
import MarkdownPage from './markdownPage';
import { findPost, isPublished, formatDate } from './blogPosts';

// Renders a single blog post. The /blog/:slug route maps to the markdown file
// blog/<slug>.md (served from public/docs), reusing the docs renderer — mirrors
// LessonPage for the /learn/:slug lessons. Posts are gated on the manifest
// (blogPosts.ts): unknown slugs and posts whose date hasn't arrived yet get a
// friendly notice instead of the markdown. `now` is injectable for tests.
export default function BlogPostPage(props: { now?: Date }) {
  const { slug } = useParams();
  const post = slug ? findPost(slug) : undefined;

  if (!post || !isPublished(post, props.now ?? new Date())) {
    return (
      <div className="markdown">
        <h1>Blog</h1>
        <p>
          {post
            ? `This post isn't published yet. Check back on ${formatDate(
                post.date
              )}.`
            : "There's no post here."}
        </p>
        <p>
          <Link to="/blog">← Back to the blog</Link>
        </p>
      </div>
    );
  }

  return <MarkdownPage path={`blog/${slug}`} />;
}
