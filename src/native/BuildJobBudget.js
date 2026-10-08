import {availableParallelism} from 'node:os';

/** FIFO weighted admission for native Cargo processes. Cargo schedules its own DAG. */
export class BuildJobBudget {
  constructor(capacity = Math.min(256, availableParallelism())) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) throw Error('Build job budget must be 1..256');
    this.capacity = capacity; this.used = 0; this.queue = [];
  }
  jobs(value) {
    if (value === undefined || value === '' || value === 'auto' || value === 'default') return this.capacity;
    const count = Number(value);
    if (!Number.isInteger(count) || count < 1 || count > this.capacity) throw Error(`Jobs must be 1..${this.capacity}, or auto`);
    return count;
  }
  acquire(value, signal) {
    const weight = this.jobs(value);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      const item = {weight, resolve, reject, signal};
      item.abort = () => { const index = this.queue.indexOf(item); if (index >= 0) this.queue.splice(index, 1); reject(signal.reason); this.drain(); };
      signal?.addEventListener('abort', item.abort, {once: true}); this.queue.push(item); this.drain();
    });
  }
  drain() {
    while (this.queue.length && this.used + this.queue[0].weight <= this.capacity) {
      const item = this.queue.shift(); item.signal?.removeEventListener('abort', item.abort); this.used += item.weight;
      let released = false;
      item.resolve({jobs: item.weight, release: () => { if (released) return; released = true; this.used -= item.weight; this.drain(); }});
    }
  }
}
