import {AgentError} from '../core/AgentError.js';

/** Serialized compiler worker; abort/timeout destroys the worker, never merely ignores its output. */
export class BrowserCompiler {
  constructor({workerFactory = () => new Worker(new URL('../../ui/workers/agent-compiler-worker.bundle.js', import.meta.url)), timeoutMs = 30000} = {}) {
    this.workerFactory = workerFactory; this.timeoutMs = timeoutMs; this.queue = Promise.resolve(); this.sequence = 0; this.closed = false;
  }
  compile(files, command = 'check', options = {}, signal) {
    const snapshot = structuredClone(files), settings = structuredClone(options);
    const operation = this.queue.catch(() => {}).then(() => this.dispatch(snapshot, command, settings, signal));
    this.queue = operation; return operation;
  }
  dispatch(files, command, options, signal) {
    AgentError.abort(signal); if (this.closed) throw new AgentError('COMPILER_CLOSED', 'Browser compiler is closed');
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let settled = false, timer, worker;
      const finish = (error, value, terminate = false) => {
        if (settled) return; settled = true; clearTimeout(timer); signal?.removeEventListener('abort', abort);
        if (terminate) { this.worker?.terminate(); this.worker = null; }
        this.cancel = null; error ? reject(error) : resolve(value);
      };
      const abort = () => finish(signal.reason ?? new DOMException('Compiler cancelled', 'AbortError'), undefined, true);
      this.cancel = () => finish(new DOMException('Compiler closed', 'AbortError'), undefined, true);
      try { worker = this.worker ??= this.workerFactory(); }
      catch (error) { finish(error, undefined, true); return; }
      worker.onmessage = ({data}) => {
        if (data.id !== id) return;
        if (signal?.aborted) return abort();
        if (data.error) finish(Object.assign(new AgentError(data.error.code, data.error.message), data.error));
        else finish(null, data.build);
      };
      worker.onerror = event => { event.preventDefault?.(); finish(new AgentError('COMPILER_WORKER', 'Browser compiler worker failed to start or execute'), undefined, true); };
      worker.onmessageerror = () => finish(new AgentError('COMPILER_MESSAGE', 'Invalid compiler worker message'), undefined, true);
      timer = setTimeout(() => finish(new AgentError('COMPILER_TIMEOUT', 'Browser compiler operation exceeded its deadline'), undefined, true), this.timeoutMs);
      signal?.addEventListener('abort', abort, {once: true});
      try { worker.postMessage({id, files, command, options}); } catch (error) { finish(error, undefined, true); }
    });
  }
  async close() { this.closed = true; this.cancel?.(); this.worker?.terminate(); this.worker = null; await this.queue.catch(() => {}); }
}
