import path from 'node:path';

// Vite writes every content-hashed build artifact under /assets/ (assetsDir
// defaults to 'assets' inside build.outDir = server/dist/public).
const BUILD_ASSET_PATH = /^\/assets\//;

// A subresource is something the browser fetches *for* a page — a script,
// stylesheet, font, image, or a data file the SPA loads at runtime — never a
// navigation. Every client route is extension-free (see the <Route> table in
// ui/src/App.tsx: /learn/:slug, /samples/:name, /watch/:arenaId, …), so a path
// carrying one of these extensions can only be a subresource.
const SUBRESOURCE_EXTENSION =
  /\.(js|mjs|cjs|css|map|json|md|txt|xml|wasm|woff2?|ttf|otf|eot|png|jpe?g|gif|svg|webp|avif|ico)$/i;

// Should a request that reached the SPA fallback — meaning no static file
// matched it — be answered with a real 404 instead of the HTML shell?
//
// The shell is the right answer for a navigation: that is how client-side
// routing works, and an unknown page renders the in-app not-found view. It is
// the WRONG answer for a subresource, and disastrous for a stale content-hashed
// chunk. Every hash changes on deploy, so a browser still holding the previous
// build's HTML asks for chunks that no longer exist. Answering those with
// index.html and a 200 makes the browser try to execute HTML as JavaScript; it
// fails the module MIME check ("Expected a JavaScript module script but the
// server responded with a MIME type of text/html") and, because a rejected
// React.lazy import throws during render, the whole app unmounts to a blank
// page. A 404 is both honest and recoverable — the client can recognize it and
// reload into the current build (see ui/src/components/chunkErrorBoundary.tsx).
export const isSubresourceRequest = (requestPath: string): boolean =>
  BUILD_ASSET_PATH.test(requestPath) || SUBRESOURCE_EXTENSION.test(requestPath);

// Is this on-disk path one of the content-hashed build assets?
export const isHashedAsset = (filePath: string): boolean =>
  filePath.includes(`${path.sep}assets${path.sep}`);

// Cache-Control for content-hashed build assets. The hash IS the cache key —
// any change to the file produces a new name — so the old name can be cached
// indefinitely and never revalidated. This is the whole point of hashing the
// filenames, and previously we were throwing it away: express.static's default
// (`public, max-age=0`) forced a revalidation round-trip for every asset on
// every page load.
export const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';

// Cache-Control for the HTML shell — the one file whose name never changes
// while its contents do, since it carries the current asset hashes. It must be
// revalidated on every navigation, or a browser will keep asking for the
// previous deploy's chunks. `no-cache` means "revalidate before use", not
// "don't store": a 304 still saves the bytes.
export const SHELL_CACHE_CONTROL = 'no-cache';
