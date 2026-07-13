import { useParams } from 'react-router-dom';
import MarkdownPage from './markdownPage';

// Renders a single course lesson. The /learn/:slug route maps to the markdown
// file learn-<slug>.md (served from public/docs), reusing the docs renderer.
export default function LessonPage() {
  const { slug } = useParams();
  return <MarkdownPage path={`learn-${slug}`} titleSection="Learn" />;
}
