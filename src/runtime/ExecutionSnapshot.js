/** Identity-preserving snapshot of the VM's data graph, never functions or DOM objects.
 * Restoring in place preserves aliases into cells that have left the current call stack.
 * Compiler metadata, host resources and executable objects must remain outside this graph.
 */
export class ExecutionSnapshot {
  constructor(root, {maxBytes = 8 * 1024 * 1024, maxObjects = 100000} = {}) {
    this.root = root; this.records = []; this.bytes = 0;
    const seen = new Set(), work = [root];
    while (work.length) {
      const value = work.pop();
      if (typeof value === 'string') this.bytes += 16 + value.length * 2;
      else if (typeof value === 'bigint') this.bytes += 16 + value.toString().length;
      else if (value !== null && typeof value === 'object') {
        if (seen.has(value)) continue;
        if (seen.size >= maxObjects) throw this.error('Execution snapshot object budget exceeded');
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== Array.prototype && prototype !== null)
          throw this.error('Execution snapshots support only plain Rust values and reference cells');
        seen.add(value);
        const descriptors = Object.getOwnPropertyDescriptors(value), entries = [];
        for (const key of Reflect.ownKeys(descriptors)) {
          const descriptor = descriptors[key];
          if (typeof key !== 'string' || !('value' in descriptor)) throw this.error('Execution snapshot cannot invoke accessors or snapshot symbols');
          entries.push([key, descriptor]); work.push(descriptor.value); this.bytes += 64 + key.length * 2;
        }
        this.records.push({value, entries}); this.bytes += 64;
      } else if (typeof value === 'function' || typeof value === 'symbol') throw this.error('Execution snapshot cannot retain executable host values');
      else this.bytes += 16;
      if (this.bytes > maxBytes) throw this.error('Execution snapshot byte budget exceeded');
    }
  }
  error(message) { return Object.assign(new Error(message), {code: 'R_HISTORY_BUDGET'}); }
  restore() {
    for (const {value, entries} of this.records) {
      const keys = new Set(entries.map(([key]) => key));
      for (const key of Reflect.ownKeys(value)) if (!keys.has(key) && !Reflect.deleteProperty(value, key)) throw this.error('Execution graph became non-restorable');
      // Length comes last: restore truncated arrays without temporarily losing elements.
      for (const [key, descriptor] of entries) if (key !== 'length' || !Array.isArray(value)) Object.defineProperty(value, key, descriptor);
      if (Array.isArray(value)) Object.defineProperty(value, 'length', entries.find(([key]) => key === 'length')[1]);
    }
    return this.root;
  }
}
