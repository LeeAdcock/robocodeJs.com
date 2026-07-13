import { useEffect } from 'react';

const SITE = 'RobocodeJs';

// Compose a brand-first tab title: "RobocodeJs | Section | Page". Falsy parts
// are dropped, and any redundant "RobocodeJs" inside a part is stripped (e.g. an
// "About RobocodeJs" H1 becomes just "About"). Matches the server's titles (see
// server/src/util/seo.ts) so the tab title is consistent on load and on in-app
// navigation, and is recognizable at a glance when many tabs are open.
export const brandTitle = (...parts: (string | null | undefined)[]): string => {
  const rest = parts
    .filter((p): p is string => !!p)
    .map((p) => p.replace(new RegExp(`\\s*${SITE}\\s*`, 'i'), ' ').trim())
    .filter(Boolean);
  return [SITE, ...rest].join(' | ');
};

// Keep the browser tab title in sync during client-side navigation. The server
// injects the correct <title> into the initial HTML for each URL, but React
// Router swaps routes without a reload, so without this the tab would keep the
// first page's title as you click around. Pass a full title (usually built with
// brandTitle); a nullish value resets to the site name.
export const useDocumentTitle = (title: string | null | undefined): void => {
  useEffect(() => {
    document.title = title || SITE;
  }, [title]);
};
