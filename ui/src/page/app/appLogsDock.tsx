// Collapsible log console docked at the bottom of the editor page (GitHub
// #317). The core debugging loop is edit → run → watch what the bot prints —
// this keeps the "watch" step inside the editor, auto-filtered to the app
// being edited, instead of a separate route. Reuses the full <Logs> component
// (it's prop-driven and deliberately Ace-free) over the shared app-wide log
// stream (useLogsStream — one SSE connection no matter how many views).
import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import Badge from 'react-bootstrap/Badge';
import { FaChevronDown, FaChevronUp, FaTerminal } from 'react-icons/fa';
import Logs from '../arena/logs';
import useLogsStream from '../../util/useLogsStream';
import {
  subscribePlaybackTime,
  getPlaybackTime,
} from '../../util/playbackClock';
import Arena from '../../types/arena';
import { Emitter } from '../../util/emitter';

const DOCK_HEIGHT_MIN = 120;
const DOCK_HEIGHT_MAX = 600;
const DOCK_HEIGHT_DEFAULT = 240;

// A bot crash as broadcast on the events stream (types/environment.ts
// reportFault). `line` is present when the sandbox could attribute one.
interface Fault {
  appId: string;
  code: string;
  message: string;
  line?: number;
}

interface AppLogsDockProps {
  userId: string;
  appId: string;
  // The live arena — names/positions for the Logs bot filter.
  arena: Arena;
  // The app-level event bus; `botFault` events land here.
  emitter: Emitter;
  // Scroll the editor to a fault's line and set the gutter marker (the same
  // path the red banner uses).
  onJumpToLine: (line: number, message: string) => void;
}

const clampHeight = (h: number) =>
  Math.max(DOCK_HEIGHT_MIN, Math.min(DOCK_HEIGHT_MAX, h));

export default function AppLogsDock(props: AppLogsDockProps) {
  // Collapsed by default; both the collapsed state and the panel height
  // persist like the editor's font-size preference.
  const [collapsed, setCollapsed] = useState(
    () => localStorage.getItem('logDockCollapsed') !== '0'
  );
  const [height, setHeight] = useState(() => {
    const saved = Number(localStorage.getItem('logDockHeight'));
    return saved >= DOCK_HEIGHT_MIN && saved <= DOCK_HEIGHT_MAX
      ? saved
      : DOCK_HEIGHT_DEFAULT;
  });
  useEffect(() => {
    localStorage.setItem('logDockCollapsed', collapsed ? '1' : '0');
  }, [collapsed]);
  useEffect(() => {
    localStorage.setItem('logDockHeight', String(height));
  }, [height]);

  const logEntries = useLogsStream(props.userId);
  const playbackTime = useSyncExternalStore(
    subscribePlaybackTime,
    getPlaybackTime
  );

  // Unread problems while collapsed: error/warn log lines from this app plus
  // faults. Cleared when the dock is opened — that's what "unread" means.
  const [unread, setUnread] = useState(0);
  const collapsedRef = useRef(collapsed);
  collapsedRef.current = collapsed;

  // Count new arrivals by walking the ring between the previous index and the
  // current one (the index only moves when an entry lands).
  const prevIndexRef = useRef(logEntries.index);
  useEffect(() => {
    const len = logEntries.logs.length;
    const prev = prevIndexRef.current;
    prevIndexRef.current = logEntries.index;
    if (!collapsedRef.current || len === 0) return;
    const delta = (logEntries.index - prev + len) % len;
    let problems = 0;
    for (let k = 0; k < delta; k++) {
      const e = logEntries.logs[(prev + k) % len];
      if (
        e &&
        e.appId === props.appId &&
        (e.levelName === 'error' || e.levelName === 'warn')
      )
        problems++;
    }
    if (problems > 0) setUnread((u) => u + problems);
  }, [logEntries, props.appId]);

  // Recent faults for this app (kept small — each is prominent), shown as
  // clickable rows so a crash is one click away from the offending line.
  const [faults, setFaults] = useState<Fault[]>([]);
  useEffect(() => {
    const listener = (event: unknown) => {
      const fault = event as Fault;
      if (fault.appId !== props.appId) return;
      setFaults((f) => [...f.slice(-2), fault]);
      if (collapsedRef.current) setUnread((u) => u + 1);
    };
    props.emitter.addListener('botFault', listener);
    return () => {
      props.emitter.removeListener('botFault', listener);
    };
  }, [props.emitter, props.appId]);

  const toggle = () => {
    if (collapsed) setUnread(0);
    setCollapsed(!collapsed);
  };

  // Drag the handle above the bar to resize the open panel.
  const startDrag = (e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = height;
    const onMove = (move: MouseEvent) =>
      setHeight(clampHeight(startHeight + (startY - move.clientY)));
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const bots = props.arena.apps.map((a, index) => ({
    id: a.id,
    name: a.name,
    botCount: a.bots?.length ?? 5,
    index,
  }));

  return (
    <div style={{ flexShrink: 0 }}>
      {!collapsed && (
        <div
          aria-label="Resize console"
          onMouseDown={startDrag}
          style={{
            height: '5px',
            cursor: 'ns-resize',
            borderTop: '1px solid var(--rule, #888)',
          }}
        />
      )}
      <div
        role="button"
        aria-label={collapsed ? 'Open console' : 'Close console'}
        aria-expanded={!collapsed}
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          cursor: 'pointer',
          padding: '3px 10px',
          fontSize: '0.85em',
          userSelect: 'none',
          borderTop: collapsed ? '1px solid var(--rule, #888)' : 'none',
        }}
      >
        <FaTerminal aria-hidden />
        Console
        {collapsed && unread > 0 && (
          <Badge bg="danger" aria-label={`${unread} unread problems`}>
            {unread}
          </Badge>
        )}
        <span style={{ marginLeft: 'auto' }}>
          {collapsed ? (
            <FaChevronUp aria-hidden />
          ) : (
            <FaChevronDown aria-hidden />
          )}
        </span>
      </div>
      {!collapsed && (
        <div
          style={{
            height: `${height}px`,
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Crash strip: faults carry the line/column the log lines don't, so
              these rows are the click-to-navigate path into the editor. */}
          {faults.length > 0 && (
            <div style={{ flexShrink: 0, fontSize: '0.85em' }}>
              {faults.map((fault, i) => (
                <div
                  key={`${fault.code}-${i}`}
                  role={fault.line !== undefined ? 'button' : undefined}
                  onClick={
                    fault.line !== undefined
                      ? () =>
                          props.onJumpToLine(
                            fault.line as number,
                            `${fault.code}: ${fault.message}`
                          )
                      : undefined
                  }
                  title={
                    fault.line !== undefined
                      ? 'Jump to this line in the editor'
                      : undefined
                  }
                  style={{
                    color: 'var(--bs-danger, #dc3545)',
                    cursor: fault.line !== undefined ? 'pointer' : 'default',
                    padding: '1px 10px',
                  }}
                >
                  {fault.code}: {fault.message}
                  {fault.line !== undefined ? ` (line ${fault.line})` : ''}
                </div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minHeight: 0 }}>
            <Logs
              bots={bots}
              selectedApp={props.appId}
              logEntries={logEntries}
              playbackTime={playbackTime}
            />
          </div>
        </div>
      )}
    </div>
  );
}
