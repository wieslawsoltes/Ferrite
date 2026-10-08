/** Persistent, bounded CPU workers. Cache adoption is ordered, never completion-order-dependent. */
export class ParserWorkerPool {
  constructor({workerFactory, deadline = 12000} = {}) {
    this.workerFactory = workerFactory; this.deadline = deadline; this.slots = []; this.sequence = 0; this.active = false;
  }
  slot(index) {
    if (this.slots[index]) return this.slots[index];
    const worker = this.workerFactory(), slot = {worker, current: null};
    const finish = (error, data) => {
      const task = slot.current; if (!task || (data && data.id !== task.id)) return;
      clearTimeout(task.timer); slot.current = null;
      error ? task.reject(error) : task.resolve(data);
    };
    worker.onmessage = event => finish(null, event.data);
    worker.onerror = event => finish(Error(event.message || 'Parser worker failed'));
    worker.onmessageerror = () => finish(Error('Parser worker response could not be decoded'));
    this.slots[index] = slot; return slot;
  }
  execute(slot, file, source) {
    return new Promise((resolve, reject) => {
      const id = ++this.sequence;
      const timer = setTimeout(() => { slot.current = null; reject(Error('Parser worker time budget exceeded')); }, this.deadline);
      slot.current = {id, timer, resolve, reject};
      try { slot.worker.postMessage({id, file, source}); }
      catch (error) { clearTimeout(timer); slot.current = null; reject(error); }
    });
  }
  async prewarm(files, cache, {workers = 4, signal, threshold = 4096} = {}) {
    signal?.throwIfAborted();
    workers = Number(workers);
    if (!Number.isInteger(workers) || workers < 1 || workers > 8) throw Error('Browser parser workers must be 1..8');
    if (this.active) throw Error('Parser pool is already compiling');
    const entries = Object.entries(files).filter(([file, source]) => file.endsWith('.rs') && !cache.has(file, source)).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0);
    const count = Math.min(workers, entries.length), start = performance.now();
    const report = {requestedWorkers: workers, usedWorkers: 0, peakActiveTasks: 0, parsedFiles: 0, taskMs: 0, wallMs: 0, tasks: [],
      orderedStages: ['module resolution', 'type and trait analysis', 'ownership checking', 'MIR verification', 'code generation']};
    // Avoid worker startup/clone overhead for small edits; normal serial compilation
    // remains the exact reference path, not a different semantic implementation.
    if (count < 2 || entries.reduce((n, [, source]) => n + source.length, 0) < threshold) return report;
    // Longest-first dispatch reduces the tail of uneven files; commit order remains filename order.
    const work=entries.map(([file,source],index)=>({file,source,index})).sort((a,b)=>b.source.length-a.source.length||a.index-b.index);
    this.active = true; let cursor = 0, running = 0, stopped = false; const results = new Array(entries.length);
    const abort = () => { stopped=true;this.dispose(signal.reason ?? new DOMException('Cancelled', 'AbortError')); };
    signal?.addEventListener('abort', abort, {once: true});
    try {
      signal?.throwIfAborted();
      const lanes = Array.from({length: count}, (_, index) => this.slot(index));
      report.usedWorkers = count;
      await Promise.all(lanes.map(async (slot, lane) => {
        for (;;) {
          signal?.throwIfAborted();if(stopped)return;
          const next=work[cursor++];if(!next)return;
          const {file,source,index}=next,begin = performance.now() - start;
          running++; report.peakActiveTasks = Math.max(report.peakActiveTasks, running);
          const result = await this.execute(slot, file, source); running--;
          if (result.file !== file || (!result.error && (!Array.isArray(result.tokens) || !result.ast))) throw Error('Invalid parser worker result');
          results[index] = result;
          report.tasks.push({file, lane, span: {file, start: 0, end: source.length, line: 1, column: 1}, startMs: begin, endMs: performance.now() - start,
            lexMs: result.lexMs ?? 0, parseMs: result.parseMs ?? 0, deferredError: !!result.error});
        }
      }));
      // A syntactically invalid inactive module must not fail a valid compilation.
      // Errors are replayed by the ordinary parser only if module resolution visits it.
      for (let i = 0; i < entries.length; i++) if (!results[i].error) {
        cache.adopt({...results[i], source: entries[i][1]}); report.parsedFiles++;
      }
    } catch (error) {
      stopped=true;this.dispose(error); signal?.throwIfAborted();
      report.fallbackReason = error.message; report.usedWorkers = 0; report.parsedFiles = 0;
    } finally { signal?.removeEventListener('abort', abort); this.active = false; }
    report.tasks.sort((a, b) => a.startMs - b.startMs || a.file.localeCompare(b.file));
    report.taskMs = report.tasks.reduce((n, task) => n + task.lexMs + task.parseMs, 0);
    report.wallMs = performance.now() - start;
    return report;
  }
  dispose(error = new DOMException('Cancelled', 'AbortError')) {
    for (const slot of this.slots) {
      if (slot.current) { clearTimeout(slot.current.timer); slot.current.reject(error); slot.current = null; }
      slot.worker.terminate();
    }
    this.slots = [];
  }
}
