import express from 'express';

import appService from '../services/AppService';
import compiler from '../util/compiler';
import {
  propagateSource,
  executeInUserArenas,
  rebootInUserArenas,
  deleteAppEverywhere,
} from '../util/botActions';

import {
  loadUser,
  requireOwner,
  loadApp,
  scopedUser,
  scopedApp,
} from '../middleware/resource';

const app = express();

// Get user apps
app.get('/api/user/:userId/apps', loadUser, async (req, res) => {
  const user = scopedUser(req);
  // TODO filter this response
  const apps = await appService.getForUser(user.getId());
  res.json(apps.map((app) => ({ id: app.getId(), name: app.getName() })));
});

// Create an app
app.post('/api/user/:userId/app/', loadUser, requireOwner, async (req, res) => {
  const user = scopedUser(req);
  const tankApp = await appService.create(user.getId());
  res.status(201);
  res.send({ appId: tankApp.getId() });
});

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
  loadUser,
  requireOwner,
  loadApp,
  (req, res) => {
    const app = scopedApp(req);
    // Saves are not gated on validity (authors save work-in-progress); the
    // editor's Check button / POST .../check dry-run surfaces errors separately.
    return propagateSource(app, req.body.toString('utf-8')).then(() => {
      res.status(200);
      res.send();
    });
  }
);

// Dry-run compile the posted source (the current editor buffer, which may be
// unsaved) in a throwaway isolate and return any syntax/load error — WITHOUT
// deploying it to an arena. Powers the editor's Check button.
app.post(
  '/api/user/:userId/app/:appId/check',
  loadUser,
  requireOwner,
  loadApp,
  async (req, res) => {
    const result = await compiler.check(req.body.toString('utf-8'));
    res.status(200);
    res.send(result);
  }
);

// Execute app source code
app.post(
  '/api/user/:userId/app/:appId/compile',
  loadUser,
  requireOwner,
  loadApp,
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
  loadUser,
  requireOwner,
  loadApp,
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
  (req, res) => {
    const app = scopedApp(req);
    return deleteAppEverywhere(app).then(() => {
      res.status(200);
      res.send();
    });
  }
);

export default app;
