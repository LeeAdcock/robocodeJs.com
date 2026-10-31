// A minimal incremental Server-Sent Events parser: feed it text as it arrives
// and it returns the complete events' data payloads. Pure, so it is unit-tested
// apart from the network code in botLogs.ts. Comment lines (the server's
// keep-alive heartbeat) and fields other than `data` are ignored.
export class SseParser {
  private buffer = '';
  private data: string[] = [];

  feed(chunk: string): string[] {
    this.buffer += chunk;
    const events: string[] = [];
    let newline: number;
    while ((newline = this.buffer.search(/\r\n|\r|\n/)) !== -1) {
      const line = this.buffer.slice(0, newline);
      const width = this.buffer.startsWith('\r\n', newline) ? 2 : 1;
      this.buffer = this.buffer.slice(newline + width);
      if (line === '') {
        // A blank line dispatches the event built so far.
        if (this.data.length) events.push(this.data.join('\n'));
        this.data = [];
      } else if (line.startsWith('data:')) {
        this.data.push(line.slice(5).replace(/^ /, ''));
      }
    }
    return events;
  }
}
