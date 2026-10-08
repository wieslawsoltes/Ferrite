import {randomUUID} from '../core/Platform.js';
import {AgentError} from '../core/AgentError.js';

/** Human answers are task data, never approvals or permission changes. */
export class QuestionGate {
  constructor(events, {timeoutMs = 300000} = {}) { this.events = events; this.timeoutMs = timeoutMs; this.pending = new Map(); }
  ask(question, options, context) {
    AgentError.abort(context.signal);
    if (!context.interactive) throw new AgentError('QUESTION_INTERACTIVE', 'This task cannot ask the local user');
    if (this.pending.size >= 8) throw Error('Too many unanswered questions');
    const id = randomUUID(), request = {id, question, options, sessionId: context.sessionId};
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (answer, error) => {
        if (settled) return; settled = true; clearTimeout(timer); context.signal?.removeEventListener('abort', abort); this.pending.delete(id);
        this.events.emit('question.resolved', {id, sessionId: context.sessionId, cancelled: !!error}); error ? reject(error) : resolve({answer, grantsPermissions: false});
      };
      const abort = () => finish(null, new DOMException('Question cancelled', 'AbortError'));
      const timer = setTimeout(() => finish(null, new AgentError('QUESTION_EXPIRED', 'The local question expired')), this.timeoutMs); timer.unref?.();
      this.pending.set(id, {request, finish}); context.signal?.addEventListener('abort', abort, {once: true}); this.events.emit('question.requested', request);
    });
  }
  answer(id, answer) { if (typeof answer !== 'string' || !answer.trim() || answer.length > 16000) throw Error('Enter an answer up to 16000 characters'); const entry = this.pending.get(id); if (!entry) throw Error('This question is no longer pending'); entry.finish(answer); return {answered: true}; }
  list() { return [...this.pending.values()].map(entry => entry.request); }
  close() { for (const entry of this.pending.values()) entry.finish(null, new DOMException('Question cancelled', 'AbortError')); }
}
