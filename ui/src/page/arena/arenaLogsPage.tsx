import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import Logs from './logs';
import {
  subscribePlaybackTime,
  getPlaybackTime,
} from '../../util/playbackClock';

interface LogEntry {
  id: string;
  name: string;
  appId: string;
  tankIndex: number;
  level: number;
  levelName: string;
  msg: string;
  time: number;
}

interface LogEntries {
  logs: (LogEntry | null)[];
  index: number;
}

export default function ArenaLogsPage() {
  const [logEntries, setLogEntries] = useState({
    logs: new Array(500) as LogEntry[],
    index: 0,
  } as LogEntries);
  const { userId } = useParams();
  // ?app=<appId>&tank=<index> (from shift-double-clicking a tank in the arena)
  // filters to that specific tank instance.
  const [searchParams] = useSearchParams();
  const selectedApp = searchParams.get('app') ?? '';
  const tankParam = searchParams.get('tank');
  const selectedTank = tankParam ? Number(tankParam) : undefined;
  // All bots currently in the arena, so the Bots filter is populated up front —
  // not only with bots that have already logged something.
  const [bots, setBots] = useState<
    { id: string; name: string; tankCount: number }[]
  >([]);
  const eventSource = useRef<EventSource | undefined>(undefined);
  // The tick the arena has actually played up to; hold log lines until display
  // catches up so they appear alongside the motion they describe.
  const playbackTime = useSyncExternalStore(
    subscribePlaybackTime,
    getPlaybackTime
  );

  useEffect(() => {
    if (eventSource.current) {
      eventSource.current.close();
      eventSource.current = undefined;
    }
    const source = new EventSource(
      `${window.location.protocol}//${window.location.host}/api/user/${userId}/arena/logs`
    );
    eventSource.current = source;

    source.onmessage = (message) => {
      setLogEntries((oldLogs) => {
        const logEntry = JSON.parse(message.data) as LogEntry;
        oldLogs.logs[oldLogs.index] = logEntry;
        return {
          logs: oldLogs.logs,
          index: (oldLogs.index + 1) % oldLogs.logs.length,
        };
      });
    };

    return () => {
      source.close();
      eventSource.current = undefined;
    };
  }, [userId]);

  // Fetch the arena's current bots so the filter lists them all immediately.
  useEffect(() => {
    axios
      .get(`/api/user/${userId}/arena`)
      .then((res) =>
        setBots(
          (res.data.apps ?? []).map(
            (a: { id: string; name: string; tanks?: unknown[] }) => ({
              id: a.id,
              name: a.name,
              tankCount: a.tanks?.length ?? 5,
            })
          )
        )
      )
      .catch(() => setBots([]));
  }, [userId]);

  return (
    <>
      <Logs
        logEntries={logEntries}
        bots={bots}
        selectedApp={selectedApp}
        selectedTank={selectedTank}
        playbackTime={playbackTime}
      />
    </>
  );
}
