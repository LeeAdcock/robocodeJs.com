import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import http from 'node:http';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import type { Request, Response } from 'express';
import { openSseStream, SSE_HEARTBEAT_MS, SseStream } from '../src/util/sse';

// A minimal stand-in for Express's Response: enough surface for openSseStream
// (writeHead/flushHeaders/write/end plus the 'close' event) while letting a test
// read exactly what was written, with no socket in the way.
class FakeRes extends EventEmitter {
  status = 0;
  headers: Record<string, string> = {};
  chunks: string[] = [];
  writableEnded = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.status = status;
    this.headers = headers;
    return this;
  }
  flushHeaders() {}
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.writableEnded = true;
    this.emit('close');
  }
  get text() {
    return this.chunks.join('');
  }
}

const fakeReq = (acceptEncoding?: string) =>
  ({
    headers: acceptEncoding ? { 'accept-encoding': acceptEncoding } : {},
  }) as unknown as Request;

const open = (res: FakeRes, acceptEncoding?: string) =>
  openSseStream(fakeReq(acceptEncoding), res as unknown as Response);

afterEach(() => {
  vi.useRealTimers();
});

describe('openSseStream headers', () => {
  it('opens the stream with the connect preamble and no no-transform', () => {
    const res = new FakeRes();
    open(res);

    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    // `no-transform` forbids intermediaries from compressing the body, which is
    // exactly what we now want to happen.
    expect(res.headers['Cache-Control']).toBe('no-cache');
    expect(res.headers['Cache-Control']).not.toContain('no-transform');
    expect(res.text).toBe(': connected\n\n');
  });

  it('does not compress when the client offers no gzip', () => {
    const res = new FakeRes();
    const stream = open(res, 'br, deflate');
    stream.send({ a: 1 });

    expect(res.headers['Content-Encoding']).toBeUndefined();
    // Plain writes, readable as-is.
    expect(res.text).toBe(': connected\n\ndata: {"a":1}\n\n');
  });

  it('compresses when the client offers gzip', () => {
    const res = new FakeRes();
    open(res, 'gzip, deflate, br');

    expect(res.headers['Content-Encoding']).toBe('gzip');
    expect(res.headers['Vary']).toBe('Accept-Encoding');
  });

  it('does not treat a token merely containing "gzip" as gzip support', () => {
    const res = new FakeRes();
    open(res, 'x-gzip-ish, identity');

    expect(res.headers['Content-Encoding']).toBeUndefined();
  });
});

describe('openSseStream heartbeat', () => {
  it('writes a ping comment on an idle stream well inside the 60s LB timeout', () => {
    expect(SSE_HEARTBEAT_MS).toBeLessThan(60_000);
    vi.useFakeTimers();
    const res = new FakeRes();
    open(res);

    expect(res.text).toBe(': connected\n\n');
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(res.text).toBe(': connected\n\n: ping\n\n');
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS);
    expect(res.text).toBe(': connected\n\n: ping\n\n: ping\n\n');
  });

  it('clears the heartbeat timer when the response closes', () => {
    vi.useFakeTimers();
    const res = new FakeRes();
    open(res);
    const withStream = vi.getTimerCount();
    expect(withStream).toBeGreaterThan(0);

    res.emit('close');

    // No leaked interval per dropped connection, and no further writes.
    expect(vi.getTimerCount()).toBe(withStream - 1);
    const before = res.text;
    vi.advanceTimersByTime(SSE_HEARTBEAT_MS * 3);
    expect(res.text).toBe(before);
  });

  it('clears the heartbeat timer when the route closes the stream', () => {
    vi.useFakeTimers();
    const res = new FakeRes();
    const stream = open(res);
    const withStream = vi.getTimerCount();

    stream.close();

    expect(vi.getTimerCount()).toBe(withStream - 1);
    expect(res.writableEnded).toBe(true);
  });

  it('never lets the heartbeat hold the process open', () => {
    vi.useFakeTimers();
    const unref = vi.fn();
    const real = globalThis.setInterval;
    const spy = vi.spyOn(globalThis, 'setInterval').mockImplementation(((
      ...args: Parameters<typeof setInterval>
    ) => {
      const timer = real(...args);
      return Object.assign(timer, { unref });
    }) as typeof setInterval);

    open(new FakeRes());
    expect(unref).toHaveBeenCalled();
    spy.mockRestore();
  });
});

// The flush guarantee, end to end over a real socket: a compressor buffers by
// default, so without an explicit sync flush an event would sit in the deflate
// window and the live arena view would stall. Asserting "the bytes arrive
// eventually" would not catch that — the stream has to still be open when the
// event lands.
describe('openSseStream over a real connection', () => {
  const serve = async (acceptEncoding?: string) => {
    let stream: SseStream | undefined;
    const server = http.createServer((req, res) => {
      stream = openSseStream(req as Request, res as unknown as Response);
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;

    const res = await new Promise<http.IncomingMessage>((resolve) => {
      http
        .get(
          {
            port,
            path: '/',
            headers: acceptEncoding
              ? { 'accept-encoding': acceptEncoding }
              : {},
          },
          resolve
        )
        .end();
    });

    let text = '';
    let ended = false;
    const body =
      res.headers['content-encoding'] === 'gzip'
        ? res.pipe(zlib.createGunzip())
        : res;
    body.on('data', (c: Buffer) => (text += c.toString()));
    res.on('end', () => (ended = true));

    const waitFor = async (needle: string) => {
      for (let i = 0; i < 200; i++) {
        if (text.includes(needle)) return;
        await new Promise((r) => setTimeout(r, 10));
      }
      throw new Error(`timed out waiting for ${needle}; got: ${text}`);
    };

    return {
      res,
      get text() {
        return text;
      },
      get ended() {
        return ended;
      },
      waitFor,
      send: (event: unknown) => stream!.send(event),
      stop: async () => {
        stream?.close();
        res.destroy();
        // Keep-alive would otherwise hold server.close() open for seconds.
        server.closeAllConnections();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      },
    };
  };

  it('delivers a gzipped event promptly while the stream stays open', async () => {
    const c = await serve('gzip');
    expect(c.res.headers['content-encoding']).toBe('gzip');

    await c.waitFor(': connected');
    // Nothing has been sent yet, so the client must be sitting on the preamble.
    expect(c.ended).toBe(false);

    c.send({ type: 'tick', time: 1 });
    await c.waitFor('data: {"type":"tick","time":1}');
    // The event arrived without the response finishing — proof the compressor
    // was flushed rather than drained at end-of-stream.
    expect(c.ended).toBe(false);

    c.send({ type: 'tick', time: 2 });
    await c.waitFor('data: {"type":"tick","time":2}');
    expect(c.ended).toBe(false);

    await c.stop();
  });

  it('delivers events uncompressed when gzip is not offered', async () => {
    const c = await serve('identity');
    expect(c.res.headers['content-encoding']).toBeUndefined();

    await c.waitFor(': connected');
    c.send({ type: 'tick', time: 1 });
    await c.waitFor('data: {"type":"tick","time":1}');
    expect(c.ended).toBe(false);

    await c.stop();
  });
});
