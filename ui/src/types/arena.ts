import TankApp from './tankApp';

interface Clock {
  time: number;
}

export default interface Arena {
  apps: TankApp[];
  clock: Clock;
  height: number;
  width: number;
  // Current simulation speed the server is running this arena at: `speed` is the
  // multiplier (0 = unbounded), `tickMs` the matching ms/tick. Read-only in the UI
  // — set via the API/MCP tools; the client only adopts the rate for playback.
  speed?: number;
  tickMs?: number;
  // Tick at which the damage-free deployment window ends and turrets go live. The
  // UI shows a countdown while clock.time < deployTick.
  deployTick?: number;
}
