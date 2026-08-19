import type { Request, Response } from 'express';
import zlib from 'node:zlib';

// How often to write a no-op SSE comment on an otherwise idle stream. An arena
// that isn't emitting sends nothing for minutes at a time, and the production
// load balancer drops a connection that has been idle for 60s — which the
// browser's EventSource then reconnects, and for /arena/logs each reconnect
// replays the whole recent-logs buffer. A quiet prod hour was measured at ~57
// reconnects per stream. 25s keeps every stream comfortably under that timeout
// with room for one lost tick.
export const SSE_HEARTBEAT_MS = 25_000;

// A writable handle on an open SSE stream. Call sites go through this rather
// than touching `res` so framing, compression and flushing stay in one place.
export interface SseStream {
  // Frame a value as an SSE `data:` event and flush it to the client.
  send(event: unknown): void;
  // Write an SSE comment line (`: text`). Invisible to EventSource consumers;
  // used for the connect preamble and the keep-alive heartbeat.
  comment(text: string): void;
  // Finish the response (ending the compressor first, when there is one).
  close(): void;
}

// True only for a real `gzip` token in Accept-Encoding — not for a codings name
// that merely contains it (e.g. `x-gzip-ish`).
const acceptsGzip = (req: Request): boolean =>
  /(^|,)\s*gzip\s*(;|,|$)/i.test(String(req.headers['accept-encoding'] ?? ''));

// Opens a Server-Sent Events stream: headers that discourage buffering by
// intermediaries (dev tunnels, nginx, load balancers), gzip when the client
// offers it, a keep-alive heartbeat, and flushed headers so the browser sees
// the stream open right away rather than after the first batch of events.
//
//  - `X-Accel-Buffering: no` disables proxy response buffering where respected
//    (nginx). Note `Cache-Control` deliberately does NOT carry `no-transform`:
//    that directive forbids any intermediary from compressing the body, which
//    is the opposite of what we want now that we compress it ourselves.
//  - the initial comment line nudges proxies to flush the response start
//
// Compression matters a lot here: SSE bodies are long-lived streams of highly
// repetitive JSON, so gzip is worth several-fold on the arena log stream. The
// catch is that a compressor buffers by default — every write is flushed with
// Z_SYNC_FLUSH so an event reaches the client on the tick it was emitted rather
// than whenever the deflate window happens to fill.
export function openSseStream(req: Request, res: Response): SseStream {
  const gzipped = acceptsGzip(req);

  const headers: Record<string, string> = {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  };
  if (gzipped) {
    headers['Content-Encoding'] = 'gzip';
    headers.Vary = 'Accept-Encoding';
  }
  res.writeHead(200, headers);
  // flushHeaders exists on Node's ServerResponse; guard for safety in tests.
  res.flushHeaders?.();

  // Z_SYNC_FLUSH as the stream's default flush flag makes every write emit a
  // complete, immediately-decodable block. Without it events would sit in the
  // compressor and the live arena view would stall.
  const gzip = gzipped
    ? zlib.createGzip({ flush: zlib.constants.Z_SYNC_FLUSH })
    : undefined;
  if (gzip) {
    // A client that disappears mid-write surfaces as an EPIPE on the pipe; the
    // stream is being torn down anyway, so swallow it rather than crash.
    gzip.on('error', () => {});
    gzip.pipe(res);
  }

  let closed = false;
  let ended = false;
  const write = (chunk: string) => {
    if (closed || res.writableEnded) return;
    if (gzip) gzip.write(chunk);
    else res.write(chunk);
  };

  const stream: SseStream = {
    send: (event: unknown) => write('data: ' + JSON.stringify(event) + '\n\n'),
    comment: (text: string) => write(': ' + text + '\n\n'),
    close: () => {
      if (closed) return;
      closed = true;
      ended = true;
      clearInterval(heartbeat);
      // Ending the compressor flushes its tail and (via the pipe) ends `res`.
      if (gzip) gzip.end();
      else res.end();
    },
  };

  // Owned here rather than at each call site: a leaked interval per dropped
  // connection would be a slow resource leak across thousands of reconnects.
  // unref() so a live stream can never hold the process open against the
  // graceful-shutdown path in index.ts.
  const heartbeat = setInterval(() => stream.comment('ping'), SSE_HEARTBEAT_MS);
  heartbeat.unref?.();
  res.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    // The client vanished without the route's own teardown running (or before
    // it did): release the compressor's native handle rather than wait for GC.
    if (!ended) gzip?.destroy();
  });

  stream.comment('connected');
  return stream;
}
