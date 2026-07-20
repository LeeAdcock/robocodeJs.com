import { useState, useEffect, useSyncExternalStore } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import axios from 'axios';

import Logs from './logs';
import useLogsStream from '../../util/useLogsStream';
import {
  subscribePlaybackTime,
  getPlaybackTime,
} from '../../util/playbackClock';

export default function ArenaLogsPage() {
  const { userId } = useParams();
  // The log stream itself is shared app-wide (one SSE connection no matter how
  // many views consume it — this page, the editor's docked console).
  const logEntries = useLogsStream(userId);
  // ?app=<appId>&bot=<index> (from shift-double-clicking a bot in the arena)
  // filters to that specific bot instance.
  const [searchParams] = useSearchParams();
  const selectedApp = searchParams.get('app') ?? '';
  const botParam = searchParams.get('bot');
  const selectedBot = botParam ? Number(botParam) : undefined;
  // All bots currently in the arena, so the Bots filter is populated up front —
  // not only with bots that have already logged something.
  const [bots, setBots] = useState<
    { id: string; name: string; botCount: number; index: number }[]
  >([]);
  // The tick the arena has actually played up to; hold log lines until display
  // catches up so they appear alongside the motion they describe.
  const playbackTime = useSyncExternalStore(
    subscribePlaybackTime,
    getPlaybackTime
  );

  // Fetch the arena's current bots so the filter lists them all immediately.
  useEffect(() => {
    axios
      .get(`/api/user/${userId}/arena`)
      .then((res) =>
        setBots(
          (res.data.apps ?? []).map(
            (
              a: { id: string; name: string; bots?: unknown[] },
              index: number
            ) => ({
              id: a.id,
              name: a.name,
              botCount: a.bots?.length ?? 5,
              index,
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
        selectedBot={selectedBot}
        playbackTime={playbackTime}
        persistFiltersToUrl
      />
    </>
  );
}
