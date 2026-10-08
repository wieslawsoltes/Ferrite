import {CargoDependencySpec} from '../../cargo/CargoDependencySpec.js';

/** Keeps live native handles out of saved/exported browser projects. */
export class RepositoryController {
  constructor(model, client, {onLoaded = () => {}, onChanged = () => {}, onLog = () => {}} = {}) {
    this.model = model; this.client = client; this.onLoaded = onLoaded; this.onChanged = onChanged; this.onLog = onLog;
    this.session = null; this.loading = false; this.needsReload = false;
    model.subscribe(event => { if (event.kind === 'replace' && !this.loading) this.detach(); });
  }
  detach() { this.session = null; this.needsReload = false; this.onChanged(); }
  load(session) {
    this.session = session; this.needsReload = false; this.loading = true;
    try { this.onLoaded(session); this.model.replace(session.files); this.model.save(); }
    finally { this.loading = false; this.onChanged(); }
  }
  async open(input) {
    const session = await this.client.repository('open', input, this.onLog);
    this.load(session); return session;
  }
  async reload(manifest) {
    if (!this.session) throw Error('Open a native repository first');
    // Reload is explicitly requested and intentionally does not require a matching version:
    // a cancelled process may have written Cargo.lock after the browser lost its stream.
    const session = await this.client.repository('reload', {id: this.session.id, manifest}, this.onLog);
    this.load(session);
  }
  reconcile(repository, submitted) {
    if (this.session?.id !== repository.id) return;
    const local = this.model.files, next = {...local}, remote = repository.files, conflicts = [];
    for (const path of new Set([...Object.keys(submitted), ...Object.keys(remote)])) {
      if (remote[path] === submitted[path]) continue;
      if (local[path] === submitted[path] || local[path] === remote[path]) {
        if (Object.hasOwn(remote, path)) next[path] = remote[path]; else delete next[path];
      } else conflicts.push(path);
    }
    this.session = repository;
    this.model.reconcileFiles(next, {native: true});
    this.needsReload = conflicts.length > 0;
    this.onChanged();
    if (conflicts.length) throw Error(`Concurrent IDE/native edits in ${conflicts.join(', ')}. Your IDE edits were kept; export them and reload before the next native operation.`);
  }
  async run(command, options = {}, onEvent = this.onLog) {
    if (!this.session) throw Error('Open a repository first');
    if (this.needsReload) throw Error('Reload the repository after the previous conflict/cancellation before building');
    const submitted = {...this.model.files}, id = this.session.id, version = this.session.version;
    try {
      const result = await this.client.repository('run', {...options, id, version, command, files: submitted}, onEvent);
      result.ideHadConcurrentEdits = JSON.stringify(this.model.files) !== JSON.stringify(submitted);
      if (result.repository) this.reconcile(result.repository, submitted);
      return result;
    } catch (error) { if (this.session?.id === id) { this.needsReload = true; this.onChanged(); } throw error; }
  }
  async dependency(spec, remove = false) {
    return this.run(remove ? 'remove' : 'add', {args: CargoDependencySpec.arguments(spec, remove), jobs: 1});
  }
  async list() { return this.client.repository('list', {}); }
  async resume(id) { this.load(await this.client.repository('reload', {id}, this.onLog)); }
  async closeDetached(id) { await this.client.repository('close', {id}); if(this.session?.id===id)this.detach(); }
  async close() {
    if (!this.session) return;
    await this.client.repository('close', {id: this.session.id}); this.detach();
  }
}
