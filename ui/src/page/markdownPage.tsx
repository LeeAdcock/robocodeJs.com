import showdown from 'showdown';
import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import parse, {
  domToReact,
  attributesToProps,
  Element,
  DOMNode,
  HTMLReactParserOptions,
} from 'html-react-parser';
import { Link, useLocation } from 'react-router-dom';
import { useDocumentTitle, brandTitle } from '../util/useDocumentTitle';

// Open external and type-definition links in a new tab so following one doesn't
// navigate away from the app; in-app doc links (e.g. /learn/docs, /samples/:name)
// are left alone so they route in place.
const opensInNewTab = (href: string) =>
  /^https?:\/\//.test(href) || href.startsWith('/docs/ts/');

const parseOptions: HTMLReactParserOptions = {
  replace: (node) => {
    // Duck-type the element (instanceof Element is unreliable across domhandler
    // versions). Text nodes have no `attribs`, so the guard skips them.
    const el = node as Element;
    if (el.name === 'a' && el.attribs?.href) {
      const href = el.attribs.href;
      // External / sample / type-def links open in a new tab.
      if (opensInNewTab(href)) {
        return (
          <a
            {...attributesToProps(el.attribs)}
            target="_blank"
            rel="noopener noreferrer"
          >
            {domToReact(el.children as DOMNode[])}
          </a>
        );
      }
      // In-app routes (e.g. /learn/docs, /learn/aim, /learn/docs#movement): navigate with the
      // router so the page content swaps in place instead of a full reload.
      if (href.startsWith('/')) {
        return <Link to={href}>{domToReact(el.children as DOMNode[])}</Link>;
      }
      // Otherwise (bare #section anchors) fall through to a normal <a> so the
      // in-page hash-scroll behavior keeps working.
    }
  },
};

interface MarkdownPageProps {
  path: string;
  // Optional middle segment for the tab title, e.g. "Blog" or "Learn". The title
  // is built brand-first as "RobocodeJs | <section> | <h1>" to match what the
  // server injects on load (see util/useDocumentTitle + server/src/util/seo.ts).
  titleSection?: string;
}

export default function MarkdownPage(props: MarkdownPageProps) {
  const [html, setHtml] = useState('');
  const [md, setMd] = useState('');

  // Keep the tab title current on in-app navigation (the server sets it on the
  // initial load; see util/useDocumentTitle).
  const h1 = md.match(/^#\s+(.+)$/m)?.[1].trim();
  useDocumentTitle(h1 ? brandTitle(props.titleSection, h1) : null);

  const divRef = useRef<HTMLDivElement>(null);

  const location = useLocation();

  const scrollToSection = () => {
    const header = document.getElementById(location.hash.substring(1));
    const offsetTop =
      (header?.offsetTop || 0) - (header?.offsetHeight || 0) - 77;
    if (offsetTop && divRef.current?.parentElement) {
      divRef.current.parentElement.scrollTop = offsetTop;
    }
  };

  useEffect(() => {
    return () => {
      window.removeEventListener('hashchange', scrollToSection, false);
    };
  }, []);

  useEffect(() => {
    // Allow an optional one-level subfolder (e.g. "blog/<slug>"), encoding
    // each segment separately so the "/" survives as a path separator.
    if (props.path.match(/^[a-zA-Z\-_]{1,32}(\/[a-zA-Z\-_]{1,32})?$/)) {
      const encoded = props.path.split('/').map(encodeURIComponent).join('/');
      axios.get(`/docs/${encoded}.md`).then((res) => setMd(res.data));
    }
  }, [props.path]);

  useEffect(() => {
    // ACCEPTED SECURITY FINDING: showdown has an unfixed moderate ReDoS
    // advisory (GHSA-rmmh-p597-ppvv) with no patched release, so `npm audit`
    // will keep reporting it. It is not exploitable here: `md` is only ever our
    // own static /docs/*.md content fetched above, never user input, so there
    // is no untrusted-markdown path into the converter. Revisit only if this
    // ever renders untrusted markdown — and if you swap renderers, preserve
    // showdown's auto-generated header ids (lowercased, spaces -> hyphens) that
    // scrollToSection and the in-page TOC anchors depend on.
    // ghCompatibleHeaderId gives headings GitHub-style ids (lowercased,
    // spaces -> hyphens, punctuation dropped). Without it showdown strips
    // spaces entirely ("Bot events" -> "botevents"), silently breaking every
    // hyphenated anchor link the docs use (#bot-events, #combat--health, ...).
    setHtml(
      new showdown.Converter({
        tables: true,
        ghCompatibleHeaderId: true,
      }).makeHtml(md)
    );
  }, [md]);

  useEffect(() => {
    if (location.hash) {
      // Jump to the linked section once the content has rendered.
      setTimeout(scrollToSection, 500);
    } else if (divRef.current?.parentElement) {
      // New page with no anchor (e.g. clicking Next between lessons): start at
      // the top instead of keeping the previous page's scroll position.
      divRef.current.parentElement.scrollTop = 0;
    }
  }, [html, location]);

  // ACCEPTED SECURITY FINDING (XSS, defense-in-depth): showdown's HTML output is
  // handed to html-react-parser without an explicit sanitizer. Not exploitable,
  // and mitigated three independent ways:
  //   1. `md` is only ever our own static /docs/*.md content (fetched above),
  //      never user input — there is no untrusted-markdown path into here.
  //   2. html-react-parser builds React elements, so an injected inline <script>
  //      or string `on*=` handler is inert (React does not execute either).
  //   3. The server sets a Content-Security-Policy (server middleware/
  //      securityHeaders.ts) that blocks `javascript:` URLs and inline/foreign
  //      scripts as a backstop.
  // If this ever needs to render untrusted markdown, add an HTML sanitizer
  // (e.g. DOMPurify.sanitize(html)) between makeHtml() and parse().
  return (
    <div ref={divRef} id="markdown" className="markdown">
      {parse(html, parseOptions)}
    </div>
  );
}
