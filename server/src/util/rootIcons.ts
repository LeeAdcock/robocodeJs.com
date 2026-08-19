import path from 'node:path';
import express, { Router } from 'express';

// Icons that user agents fetch from the site ROOT by convention, whatever the
// shell's <link rel> tags say: every browser (and most crawlers) probes
// /favicon.ico, and iOS probes /apple-touch-icon.png. The icon set itself lives
// under /icons/, so keep this a mapping rather than duplicating the files —
// there is one copy on disk and one list of the names that must answer at the
// root, shared by the wiring and its test.
export const ROOT_ICON_FILES: Record<string, string> = {
  '/favicon.ico': path.join('icons', 'favicon.ico'),
  '/apple-touch-icon.png': path.join('icons', 'apple-touch-icon.png'),
};

// Serves those root aliases out of the built public directory. Must be mounted
// before the SPA fallback: these paths carry subresource extensions, so reaching
// the fallback means a 404 (see util/staticAssets.ts).
export const rootIconRouter = (publicDir: string): Router => {
  const router = express.Router();
  for (const [route, file] of Object.entries(ROOT_ICON_FILES)) {
    router.get(route, (_req, res, next) => {
      // Sent with `root` rather than as one absolute path: send() rejects any
      // dot-segment in the path it is given, so an absolute path fails outright
      // whenever the checkout itself lives under a dotted directory.
      res.sendFile(file, { root: publicDir }, (err) => {
        // If the file isn't there (an incomplete build), fall through to the
        // ordinary not-found path — which logs asset.missing — rather than
        // raising a 500 out of the catch-all error handler.
        if (err && !res.headersSent) next();
      });
    });
  }
  return router;
};
