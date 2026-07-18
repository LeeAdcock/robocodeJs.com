import App from './app';

interface Clock {
  time: number;
}

export default interface Arena {
  // The arena's UUID (present on the status snapshot). Used to build the public
  // "watch" share link. Optional because the initial placeholder arena state in
  // App.tsx is created before the first snapshot loads.
  id?: string;
  apps: App[];
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
  // How many bots each app fields (1–5) — the configured setting, not the live
  // count (bots die). From the snapshot / `arenaBotCount` event; the toolbar's
  // quantity control sets it via the API.
  botCount?: number;
}
