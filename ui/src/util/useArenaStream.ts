import { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import Arena from '../types/arena';
import App from '../types/app';
import PointInTime from '../types/pointInTime';
import applyArenaEvent from './arenaReducer';
import PlaybackBuffer from './playbackBuffer';
import { setPlaybackTime } from './playbackClock';
import { Emitter } from './emitter';

// High-frequency simulation events are played back through the jitter buffer on
// a steady local clock. Everything else (structural/control events: app & bot
// placement/removal, pause/resume/restart, renames, crashes) is applied the
// instant it arrives, so bootstrap and the toolbar controls stay responsive.
const CADENCE_EVENTS = new Set([
  'tick',
  'botTurn',
  'botAccelerate',
  'botStop',
  'turretTurn',
  'radarTurn',
  'radarScan',
  'botDamaged',
  'bulletFired',
  'bulletRemoved',
  'bulletExploded',
]);

export interface UseArenaStreamOptions {
  // REST snapshot endpoint (e.g. `/api/user/:id/arena`, `/api/demo/arena`, or the
  // public `/api/arena/:arenaId`). Fetched on mount and whenever it changes, plus
  // on every reconcile (reconnect / tab-visible / restart).
  snapshotUrl: string;
  // Absolute SSE events URL (include protocol + host). A fresh EventSource is
  // opened whenever this changes.
  eventsUrl: string;
  // Optional bus that receives every raw event (the main app forwards these to
  // the log console and other listeners). Spectators pass none.
  emitter?: Emitter;
  // Called when an `appRenamed` event arrives (the main app refetches the user so
  // the sidebar shows the new name). Spectators pass none.
  onAppRenamed?: () => void;
}

export interface ArenaStreamState {
  arena: Arena;
  time: number;
  isPaused: boolean;
  // True once a snapshot fetch has 404'd — the arena doesn't exist (bad share
  // link) or was disposed (GC'd ~30 min after it stopped). The public watch page
  // renders an "arena not found" message on this.
  notFound: boolean;
}

// Owns the arena data-plane shared by the main app and the public watch page: the
// REST snapshot bootstrap, the SSE event stream, the jitter buffer, and the
// requestAnimationFrame playback loop that interpolates smooth motion between
// server ticks. Extracted verbatim from App.tsx so both consumers stay in lockstep
// — the reconnect-reconcile and tab-visibility resync below fix real ghost-bot /
// fast-forward bugs; preserve them if you touch this.
export default function useArenaStream({
  snapshotUrl,
  eventsUrl,
  emitter,
  onAppRenamed,
}: UseArenaStreamOptions): ArenaStreamState {
  const [arena, setArena] = useState({
    clock: { time: 0 },
    apps: [] as App[],
  } as Arena);
  const [time, setTime] = useState(0);
  const [isPaused, setPaused] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const eventSource = useRef<EventSource | undefined>(undefined);

  // The jitter buffer plus refs the rAF playback loop reads, so the loop sees
  // the latest arena/time without being re-created on every render.
  const buffer = useRef(new PlaybackBuffer());
  const arenaRef = useRef(arena);
  arenaRef.current = arena;
  const timeRef = useRef(time);
  timeRef.current = time;

  // Latest callbacks without re-opening the stream when a parent re-renders.
  const emitterRef = useRef(emitter);
  emitterRef.current = emitter;
  const onAppRenamedRef = useRef(onAppRenamed);
  onAppRenamedRef.current = onAppRenamed;

  const doReloadArena = () => {
    console.log('reloading arena');
    // Any buffered motion belongs to the pre-reload arena; discard it.
    buffer.current.flush();
    return new Promise((resolve) => {
      axios
        .get(snapshotUrl)
        .then((res) => {
          setNotFound(false);
          setTime(res.data.clock.time);
          setPlaybackTime(res.data.clock.time);
          // Adopt the server's current simulation speed so playback runs at the
          // rate the arena is actually being simulated.
          if (typeof res.data.tickMs === 'number') {
            buffer.current.setTickMs(res.data.tickMs);
          }
          res.data.apps.forEach((app: App) =>
            app.bots.forEach((bot) => {
              bot.path = Array<PointInTime>(20);
              bot.path[0] = {
                x: bot.x,
                y: bot.y,
                time,
              };
              bot.pathIndex = 1;
            })
          );
          setArena(res.data);
          setPaused(!res.data.running);
          resolve(res.data);
        })
        .catch((err) => {
          // A 404 means the arena is gone (unknown id, or disposed after it
          // stopped). Surface it so a spectator page can show a friendly message
          // instead of a blank arena. Other errors (network blips) are left to
          // the SSE reconnect logic.
          if (err?.response?.status === 404) setNotFound(true);
          resolve(null);
        });
    });
  };

  useEffect(() => {
    doReloadArena();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapshotUrl]);

  // Playback loop: drain the jitter buffer on a steady local clock so buffered
  // simulation events are applied at an even cadence regardless of how bursty
  // their network arrival was. Mounted once; reads live state through refs.
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const frame = (now: number) => {
      // First frame establishes the baseline; clamp big gaps (e.g. a
      // backgrounded tab) so we catch up over frames instead of one spike.
      const dt = last === 0 ? 0 : Math.min(now - last, 250);
      last = now;

      let latestTick: number | null = null;
      buffer.current.drain(dt, (event) => {
        applyArenaEvent(arenaRef.current, event, timeRef.current);
        if (event.type === 'tick') latestTick = event.time;
      });
      // A tick advanced the clock — trigger the React re-render ArenaSvg needs,
      // and publish the displayed time so the log panel reveals lines in step.
      if (latestTick !== null) {
        setTime(latestTick);
        setPlaybackTime(latestTick);
      }

      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (eventSource.current) {
      eventSource.current.close();
      eventSource.current = undefined;
    }
    // A fresh stream replays current state; drop anything left from the old one.
    buffer.current.flush();
    const source = new EventSource(eventsUrl);
    eventSource.current = source;

    // On a *re*connect (network blip, laptop sleep/wake), the browser silently
    // reopens the stream and the server replays current placement — but any
    // structural events missed during the gap (removes, bullet lifecycle) are
    // lost, leaving ghosts or a stale arena. Reconcile from the authoritative
    // snapshot on every open after the first; the initial state is already
    // loaded by the doReloadArena effect, so skip that one.
    let hasOpened = false;
    source.onopen = () => {
      if (hasOpened) {
        buffer.current.flush();
        doReloadArena();
      }
      hasOpened = true;
    };

    source.onmessage = (message) => {
      const data = JSON.parse(message.data);
      emitterRef.current?.emit(data.type, data);

      // High-frequency simulation events: queue for steady playback. The rAF
      // loop applies them (and advances `time`) on its own cadence.
      if (CADENCE_EVENTS.has(data.type)) {
        buffer.current.push(data);
        return;
      }

      // Structural / control events: apply immediately.
      if (data.type === 'arenaPaused') {
        setPaused(true);
      } else if (data.type === 'arenaResumed') {
        setPaused(false);
      } else if (data.type === 'arenaSpeed') {
        // The server changed simulation speed; pace playback to match. Applied
        // immediately (not jitter-buffered) so the cadence tracks the server.
        buffer.current.setTickMs(data.tickMs);
        return;
      } else if (data.type === 'appRenamed') {
        onAppRenamedRef.current?.();
      } else if (data.type === 'arenaRestart') {
        // The arena is being rebuilt — drop buffered motion for the old one.
        buffer.current.flush();
        setPaused((isPaused) => {
          if (isPaused) doReloadArena();
          else setArena((arena) => ({ ...arena, apps: [] }));
          return isPaused;
        });
        return;
      }

      setArena((arena) => applyArenaEvent(arena, data, timeRef.current));
    };

    // Returning to a backgrounded tab: the rAF playback loop was suspended while
    // hidden, so the jitter buffer holds a stale backlog that would fast-forward
    // ("rapid update") when the loop resumes. Drop it and resync from the current
    // snapshot instead of replaying the backlog.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        buffer.current.flush();
        doReloadArena();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      source.close();
      eventSource.current = undefined;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eventsUrl]);

  return { arena, time, isPaused, notFound };
}
