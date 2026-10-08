import {randomUUID} from '../../agent/core/Platform.js';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Text project state. UI widgets do not own files or compilation revisions. */
export class WorkspaceModel {
  constructor(files, {storage = null, key = 'ferrite.workspace.v3'} = {}) {
    this.storage = storage; this.key = key; this.listeners = new Set(); this.revision = 0;
    this.transactions=[];this.positions = new Map(); this.breakpoints = new Map(); this.saved = new Map();
    this.replace(files, false);
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit(kind, detail = {}) { for (const listener of this.listeners) listener({kind, revision: this.revision, ...detail}); }
  replace(files, notify = true) {
    const candidate = V.validate(files); this.workspaceId = randomUUID(); this.workspaceEpoch = (this.workspaceEpoch ?? 0) + 1;
    this.transactions=[];this.files = candidate; this.active = Object.hasOwn(this.files, 'src/main.rs') ? 'src/main.rs' : Object.keys(this.files).find(f => f.endsWith('.rs')) ?? Object.keys(this.files)[0];
    this.tabs = [this.active]; this.positions.clear(); this.breakpoints.clear(); this.saved = new Map(Object.entries(this.files));
    this.revision++; if (notify) this.emit('replace');
  }
  read(path = this.active) { if (!Object.hasOwn(this.files, path)) throw Error(`File does not exist: ${path}`); return this.files[path]; }
  open(path) { this.read(path); if (!this.tabs.includes(path)) this.tabs.push(path); this.active = path; this.emit('open', {path}); }
  close(path) {
    const index = this.tabs.indexOf(path); if (index < 0) return;
    this.tabs.splice(index, 1);
    if (this.active === path) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    this.emit('open', {path: this.active});
  }
  update(path, text) {
    this.read(path); if (typeof text !== 'string') throw Error('Text expected');
    if (text === this.files[path]) return false;
    if (text.length > V.MAX_BYTES) throw Error('File exceeds project text limit');
    this.files[path] = text; this.revision++; this.emit('edit', {path}); return true;
  }
  create(path, text = '') {
    path = V.path(path); if (Object.hasOwn(this.files, path)) throw Error(`File already exists: ${path}`);
    this.files = V.validate({...this.files, [path]: text}); this.revision++; this.open(path); this.emit('files', {path});
    return path;
  }
  rename(path, target) {
    const text = this.read(path); target = V.path(target); if (path === target) return;
    if (Object.hasOwn(this.files, target)) throw Error(`File already exists: ${target}`);
    const files = {...this.files}; delete files[path]; files[target] = text; this.files = V.validate(files);
    this.tabs = this.tabs.map(f => f === path ? target : f); if (this.active === path) this.active = target;
    for (const map of [this.positions, this.breakpoints, this.saved]) if (map.has(path)) { map.set(target, map.get(path)); map.delete(path); }
    this.revision++; this.emit('files', {path: target});
  }
  remove(path) {
    this.read(path); if (Object.keys(this.files).length === 1) throw Error('Keep at least one project file');
    const index = this.tabs.indexOf(path); delete this.files[path]; this.tabs = this.tabs.filter(f => f !== path);
    if (this.active === path) this.active = this.tabs[Math.max(0, Math.min(index, this.tabs.length - 1))] ?? Object.keys(this.files)[0];
    if (this.active && !this.tabs.includes(this.active)) this.tabs.push(this.active);
    for (const map of [this.positions, this.breakpoints, this.saved]) map.delete(path);
    this.revision++; this.emit('files', {path: this.active});
  }
  applyFiles(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Expected changed project files');
    const candidate = V.validate({...this.files, ...changes});
    const paths = Object.keys(changes).filter(path => candidate[path] !== this.files[path]);
    if (!paths.length) return [];
    this.files = candidate; this.revision++;
    this.emit('files', {path: this.active, changed: paths});
    return paths;
  }
  reconcileFiles(files, {native = false} = {}) {
    const candidate = V.validate(files);
    if (JSON.stringify(candidate) === JSON.stringify(this.files)) return;
    this.files = candidate; this.tabs = this.tabs.filter(path => Object.hasOwn(candidate, path));
    if (!Object.hasOwn(candidate, this.active)) this.active = this.tabs[0] ?? Object.keys(candidate)[0];
    if (!this.tabs.includes(this.active)) this.tabs.push(this.active);
    this.revision++; this.emit('files', {path: this.active, changed: Object.keys(candidate), native});
  }
  applyTransaction(changes) {
    const before=Object.fromEntries(Object.keys(changes).map(path=>[path,this.read(path)]));
    const paths=this.applyFiles(changes);if(paths.length){this.transactions.push({before,after:{...changes}});if(this.transactions.length>20)this.transactions.shift();}return paths;
  }
  applyWorkspaceTransaction(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Expected a file change map');
    const files = {...this.files}, before = {}, after = {};
    for (const [input, value] of Object.entries(changes)) {
      const path = V.path(input); if (path !== input) throw Error('Transaction paths must be normalized');
      if (value !== null && typeof value !== 'string') throw Error('Expected text or null');
      before[path] = this.files[path] ?? null; after[path] = value;
      if (value === null) delete files[path]; else files[path] = value;
    }
    V.validate(files);
    if (Object.keys(after).every(path => before[path] === after[path])) return [];
    this.reconcileFiles(files); this.transactions.push({kind: 'workspace', before, after});
    if (this.transactions.length > 20) this.transactions.shift(); return Object.keys(after);
  }
  undoTransaction() {
    const transaction=this.transactions.at(-1);if(!transaction)return false;
    if(Object.entries(transaction.after).some(([path,text])=>(this.files[path]??null)!==text))throw Error('Files changed after the refactoring; undo would overwrite newer edits');
    this.transactions.pop(); if (transaction.kind === 'workspace') { const files = {...this.files}; for (const [path,text] of Object.entries(transaction.before)) { if (text === null) delete files[path]; else files[path] = text; } this.reconcileFiles(files); } else this.applyFiles(transaction.before); return true;
  }
  dirty(path) { return this.saved.get(path) !== this.files[path]; }
  snapshot() { return {format: 'ferrite-project-v1', files: {...this.files}}; }
  save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify({...this.snapshot(), workspaceId: this.workspaceId, active: this.active, tabs: this.tabs}));
      this.saved = new Map(Object.entries(this.files)); this.emit('saved'); return true;
    } catch (error) { this.emit('storage-error', {message: error.message}); return false; }
  }
  restore() {
    try {
      const data = JSON.parse(this.storage?.getItem(this.key) ?? 'null'); if (!data) return false;
      this.replace(data.files, false);
      if (typeof data.workspaceId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.workspaceId)) this.workspaceId = data.workspaceId;
      this.tabs = [...new Set((Array.isArray(data.tabs) ? data.tabs : []).filter(path => Object.hasOwn(this.files, path)))];
      this.active = Object.hasOwn(this.files, data.active) ? data.active : this.active;
      if (!this.tabs.includes(this.active)) this.tabs.push(this.active); return true;
    } catch { return false; }
  }
  toggleBreakpoint(path, line) {
    if (!Number.isInteger(line) || line < 1) return;
    const set = this.breakpoints.get(path) ?? new Set(); set.has(line) ? set.delete(line) : set.add(line);
    this.breakpoints.set(path, set); this.emit('breakpoint', {path, line});
  }
  get breakpointList() { return [...this.breakpoints].flatMap(([file, lines]) => [...lines].map(line => ({file, line}))); }
}
