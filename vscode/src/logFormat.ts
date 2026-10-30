// Formatting for the Bot Logs output channel. Pure (no vscode import).

// One bot console record as the server streams it (a bunyan record plus the
// fields compiler.ts adds): `time` is the arena tick, `id` increases
// monotonically within the arena and survives match restarts.
export interface LogEntry {
  id: number;
  level: number;
  msg?: string;
  appId?: string;
  botIndex?: number;
  time?: number;
}

const LEVELS: [number, string][] = [
  [60, 'FATAL'],
  [50, 'ERROR'],
  [40, 'WARN'],
  [30, 'INFO'],
  [20, 'DEBUG'],
  [10, 'TRACE'],
];

export const levelName = (level: number): string =>
  LEVELS.find(([n]) => level >= n)?.[1] ?? 'TRACE';

export const isErrorLevel = (level: number): boolean => level >= 50;

// e.g. "[t=1234] Sweeper #2  WARN  low on health"
export const formatLogLine = (entry: LogEntry, appName?: string): string => {
  const who = `${appName ?? entry.appId?.slice(0, 8) ?? '?'} #${entry.botIndex ?? '?'}`;
  return `[t=${entry.time ?? '?'}] ${who}  ${levelName(entry.level).padEnd(5)}  ${entry.msg ?? ''}`;
};
