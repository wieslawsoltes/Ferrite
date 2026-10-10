import {WorkspaceTree} from './WorkspaceTree.js';
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
    const candidate = V.validate(files); WorkspaceTree.folders(candidate); this.workspaceId = randomUUID(); this.workspaceEpoch = (this.workspaceEpoch ?? 0) + 1;
    this.folders = WorkspaceTree.folders(candidate); this.documentStates = new Map(); this.pinned = new Set(); this.closedTabs = []; this.previewTab = null; this.name = '';
    this.transactions=[];this.files = candidate; this.active = Object.hasOwn(this.files, 'src/main.rs') ? 'src/main.rs' : Object.keys(this.files).find(f => f.endsWith('.rs')) ?? Object.keys(this.files)[0];
    this.tabs = [this.active]; this.positions.clear(); this.breakpoints.clear(); this.saved = new Map(Object.entries(this.files));
    this.revision++; if (notify) this.emit('replace');
  }
  read(path = this.active) { if (!Object.hasOwn(this.files, path)) throw Error(`File does not exist: ${path}`); return this.files[path]; }
  open(path, {preview = false} = {}) {
    this.read(path);
    if (!this.tabs.includes(path)) {
      if (preview && this.previewTab && !this.dirty(this.previewTab) && !this.pinned.has(this.previewTab)) this.tabs = this.tabs.filter(file => file !== this.previewTab);
      this.tabs.push(path); if (preview) this.previewTab = path;
    }
    if (!preview && this.previewTab === path) this.previewTab = null;
    this.active = path; this.emit('open', {path});
  }
  close(path) {
    const index = this.tabs.indexOf(path); if (index < 0) return;
    this.closedTabs = [path, ...this.closedTabs.filter(file => file !== path)].slice(0, 30);
    this.tabs.splice(index, 1); if (this.previewTab === path) this.previewTab = null;
    if (this.active === path) this.active = this.tabs[Math.min(index, this.tabs.length - 1)] ?? null;
    this.emit('open', {path: this.active, closed: path});
  }
  reopenClosed() { const path = this.closedTabs.shift(); if (path && Object.hasOwn(this.files, path)) this.open(path); }
  closeTabs(kind = 'others', path = this.active) {
    const index = this.tabs.indexOf(path);
    const close = this.tabs.filter((file, i) => !this.pinned.has(file) && (kind === 'all' || kind === 'others' && file !== path || kind === 'right' && i > index));
    for (const file of close) this.close(file);
  }
  pin(path, pinned = !this.pinned.has(path)) { this.read(path); pinned ? this.pinned.add(path) : this.pinned.delete(path); if (this.previewTab === path) this.previewTab = null; this.emit('open', {path: this.active}); }
  reorderTab(path, before) {
    if (!this.tabs.includes(path) || !this.tabs.includes(before) || path === before) return;
    this.tabs = this.tabs.filter(file => file !== path); this.tabs.splice(this.tabs.indexOf(before), 0, path); this.emit('open', {path: this.active});
  }
  documentState(path = this.active) { return {mode: 'code', orientation: 'right', ratio: 50, ...this.documentStates.get(path)}; }
  setDocumentState(path, values) {
    this.read(path); const next = {...this.documentState(path), ...values};
    if (!['code', 'split', 'design', 'preview'].includes(next.mode) || !['right', 'down'].includes(next.orientation) || !Number.isFinite(next.ratio)) throw Error('Invalid document layout');
    next.ratio = Math.max(20, Math.min(80, next.ratio)); this.documentStates.set(path, next); this.emit('document', {path});
  }
  update(path, text) {
    this.read(path); if (typeof text !== 'string') throw Error('Text expected');
    if (text === this.files[path]) return false;
    if (text.length > V.MAX_BYTES) throw Error('File exceeds project text limit');
    if (this.previewTab === path) this.previewTab = null;
    this.files[path] = text; this.revision++; this.emit('edit', {path}); return true;
  }
  create(path, text = '') {
    path = V.path(path); if (Object.hasOwn(this.files, path)) throw Error(`File already exists: ${path}`);
    const candidate = V.validate({...this.files, [path]: text});
    if (this.folders.has(path)) throw Error(`Directory already exists: ${path}`);
    this.folders = WorkspaceTree.folders(candidate, [...this.folders]); this.files = candidate; this.revision++; this.open(path); this.emit('files', {path});
    return path;
  }
  createFolder(path) {
    path = V.path(path); if (this.folders.has(path) || Object.hasOwn(this.files, path)) throw Error(`Path already exists: ${path}`);
    this.applyTreePlan({files: {...this.files}, folders: WorkspaceTree.folders(this.files, [...this.folders, path])}); return path;
  }
  rename(path, target) { if (path === target) return; return this.movePath(path, target); }
  movePath(path, target, options) {
    const plan = WorkspaceTree.move(this.files, this.folders, path, target, options);
    this.applyTreePlan(plan); return plan.target;
  }
  remove(path) { return this.applyTreePlan(WorkspaceTree.remove(this.files, this.folders, path)); }
  applyTreePlan(plan) {
    const before = this.workspaceData(), savedBefore = [...this.saved], renamed = plan.renamed ?? {};
    this.files = plan.files; this.folders = plan.folders;
    const remap = path => renamed[path] ?? path;
    this.tabs = [...new Set(this.tabs.map(remap).filter(path => Object.hasOwn(this.files, path)))];
    this.active = remap(this.active); if (!Object.hasOwn(this.files, this.active)) this.active = this.tabs[0] ?? Object.keys(this.files)[0];
    if (this.active && !this.tabs.includes(this.active)) this.tabs.push(this.active);
    for (const name of ['positions', 'breakpoints', 'saved', 'documentStates']) this[name] = new Map([...this[name]].map(([path,value]) => [remap(path),value]).filter(([path]) => Object.hasOwn(this.files,path)));
    this.pinned = new Set([...this.pinned].map(remap).filter(path => Object.hasOwn(this.files,path)));
    this.closedTabs = this.closedTabs.map(remap).filter(path => Object.hasOwn(this.files,path));
    this.previewTab = this.previewTab ? remap(this.previewTab) : null;
    this.revision++; this.transactions.push({kind: 'tree', before, savedBefore, after: this.workspaceData()}); if (this.transactions.length > 20) this.transactions.shift();
    this.emit('files', {path: this.active, renamed, deleted: plan.deleted ?? []});
  }
  applyFiles(changes) {
    if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw Error('Expected changed project files');
    const candidate = V.validate({...this.files, ...changes});
    const folders = WorkspaceTree.folders(candidate, [...this.folders]);
    const paths = Object.keys(changes).filter(path => candidate[path] !== this.files[path]);
    if (!paths.length) return [];
    this.files = candidate; this.folders = folders; this.revision++;
    this.emit('files', {path: this.active, changed: paths});
    return paths;
  }
  reconcileFiles(files, {native = false} = {}) {
    const candidate = V.validate(files), folders = WorkspaceTree.folders(candidate, [...this.folders].filter(path => !Object.hasOwn(candidate, path)));
    if (JSON.stringify(candidate) === JSON.stringify(this.files)) return;
    this.files = candidate; this.folders = folders; this.tabs = this.tabs.filter(path => Object.hasOwn(candidate, path));
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
    if (transaction.kind === 'tree') {
      if (JSON.stringify(this.files) !== JSON.stringify(transaction.after.files) || JSON.stringify([...this.folders]) !== JSON.stringify(transaction.after.folders)) throw Error('Files changed after the operation; undo would overwrite newer edits');
      this.transactions.pop(); const remaining = this.transactions; this.loadWorkspace(transaction.before, false); this.saved = new Map(transaction.savedBefore); this.transactions = remaining; this.emit('replace'); return true;
    }
    if(Object.entries(transaction.after).some(([path,text])=>(this.files[path]??null)!==text))throw Error('Files changed after the refactoring; undo would overwrite newer edits');
    this.transactions.pop(); if (transaction.kind === 'workspace') { const files = {...this.files}; for (const [path,text] of Object.entries(transaction.before)) { if (text === null) delete files[path]; else files[path] = text; } this.reconcileFiles(files); } else this.applyFiles(transaction.before); return true;
  }
  dirty(path) { return this.saved.get(path) !== this.files[path]; }
  snapshot() { return {format: 'ferrite-project-v1', files: {...this.files}, folders: [...this.folders], name: this.name}; }
  workspaceData() { return {...this.snapshot(), workspaceId: this.workspaceId, active: this.active, tabs: [...this.tabs], pinned: [...this.pinned], documents: Object.fromEntries(this.documentStates), positions: Object.fromEntries(this.positions), breakpoints: Object.fromEntries([...this.breakpoints].map(([path,lines])=>[path,[...lines]])), closedTabs: [...this.closedTabs], previewTab: this.previewTab}; }
  loadWorkspace(data, notify = true) {
    if (!data || data.format && data.format !== 'ferrite-project-v1') throw Error('Unknown project format');
    const files = V.validate(data.files), folders = WorkspaceTree.folders(files, data.folders ?? []);
    this.replace(files, false); this.folders = folders; this.name = typeof data.name === 'string' ? data.name.slice(0, 100) : '';
    if (typeof data.workspaceId === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(data.workspaceId)) this.workspaceId = data.workspaceId;
    if (Array.isArray(data.tabs)) this.tabs = [...new Set(data.tabs.filter(path => Object.hasOwn(files, path)))];
    this.active = data.active === null ? null : Object.hasOwn(files, data.active) ? data.active : this.tabs[0] ?? this.active;
    if (this.active && !this.tabs.includes(this.active)) this.tabs.push(this.active);
    this.pinned = new Set((Array.isArray(data.pinned) ? data.pinned : []).filter(path => Object.hasOwn(files, path)));
    for (const [path, state] of Object.entries(data.documents ?? {})) {
      if (!Object.hasOwn(files, path) || !state || !['code','split','design','preview'].includes(state.mode)) continue;
      this.documentStates.set(path, {mode: state.mode, orientation: state.orientation === 'down' ? 'down' : 'right', ratio: Number.isFinite(state.ratio) ? Math.max(20, Math.min(80, state.ratio)) : 50});
    }
    for (const [path, position] of Object.entries(data.positions ?? {})) if (Object.hasOwn(files, path) && position && ['start','end','top','left'].every(key => Number.isFinite(position[key]) && position[key] >= 0)) this.positions.set(path, position);
    for (const [path, lines] of Object.entries(data.breakpoints ?? {})) if (Object.hasOwn(files, path) && Array.isArray(lines)) this.breakpoints.set(path, new Set(lines.filter(line => Number.isInteger(line) && line > 0)));
    this.closedTabs = (Array.isArray(data.closedTabs) ? data.closedTabs : []).filter(path => Object.hasOwn(files,path)).slice(0,30);
    this.previewTab = this.tabs.includes(data.previewTab) && !this.pinned.has(data.previewTab) ? data.previewTab : null;
    if (notify) this.emit('replace');
  }
  save() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.workspaceData()));
      this.saved = new Map(Object.entries(this.files)); this.emit('saved'); return true;
    } catch (error) { this.emit('storage-error', {message: error.message}); return false; }
  }
  restore() {
    try {
      const data = JSON.parse(this.storage?.getItem(this.key) ?? 'null'); if (!data) return false;
      this.loadWorkspace(data, false); return true;
    } catch { return false; }
  }
  toggleBreakpoint(path, line) {
    if (!Number.isInteger(line) || line < 1) return;
    const set = this.breakpoints.get(path) ?? new Set(); set.has(line) ? set.delete(line) : set.add(line);
    this.breakpoints.set(path, set); this.emit('breakpoint', {path, line});
  }
  get breakpointList() { return [...this.breakpoints].flatMap(([file, lines]) => [...lines].map(line => ({file, line}))); }
}
