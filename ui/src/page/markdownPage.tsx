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

// Open sample-source and external links in a new tab so following one doesn't
// navigate away from the app; in-app doc links (e.g. /dev) are left alone.
const opensInNewTab = (href: string) =>
  /^https?:\/\//.test(href) ||
  href.startsWith('/samples/') ||
  href.startsWith('/ts/');

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
      // In-app routes (e.g. /dev, /learn/aim, /dev#movement): navigate with the
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
}

export default function MarkdownPage(props: MarkdownPageProps) {
  const [html, setHtml] = useState('');
  const [md, setMd] = useState('');

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
    if (props.path.match(/[a-zA-Z\-_]{1,32}/)) {
      axios
        .get(`/docs/${encodeURIComponent(props.path)}.md`)
        .then((res) => setMd(res.data));
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
    setHtml(new showdown.Converter({ tables: true }).makeHtml(md));
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

  return (
    <div ref={divRef} id="markdown" className="markdown">
      {parse(html, parseOptions)}
    </div>
  );
}
