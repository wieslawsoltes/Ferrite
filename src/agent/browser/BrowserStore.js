import {contentHash} from '../core/Platform.js';
import {AgentError} from '../core/AgentError.js';

const KINDS = new Set(['sessions', 'artifacts', 'checkpoints', 'reviews', 'queues']);
const bytes = text => new TextEncoder().encode(text).length;

/** Project-scoped IndexedDB records. Secrets are redacted before serialization, never persisted. */
export class BrowserStore {
  constructor(scope, {indexedDB = globalThis.indexedDB, keyRange = globalThis.IDBKeyRange, sanitize = value => value,
    maxRecordBytes = 24 * 1024 * 1024, maxTotalBytes = 64 * 1024 * 1024} = {}) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(scope)) throw Error('Invalid browser workspace identity');
    this.scope = scope; this.indexedDB = indexedDB; this.keyRange = keyRange; this.sanitize = sanitize;
    this.maxRecordBytes = maxRecordBytes; this.maxTotalBytes = maxTotalBytes;
    this.memory = new Map(); this.queue = Promise.resolve(); this.db = null; this.closed = false; this.persistent = false;
  }
  async initialize() {
    if (!this.indexedDB || !this.keyRange) { this.reason = 'In-memory session: persistent browser storage is unavailable'; return this; }
    try { this.db = await new Promise((resolve, reject) => {
      const request = this.indexedDB.open('ferrite-agent-v1', 1); let settled = false;
      request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains('records')) request.result.createObjectStore('records', {keyPath: 'key'}); };
      request.onerror = () => { settled = true; reject(request.error); };
      request.onblocked = () => { settled = true; reject(Error('Agent storage upgrade is blocked by another Ferrite tab')); };
      request.onsuccess = () => { if (settled) request.result.close(); else { settled = true; resolve(request.result); } };
    });
    } catch (error) { this.reason = 'In-memory session: IndexedDB unavailable (' + (error?.name ?? 'storage error') + ')'; return this; }
    this.db.onversionchange = () => { this.closed = true; this.db.close(); };
    this.persistent = true; return this;
  }
  key(kind, id) {
    if (this.closed) throw new AgentError('STORE_CLOSED', 'Browser agent storage is closed');
    if (!KINDS.has(kind) || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new AgentError('INVALID_ID', 'Invalid browser storage identifier');
    return `${this.scope}\0${kind}\0${id}`;
  }
  async read(kind, id) {
    const key = this.key(kind, id); await this.queue.catch(() => {});
    let row;
    if (!this.db) row = this.memory.get(key);
    else row = await new Promise((resolve, reject) => {
      const tx = this.db.transaction('records', 'readonly'), request = tx.objectStore('records').get(key);
      request.onsuccess = () => { row = request.result; }; tx.oncomplete = () => resolve(row); tx.onabort = () => reject(tx.error);
    });
    if (!row) throw new AgentError('NOT_FOUND', `No ${kind} record with this identifier`, {status: 404});
    return JSON.parse(row.text);
  }
  async list(kind) {
    this.key(kind, 'validate'); await this.queue.catch(() => {});
    const prefix = `${this.scope}\0${kind}\0`;
    if (!this.db) return [...this.memory.keys()].filter(key => key.startsWith(prefix)).map(key => key.slice(prefix.length));
    return new Promise((resolve, reject) => {
      const tx = this.db.transaction('records', 'readonly'), request = tx.objectStore('records').getAllKeys(this.keyRange.bound(prefix, prefix + '\uffff'));
      let keys; request.onsuccess = () => { keys = request.result; }; tx.oncomplete = () => resolve(keys.map(key => key.slice(prefix.length))); tx.onabort = () => reject(tx.error);
    });
  }
  write(kind, id, value) {
    const key = this.key(kind, id), text = this.sanitize(JSON.stringify(value)), size = bytes(text);
    if (size > this.maxRecordBytes) return Promise.reject(new AgentError('SESSION_LIMIT', 'Browser record exceeds its storage budget; export and start a new task'));
    return this.mutate(key, {key, text, size});
  }
  delete(kind, id) { return this.mutate(this.key(kind, id), null); }
  mutate(key, row) {
    const operation = this.queue.catch(() => {}).then(async () => {
      if (this.closed) throw new AgentError('STORE_CLOSED', 'Browser agent storage is closed');
      if (!this.db) {
        const size = [...this.memory.values()].reduce((sum, item) => sum + item.size, 0) - (this.memory.get(key)?.size ?? 0) + (row?.size ?? 0);
        if (size > this.maxTotalBytes) throw new AgentError('STORE_QUOTA', 'Browser agent project storage budget reached');
        if (row) this.memory.set(key, row); else this.memory.delete(key); return;
      }
      await new Promise((resolve, reject) => {
        const tx = this.db.transaction('records', 'readwrite'), store = tx.objectStore('records'), metaKey = `${this.scope}\0usage`;
        let old, usage, reads = 0, failure;
        const put = () => {
          if (++reads !== 2) return;
          const size = (usage?.size ?? 0) - (old?.size ?? 0) + (row?.size ?? 0);
          if (size > this.maxTotalBytes) { failure = new AgentError('STORE_QUOTA', 'Browser agent project storage budget reached'); tx.abort(); return; }
          if (row) store.put(row); else store.delete(key);
          store.put({key: metaKey, size});
        };
        const previous = store.get(key), total = store.get(metaKey);
        previous.onsuccess = () => { old = previous.result; put(); }; total.onsuccess = () => { usage = total.result; put(); };
        tx.oncomplete = () => resolve(); tx.onabort = () => reject(failure ?? new AgentError('STORE_QUOTA', 'Browser storage transaction failed; no durable record was replaced', {cause: tx.error}));
      });
    });
    this.queue = operation; return operation;
  }
  async put(text) { text = this.sanitize(text); const id = await contentHash(text); await this.write('artifacts', id, {text}); return id; }
  async artifact(id, offset = 0, length = 16000) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 24000) throw Error('Invalid artifact range');
    const {text} = await this.read('artifacts', id);
    return {id, offset, text: text.slice(offset, offset + length), totalCharacters: text.length, nextOffset: offset + length < text.length ? offset + length : null};
  }
  async close() { await this.queue.catch(() => {}); this.closed = true; this.db?.close(); }
}

/** A second tab may edit its own IDE, but cannot concurrently write the same agent journal. */
export class BrowserLease {
  static async acquire(scope, {locks = globalThis.navigator?.locks} = {}) {
    if (!locks) return {persistentAllowed: false, release: async () => {}};
    let release, accept, decline;
    const ready = new Promise((resolve, reject) => { accept = resolve; decline = reject; });
    let held;
    try { held = locks.request('ferrite-agent:' + scope, {ifAvailable: true}, async lock => {
      if (!lock) throw new AgentError('AGENT_TAB_OWNER', 'This project’s browser agent is open in another tab. Disconnect it there before using it here.');
      await new Promise(resolve => { release = resolve; accept(); });
    });
    } catch (error) { if (error.name === 'SecurityError' || error.name === 'NotSupportedError') return {persistentAllowed: false, release: async () => {}}; throw error; }
    held.catch(decline); await ready;
    return {persistentAllowed: true, release: async () => { release(); await held; }};
  }
}
