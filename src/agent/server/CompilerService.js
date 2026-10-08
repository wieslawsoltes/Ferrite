import {Worker} from 'node:worker_threads';
import {AgentError} from '../core/AgentError.js';

/** Keep synchronous compiler analysis off the bridge event loop; terminate pathological builds. */
export class CompilerService {
  constructor({timeoutMs = 15000, workerFactory = () => new Worker(new URL('./CompilerWorker.js', import.meta.url))} = {}) { this.timeoutMs = timeoutMs; this.workerFactory = workerFactory; this.worker = null; this.sequence = 0; this.queue = Promise.resolve(); }
  compile(files, command = 'check', options = {}, signal) {
    const operation = this.queue.catch(() => {}).then(() => new Promise((resolve, reject) => {
      try { AgentError.abort(signal); this.worker ??= this.workerFactory(); } catch (error) { reject(error); return; }
      const worker = this.worker, id = ++this.sequence;
      const finish = (error, result, terminate = false) => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); worker.off('message', message); worker.off('error', fail); worker.off('exit', exit);
        if (terminate) { this.worker = null; worker.terminate().catch(() => {}); }
        error ? reject(error) : resolve(result);
      };
      const abort = () => finish(new DOMException('Compilation cancelled', 'AbortError'), null, true);
      const fail = error => finish(error, null, true), exit = code => fail(Error(`Compiler worker exited (${code})`));
      const message = value => { if (value.id !== id) return; finish(value.error ? Object.assign(new Error(value.error.message), value.error) : null, value.build); };
      const timer = setTimeout(() => finish(new AgentError('COMPILER_TIMEOUT', 'Compiler exceeded the time budget'), null, true), this.timeoutMs);
      signal?.addEventListener('abort', abort, {once: true}); worker.on('message', message); worker.once('error', fail); worker.once('exit', exit);
      try { worker.postMessage({id, files, command, options}); } catch (error) { fail(error); }
    }));
    this.queue = operation; return operation;
  }
  async close() { await this.queue.catch(() => {}); await this.worker?.terminate(); this.worker = null; }
}
