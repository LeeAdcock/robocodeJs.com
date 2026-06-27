import showdown from 'showdown';
import { useState, useEffect } from 'react';
import axios from 'axios';
import parse, {
  domToReact,
  attributesToProps,
  Element,
  DOMNode,
  HTMLReactParserOptions,
} from 'html-react-parser';
import React from 'react';
import { useLocation } from 'react-router-dom';

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
    if (el.name === 'a' && el.attribs?.href && opensInNewTab(el.attribs.href)) {
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
  },
};

interface MarkdownPageProps {
  path: string;
}

export default function MarkdownPage(props: MarkdownPageProps) {
  const [html, setHtml] = useState('');
  const [md, setMd] = useState('');

  const divRef = React.createRef<HTMLDivElement>();

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
    setHtml(new showdown.Converter().makeHtml(md));
  }, [md]);

  useEffect(() => {
    // force a rescroll
    setTimeout(scrollToSection, 500);
  }, [html, location]);

  return (
    <div ref={divRef} id="markdown" className="markdown">
      {parse(html, parseOptions)}
    </div>
  );
}
