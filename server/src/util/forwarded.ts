import { Request } from 'express';

// Shared state for request forwarding (GitHub #444, middleware/forward.ts),
// kept dependency-free so the rate limiters and the metrics heartbeat can read
// it without pulling in the services forwarding uses.

const FORWARDED = Symbol('forwarded');
type MaybeForwarded = Request & { [FORWARDED]?: { from: string } };

// Mark a request whose forwarding signature verified, from instance `from`.
export const markForwarded = (req: Request, from: string): void => {
  (req as MaybeForwarded)[FORWARDED] = { from };
};

// True when another instance forwarded this request and its signature
// verified. The IP-keyed rate limiters skip these: the edge already counted
// them against the client's IP.
export const isForwarded = (req: Request): boolean =>
  !!(req as MaybeForwarded)[FORWARDED];

export const forwardCounters = { forwarded: 0, failures: 0, misdirected: 0 };

//   forwardedRequests    requests this instance proxied to a user's home
//   forwardFailures      forwards answered 503 (home unreachable or failed)
//   misdirectedRequests  forwarded requests this instance refused with 421
//                        because it was no longer the user's home
export const forwardMetrics = () => ({
  forwardedRequests: forwardCounters.forwarded,
  forwardFailures: forwardCounters.failures,
  misdirectedRequests: forwardCounters.misdirected,
});
