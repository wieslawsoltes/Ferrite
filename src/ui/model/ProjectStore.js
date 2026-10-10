/** Browser-local project catalog. Archive successfully before replacing an active workspace. */
export class ProjectStore {
  constructor(model, storage = model.storage) { this.model = model; this.storage = storage; this.key = 'ferrite.projects.v1'; this.memory = new Map(); this.catalog = []; }
  list() {
    try { const items = this.storage ? JSON.parse(this.storage.getItem(this.key) ?? '[]') : this.catalog; return Array.isArray(items) ? items.filter(item => item && /^[a-zA-Z0-9-]{1,100}$/.test(item.id) && typeof item.name === 'string').slice(0, 30) : []; }
    catch { return []; }
  }
  archive() {
    const data = this.model.workspaceData(), id = data.workspaceId;
    const name = data.name || /^name\s*=\s*"([^"]+)"/m.exec(data.files['Cargo.toml'] ?? '')?.[1] || 'Untitled project';
    const list = [{id, name, modified: Date.now()}, ...this.list().filter(item => item.id !== id)].slice(0, 30);
    // Do not swallow quota failures: switching must never discard an unarchived project.
    const serialized = JSON.stringify(data); this.storage?.setItem(`${this.key}.${id}`, serialized); this.storage?.setItem(this.key, JSON.stringify(list));
    this.catalog = list; this.memory.set(id, data); return id;
  }
  open(id) {
    if (!/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw Error('Invalid project id');
    if (id === this.model.workspaceId) { this.archive(); this.model.save(); return; }
    const data = this.memory.get(id) ?? JSON.parse(this.storage?.getItem(`${this.key}.${id}`) ?? 'null');
    if (!data) throw Error('This recent project is no longer available');
    this.archive(); this.model.loadWorkspace(data); this.model.save();
  }
}
