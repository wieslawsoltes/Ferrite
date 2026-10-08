import {StringDecoder} from 'node:string_decoder';

/** MCP newline-delimited UTF-8 JSON-RPC. Stdout is reserved for protocol messages only. */
export class StdioTransport {
  constructor(handler, {input = process.stdin, output = process.stdout, maxBytes = 12 * 1024 * 1024} = {}) { this.handler = handler; this.input = input; this.output = output; this.maxBytes = maxBytes; this.pending = new Set(); this.closed = false; }
  async run() {
    const decoder = new StringDecoder('utf8'); let buffer = '';
    const respond = value => { if (value !== null && !this.closed) { const text = JSON.stringify(value) + '\n'; if (this.output.writableLength > 32 * 1024 * 1024) throw Error('MCP output backpressure limit reached'); this.output.write(text); } };
    const dispatch = line => {
      if (!line.trim()) return;
      if (this.pending.size >= 64) throw Error('Too many pending MCP requests');
      let request; try { request = JSON.parse(line); } catch { respond({jsonrpc: '2.0', id: null, error: {code: -32700, message: 'Parse error'}}); return; }
      const task = Promise.resolve().then(() => this.handler(request)).then(respond).catch(() => respond({jsonrpc: '2.0', id: request?.id ?? null, error: {code: -32603, message: 'Internal transport error'}})).finally(() => this.pending.delete(task));
      this.pending.add(task);
    };
    try {
      for await (const chunk of this.input) {
        buffer += decoder.write(Buffer.from(chunk)); if (Buffer.byteLength(buffer) > this.maxBytes) throw Error('MCP input exceeds 12 MiB');
        let end; while ((end = buffer.indexOf('\n')) >= 0) { dispatch(buffer.slice(0, end)); buffer = buffer.slice(end + 1); }
      }
      buffer += decoder.end(); if (buffer.trim()) dispatch(buffer);
      await Promise.allSettled(this.pending);
    } finally { this.closed = true; }
  }
}
