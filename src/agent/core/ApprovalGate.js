import {randomUUID} from './Platform.js';
import {AgentError} from './AgentError.js';

/** Human approvals are one-shot, session-scoped, expiring, and never supplied by model input. */
export class ApprovalGate {
  constructor(events, {timeoutMs = 300000} = {}) { this.events = events; this.timeoutMs = timeoutMs; this.pending = new Map(); }
  async authorize(tool, args, context, preview) {
    const risk = typeof tool.risk === 'function' ? tool.risk(args) : tool.risk;
    if (risk === 'read' || risk === 'plan') return;
    if (context.mode === 'read-only') throw new AgentError('READ_ONLY', `${tool.name} is unavailable in read-only mode`);
    if (context.mode === 'trusted' || context.allow?.has(risk) || context.mode === 'auto-edit' && risk === 'edit') return;
    if (context.interactive !== true) throw new AgentError('APPROVAL_REQUIRED', `${tool.name} requires ${risk} approval; use the IDE or explicitly allow this risk when starting MCP`);
    AgentError.abort(context.signal);
    const id = randomUUID(), request = {id, sessionId: context.sessionId, tool: tool.name, risk, arguments: args, preview, expiresAt: Date.now() + this.timeoutMs};
    return new Promise((resolve, reject) => {
      const finish = (approved, reason) => {
        clearTimeout(timer); context.signal?.removeEventListener('abort', abort); this.pending.delete(id);
        this.events.emit('approval.resolved', {id, sessionId: context.sessionId, approved, reason});
        approved ? resolve() : reject(new AgentError('APPROVAL_DENIED', reason ?? 'The user declined this operation'));
      };
      const abort = () => finish(false, 'Operation cancelled');
      const timer = setTimeout(() => finish(false, 'Approval expired'), this.timeoutMs); timer.unref?.();
      this.pending.set(id, {request, finish}); context.signal?.addEventListener('abort', abort, {once: true});
      this.events.emit('approval.requested', request);
    });
  }
  resolve(id, approved) {
    if (typeof approved !== 'boolean') throw new AgentError('INVALID_APPROVAL', 'Approval must be a boolean');
    const pending = this.pending.get(id); if (!pending) throw new AgentError('APPROVAL_EXPIRED', 'This approval no longer exists', {status: 404});
    pending.finish(approved); return {approved};
  }
  list() { return [...this.pending.values()].map(value => value.request); }
  close() { for (const pending of [...this.pending.values()]) pending.finish(false, 'Bridge stopped'); }
}
