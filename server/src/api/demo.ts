import express from 'express';
import arenaMemberService from '../services/ArenaMemberService';
import demoService from '../services/DemoService';
import { openSseStream } from '../util/sse';
import { buildArenaStatus } from '../util/arenaStatus';
const app = express();

// Listen to an arena
app.get('/api/demo/events', async (req, res) => {
  openSseStream(res);

  function listener(event: unknown) {
    res.write('data: ' + JSON.stringify(event) + '\n\n');
  }

  return demoService.getDemoEnvironment().then((env) => {
    env.addListener('event', listener);
    req.on('close', () => {
      env.removeListener('event', listener);
      res.end();
    });
  });
});

// Get an arena status
app.get('/api/demo/arena/', async (req, res) => {
  const env = await demoService.getDemoEnvironment();
  const arena = env.getArena();
  const members = await arenaMemberService.getForArena(arena.getId());

  res.status(200);
  res.send(await buildArenaStatus(env, members));
});

export default app;
