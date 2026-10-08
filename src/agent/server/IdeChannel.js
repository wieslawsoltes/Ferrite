import {randomUUID} from 'node:crypto';
import {AgentError} from '../core/AgentError.js';

/** Request/reply channel to the single active browser IDE, with ownership and liveness checks. */
export class IdeChannel {
  constructor(events, {timeoutMs = 20000} = {}) { this.events = events; this.timeoutMs = timeoutMs; this.clientId = null; this.updated = 0; this.state = null; this.pending = new Map(); }
  connect() {
    if (this.clientId && Date.now() - this.updated < 15000) throw new AgentError('IDE_BUSY', 'Another IDE owns this bridge; disconnect it before connecting a second tab', {status: 409});
    if (this.clientId) this.disconnect(this.clientId);
    this.clientId = randomUUID(); this.updated = Date.now(); this.state = null; return this.clientId;
  }
  heartbeat(clientId, state) {
    if (clientId !== this.clientId) throw new AgentError('IDE_OWNER', 'IDE connection has expired', {status: 409});
    if (!state || typeof state !== 'object' || Array.isArray(state) || JSON.stringify(state).length > 200000) throw Error('Invalid IDE state');
    this.updated = Date.now(); this.state = structuredClone(state); return {connected: true};
  }
  inspect() { return {connected: !!this.clientId && Date.now() - this.updated < 15000, state: this.state, updatedAt: this.updated}; }
  request(command, args = {}, {signal, sessionId} = {}) {
    if (!this.inspect().connected) throw new AgentError('IDE_OFFLINE', 'Connect a Ferrite IDE to use editor, debugger and visualizer commands');
    if (this.pending.size >= 32) throw new AgentError('IDE_CAPACITY', 'Too many pending IDE requests');
    AgentError.abort(signal); const id = randomUUID(), clientId = this.clientId;
    return new Promise((resolve, reject) => {
      const finish = (error, result) => { clearTimeout(timer); signal?.removeEventListener('abort', abort); this.pending.delete(id); error ? reject(error) : resolve(result); };
      const abort = () => finish(new DOMException('IDE operation cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(new AgentError('IDE_TIMEOUT', 'The IDE did not answer before the deadline')), this.timeoutMs);
      this.pending.set(id, {clientId, finish}); signal?.addEventListener('abort', abort, {once: true});
      this.events.emit('ide.request', {id, clientId, sessionId, command, arguments: args});
    });
  }
  reply(clientId, id, result, error) {
    const request = this.pending.get(id); if (!request) return {expired: true};
    if (clientId !== request.clientId || clientId !== this.clientId) throw new AgentError('IDE_OWNER', 'Invalid IDE reply owner');
    request.finish(error ? new AgentError('IDE_COMMAND', String(error).slice(0, 2000)) : null, result); return {accepted: true};
  }
  disconnect(clientId) { if (clientId !== this.clientId) return; this.clientId = null; this.updated = 0; for (const request of [...this.pending.values()]) request.finish(new AgentError('IDE_OFFLINE', 'IDE disconnected')); }
  close() { this.disconnect(this.clientId); }
}
