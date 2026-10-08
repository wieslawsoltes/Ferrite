/** Persistent worker owns caches. Latest-request scheduling prevents stale editor results. */
export class CompilationService {
  constructor({workerFactory = () => new Worker(new URL('../workers/compile-worker.bundle.js', import.meta.url)), deadline = 12000} = {}) {
    this.workerFactory = workerFactory; this.deadline = deadline; this.sequence = 0; this.worker = null; this.active = null; this.pending = null;
  }
  request(files, command, options, revision) {
    return new Promise((resolve, reject) => {
      const task = {id: ++this.sequence, files: {...files}, command, options, revision, resolve, reject};
      if (this.pending) this.pending.reject(new DOMException('Superseded', 'AbortError'));
      if (this.active) this.pending = task; else this.start(task);
    });
  }
  start(task) {
    this.active = task;
    try {
      if (!this.worker) {
        const worker = this.workerFactory(); this.worker = worker;
        worker.onmessage = event => { if (this.worker === worker) this.finish(event.data); };
        worker.onerror = event => { if (this.worker === worker) this.fail(Error(event.message || 'Compiler worker failed')); };
        worker.onmessageerror = () => { if (this.worker === worker) this.fail(Error('Compiler response could not be decoded')); };
      }
      this.timer = setTimeout(() => this.fail(Error('Compiler time budget exceeded')), this.deadline);
      this.worker.postMessage({id: task.id, files: task.files, command: task.command, options: task.options, revision: task.revision});
    } catch (error) { this.fail(error); }
  }

  finish(message) {
    if (!message || message.id !== this.active?.id) return;
    clearTimeout(this.timer); const task = this.active; this.active = null;
    if (message.error) task.reject(Object.assign(Error(message.error.message), message.error));
    else task.resolve({build: message.build, revision: task.revision});
    if (this.pending) { const pending = this.pending; this.pending = null; this.start(pending); }
  }
  fail(error) {
    this.worker?.terminate(); this.worker = null; clearTimeout(this.timer);
    this.active?.reject(error); this.active = null;
    if (this.pending) { const task = this.pending; this.pending = null; this.start(task); }
  }
  cancel() {
    const error = new DOMException('Cancelled', 'AbortError'); this.pending?.reject(error); this.pending = null;
    this.worker?.terminate(); this.worker = null; clearTimeout(this.timer); this.active?.reject(error); this.active = null;
  }
}
