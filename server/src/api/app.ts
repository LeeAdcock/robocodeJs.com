import express from 'express';

import appService from '../services/AppService';
import compiler from '../util/compiler';
import {
  propagateSource,
  executeInUserArenas,
  rebootInUserArenas,
  deleteAppEverywhere,
  sourceSizeError,
} from '../util/botActions';
import { ErrorCodes } from '../types/ErrorCodes';

import {
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  scopedUser,
  scopedApp,
} from '../middleware/resource';
import { computeRateLimit, writeRateLimit } from '../middleware/rateLimit';

const app = express();

// Resolve a bot's public metadata (id + name + owner) by its id alone — for the
// "add existing bot by UUID" / share-link flow, where the caller has only the
// bot's id and not its owner's userId. Gated to any signed-in user by the
// `app.use('/api/app', auth(true))` line in index.ts. Returns NO source — source
// stays behind the owner-gated /user/:userId/app/:appId/source route.
app.get('/api/app/:appId', loadApp, (req, res) => {
  const target = scopedApp(req);
  res.json({
    id: target.getId(),
    name: target.getName(),
    userId: target.getUserId(),
  });
});

// Caps the number of apps (bots) a single user can own. Each app compiles into
// an 8 MB isolate per arena it runs in, so this bounds a user's isolate/memory
// footprint alongside MAX_ARENAS_PER_USER (see api/arena.ts).
const MAX_APPS_PER_USER = 20;

// Get user apps
app.get('/api/user/:userId/apps', loadUser, async (req, res) => {
  const user = scopedUser(req);
  // Metadata only (id + name) — never source. Left readable so an app id can be
  // resolved to a name for cross-user reference flows; source stays behind the
  // owner-gated /app/:appId/source route.
  const apps = await appService.getForUser(user.getId());
  res.json(apps.map((app) => ({ id: app.getId(), name: app.getName() })));
});

// Create an app
app.post(
  '/api/user/:userId/app/',
  writeRateLimit,
  loadUser,
  requireOwner,
  async (req, res) => {
    const user = scopedUser(req);
    const existing = await appService.getForUser(user.getId());
    if (existing.length >= MAX_APPS_PER_USER) {
      res.status(400);
      res.send('App limit reached');
      return;
    }
    const app = await appService.create(user.getId());
    res.status(201);
    res.send({ appId: app.getId() });
  }
);

// Get an app
app.get('/api/user/:userId/app/:appId', loadUser, loadApp, (req, res) => {
  const app = scopedApp(req);
  res.json({
    id: app.getId(),
    name: app.getName(),
  });
});

// Put app source code
app.put(
  '/api/user/:userId/app/:appId/source',
  writeRateLimit,
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  async (req, res) => {
    const app = scopedApp(req);
    const source = req.body.toString('utf-8');
    // Bound the source size (resource exhaustion) before persisting anything, so
    // an oversized upload gets a clean, documented 413/E025 rather than a generic
    // parser 413. Saves are otherwise NOT gated on validity (authors save
    // work-in-progress); the editor's Check button / POST .../check dry-run
    // surfaces syntax errors separately.
    const tooLarge = sourceSizeError(source);
    if (tooLarge) {
      res.status(413).json({ code: ErrorCodes.E025, error: tooLarge });
      return;
    }
    await propagateSource(app, source);
    res.status(200);
    res.send();
  }
);

// Dry-run compile the posted source (the current editor buffer, which may be
// unsaved) in a throwaway isolate and return any syntax/load error — WITHOUT
// deploying it to an arena. Powers the editor's Check button.
app.post(
  '/api/user/:userId/app/:appId/check',
  computeRateLimit,
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  async (req, res) => {
    const source = req.body.toString('utf-8');
    // Same source-size cap as the save route: bound the untrusted code compiled
    // in the throwaway isolate (the octet-stream parser's limit is only a higher
    // memory backstop).
    const tooLarge = sourceSizeError(source);
    if (tooLarge) {
      res.status(413).json({ code: ErrorCodes.E025, error: tooLarge });
      return;
    }
    const result = await compiler.check(source);
    res.status(200);
    res.send(result);
  }
);

// Execute app source code
app.post(
  '/api/user/:userId/app/:appId/compile',
  computeRateLimit,
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  async (req, res) => {
    const user = scopedUser(req);
    const app = scopedApp(req);

    await executeInUserArenas(user.getId(), app.getId());
    res.status(200);
    res.send({
      name: app.getName(),
    });
  }
);

// Reboot the app: reload its code and re-fire START (the editor's reboot button).
// Saving code no longer re-runs START on its own, so this is how an author asks
// for a fresh initialization on demand.
app.post(
  '/api/user/:userId/app/:appId/reboot',
  computeRateLimit,
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  async (req, res) => {
    const user = scopedUser(req);
    const app = scopedApp(req);

    await rebootInUserArenas(user.getId(), app.getId());
    res.status(200);
    res.send({
      name: app.getName(),
    });
  }
);

// Get app source code
app.get(
  '/api/user/:userId/app/:appId/source',
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  (req, res) => {
    const app = scopedApp(req);
    res.status(200);
    res.send(app.getSource());
  }
);

// Delete an app
app.delete(
  '/api/user/:userId/app/:appId',
  loadUser,
  requireOwner,
  loadApp,
  requireAppOwner,
  (req, res) => {
    const app = scopedApp(req);
    return deleteAppEverywhere(app).then(() => {
      res.status(200);
      res.send();
    });
  }
);

export default app;
