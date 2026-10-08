import {randomUUID} from 'node:crypto';
import {RepositoryManager} from './RepositoryManager.js';

/** Auth/Origin/Host validation happens in CargoBridgeServer before this router runs. */
export class RepositoryBridgeRouter {
  constructor(server, options) { this.server = server; this.manager = new RepositoryManager(options); this.operations = new Map(); }
  capabilities() { return {protocol: 1, kinds: ['local', 'remote'], allowedRoots: this.manager.allowedRoots,
    maxSessions: this.manager.maxSessions, maxJobs: this.manager.budget.capacity, interactiveStdin: true}; }
  async handle(request, response) {
    const reply = (code, body) => this.server.reply(response, code, body);
    if (request.method !== 'POST') return reply(405, {error: 'Expected POST'});
    if (!String(request.headers['content-type']).startsWith('application/json')) return reply(415, {error: 'Expected application/json'});
    let input;
    try { input = await this.server.body(request); } catch (error) { return reply(400, {error: error.message}); }
    if (request.url === '/v1/repository/cancel') {
      const operation = this.operations.get(input.operationId); operation?.controller.abort();
      return reply(200, {cancelled: !!operation});
    }
    if (request.url === '/v1/repository/input') {
      try { this.manager.input(input.id, input.text); return reply(200, {accepted: true}); }
      catch (error) { return reply(409, {error: error.message}); }
    }
    const methods = {'/v1/repository/open': 'open', '/v1/repository/run': 'run',
      '/v1/repository/list': 'list', '/v1/repository/language': 'language', '/v1/repository/reload': 'refresh', '/v1/repository/close': 'close'};
    const method = methods[request.url];
    if (!method) return reply(404, {error: 'Unknown repository endpoint'});
    if (this.operations.size >= 8) return reply(429, {error: 'Too many repository operations'});
    const id = randomUUID(), controller = new AbortController(); let bytes = 0;
    response.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    const emit = event => {
      if (response.destroyed) return;
      const line = JSON.stringify(event) + '\n'; bytes += Buffer.byteLength(line);
      if (bytes > 32 * 1024 * 1024 || response.writableLength > 4 * 1024 * 1024) {
        controller.abort(); response.destroy(); return;
      }
      response.write(line);
    };
    const closed = () => { if (!response.writableEnded) controller.abort(); }; response.on('close', closed);
    emit({type: 'started', operationId: id});
    const operation = Promise.resolve().then(() => method === 'close' ? this.manager.close(input.id) : this.manager[method](input, {
      signal: controller.signal, timeoutMs: Math.min(3600000, Math.max(1000, Number(input.timeoutMs) || 120000)),
      onEvent: event => emit({type: 'log', ...event})
    }));
    this.operations.set(id, {controller, operation});
    try { emit({type: 'result', result: await operation}); }
    catch (error) { emit({type: 'error', message: error.message, cancelled: controller.signal.aborted}); }
    finally { this.operations.delete(id); response.off('close', closed); if (!response.destroyed) response.end(); }
  }
  async dispose() {
    for (const {controller} of this.operations.values()) controller.abort();
    await Promise.allSettled([...this.operations.values()].map(value => value.operation));
    await this.manager.dispose();
  }
}
