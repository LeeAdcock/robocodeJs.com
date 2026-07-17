import { ReactNode } from 'react';
import { OverlayTrigger, Tooltip } from 'react-bootstrap';
import { GlossaryEntry } from '../util/glossary';

interface GlossaryTermProps {
  entry: GlossaryEntry;
  children: ReactNode;
}

// Wraps a matched glossary term in markdown prose with a definition tooltip.
// tabIndex + the focus trigger make the tooltip reachable by keyboard and
// touch, not just mouse hover. The id is unique per page because MarkdownPage
// only wraps the first occurrence of each term.
export default function GlossaryTerm(props: GlossaryTermProps) {
  const slug = props.entry.term.replace(/\s+/g, '-');
  return (
    <OverlayTrigger
      placement="top"
      trigger={['hover', 'focus']}
      overlay={
        <Tooltip id={`glossary-${slug}`}>{props.entry.definition}</Tooltip>
      }
    >
      <span className="glossary-term" tabIndex={0}>
        {props.children}
      </span>
    </OverlayTrigger>
  );
}
