// Shared client store for the arena's bot-console log stream (SSE /arena/logs).
//
// The stream used to be owned by the logs page's component state, which meant a
// second consumer (the editor's docked console) would open a second server
// connection and start with an empty buffer. This module hoists the stream to a
// singleton, the same pattern as playbackClock: one EventSource per arena no
// matter how many views are mounted, one shared ring buffer, and a
// useSyncExternalStore-compatible subscribe/getSnapshot pair.
//
// The server replays its recent-logs buffer on every connect (api/arena.ts), so
// a consumer that mounts mid-match — or the store reconnecting after all
// consumers unmounted — starts with history already present. Replayed lines
// that are already in the ring are dropped by id, so reconnects don't duplicate.

import { useEffect, useSyncExternalStore } from 'react';

export interface LogEntry {
  id: string;
  name: string;
  appId: string;
  botIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
}

export interface LogEntries {
  logs: (LogEntry | null)[];
  index: number;
}

// Client-side ring capacity. Matches the server's default replay depth
// (Environment.MAX_RECENT_LOGS = 1500) so a page open doesn't silently discard
// the oldest two-thirds of the history the server just sent.
const BUFFER_SIZE = 1500;

const emptyBuffer = (): LogEntries => ({
  logs: new Array<LogEntry | null>(BUFFER_SIZE).fill(null),
  index: 0,
});

let state: LogEntries = emptyBuffer();
// Ids currently held in the ring, so replayed history (server resends its
// buffer on every connect) isn't appended twice.
const heldIds = new Set<string>();
const listeners = new Set<() => void>();
let source: EventSource | undefined;
let streamUserId: string | undefined;
let consumers = 0;

const notify = () => listeners.forEach((listener) => listener());

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = () => state;

function open(userId: string) {
  source?.close();
  // A different arena's stream: the buffered lines belong to the old one.
  if (streamUserId !== userId) {
    state = emptyBuffer();
    heldIds.clear();
    notify();
  }
  streamUserId = userId;
  source = new EventSource(
    `${window.location.protocol}//${window.location.host}/api/user/${userId}/arena/logs`
  );
  source.onmessage = (message) => {
    const entry = JSON.parse(message.data) as LogEntry;
    if (!entry.id || heldIds.has(entry.id)) return;
    const evicted = state.logs[state.index];
    if (evicted) heldIds.delete(evicted.id);
    heldIds.add(entry.id);
    state.logs[state.index] = entry;
    state = { logs: state.logs, index: (state.index + 1) % state.logs.length };
    notify();
  };
}

// Subscribe this component to the (shared) log stream for the given user's
// arena. The connection is ref-counted: opened by the first consumer, closed
// when the last unmounts. The buffer survives a close, and the reopen's replay
// fills any gap (bounded by the server's own buffer depth).
export default function useLogsStream(userId: string | undefined): LogEntries {
  useEffect(() => {
    if (!userId) return;
    consumers++;
    if (!source || streamUserId !== userId) open(userId);
    return () => {
      consumers--;
      if (consumers === 0) {
        source?.close();
        source = undefined;
      }
    };
  }, [userId]);
  return useSyncExternalStore(subscribe, getSnapshot);
}
