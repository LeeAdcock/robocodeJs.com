import { Response } from 'express';

// Opens a Server-Sent Events stream with headers that discourage buffering by
// intermediaries (dev tunnels, nginx, load balancers), and flushes the headers
// immediately so the browser sees the stream open right away rather than after
// the first batch of events.
//
//  - `no-transform` tells proxies not to buffer/modify the body
//  - `X-Accel-Buffering: no` disables proxy buffering where respected (nginx)
//  - the initial comment line nudges proxies to flush the response start
export function openSseStream(res: Response): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  // flushHeaders exists on Node's ServerResponse; guard for safety in tests.
  res.flushHeaders?.();
  res.write(': connected\n\n');
}
