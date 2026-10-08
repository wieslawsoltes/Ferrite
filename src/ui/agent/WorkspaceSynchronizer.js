/** Three-way source synchronization. Local and native divergent edits stop the sync, never overwrite. */
export class WorkspaceSynchronizer {
  constructor(model, client, {onStatus = () => {}} = {}) { this.model = model; this.client = client; this.onStatus = onStatus; this.baseline = null; this.enabled = false; this.applying = false; this.queue = Promise.resolve(); this.timer = null; this.conflicts = []; this.generation = 0;
    this.unsubscribe = model.subscribe(event => {
      if (event.kind !== 'replace' || this.applying) return;
      const linked = this.enabled; this.disconnect();
      if (linked) this.onStatus('Workspace replaced · agent synchronization is off; explicitly import the native checkout to reconnect.');
    });
  }
  import() {
    const generation = ++this.generation, revision = this.model.revision;
    this.enabled = false; clearTimeout(this.timer);
    const operation = this.queue.catch(() => {}).then(async () => {
      if (generation !== this.generation) return null;
      const snapshot = await this.client.request('/v1/workspace');
      if (generation !== this.generation) return null;
      if (revision !== this.model.revision) throw Error('Workspace changed during import; retry explicitly. Browser edits were not overwritten.');
      this.applying = true; try { this.model.replace(snapshot.files); } finally { this.applying = false; }
      this.baseline = snapshot; this.enabled = true; this.conflicts = []; this.onStatus('Synchronized to ' + snapshot.root); return snapshot;
    });
    this.queue = operation; return operation;
  }
  changed() { if (!this.enabled || this.applying) return; const generation = this.generation; clearTimeout(this.timer); this.timer = setTimeout(() => { if (generation === this.generation) this.sync().catch(error => { if (generation === this.generation) this.onStatus(error.message, true); }); }, 500); }
  sync() {
    if (!this.enabled || !this.baseline) return Promise.resolve();
    const generation = this.generation;
    const operation = this.queue.catch(() => {}).then(async () => {
      if (!this.enabled || !this.client.url || generation !== this.generation) return;
      const remote = await this.client.request('/v1/workspace');
      if (generation !== this.generation) return;
      const base = this.baseline.files, local = {...this.model.files};
      const paths = new Set([...Object.keys(base), ...Object.keys(remote.files), ...Object.keys(local)]), changes = [], incoming = {}, deleted = [], conflicts = [];
      for (const path of paths) {
        const before = base[path] ?? null, ours = local[path] ?? null, theirs = remote.files[path] ?? null;
        if (ours !== before && theirs !== before && ours !== theirs) { conflicts.push(path); continue; }
        if (ours !== before && ours !== theirs) changes.push({path, expectedHash: remote.hashes[path] ?? null, text: ours});
        else if (theirs !== ours) { if (theirs === null) deleted.push(path); else incoming[path] = theirs; }
      }
      if (conflicts.length) { this.conflicts = conflicts; throw Error('Sync conflict: ' + conflicts.join(', ') + '. Resolve explicitly by importing native files or editing the browser copy to match; no changes were overwritten.'); }
      // Compare again after network awaits before modifying the editor; user typing may have continued.
      if (Object.keys(local).length !== Object.keys(this.model.files).length || Object.keys(local).some(path => local[path] !== this.model.files[path])) { this.changed(); return; }
      if (changes.length) {
        if (changes.length > 100) throw Error('Sync needs more than 100 edits; split the change or re-import the native checkout');
        const result = await this.client.request('/v1/workspace/apply', {changes});
        if (generation !== this.generation) return;
        for (const change of changes) { if (change.text === null) { delete remote.files[change.path]; delete remote.hashes[change.path]; } else { remote.files[change.path] = change.text; remote.hashes[change.path] = result.changes.find(item => item.path === change.path).afterHash; } }
      }
      const incomingPaths = [...Object.keys(incoming), ...deleted];
      const raced = incomingPaths.filter(path => (this.model.files[path] ?? null) !== (local[path] ?? null));
      if (raced.length) {
        // Advance only our successfully written paths; retain the common ancestor of raced incoming edits.
        for (const change of changes) { if (change.text === null) { delete this.baseline.files[change.path]; delete this.baseline.hashes[change.path]; } else { this.baseline.files[change.path] = change.text; this.baseline.hashes[change.path] = remote.hashes[change.path]; } }
        this.conflicts = raced; throw Error('Sync conflict while typing: ' + raced.join(', ') + '. Native incoming edits were not applied.');
      }
      this.applying = true;
      try {
        const safe = {}; for (const [path, text] of Object.entries(incoming)) if ((this.model.files[path] ?? null) === (local[path] ?? null)) safe[path] = text;
        if (Object.keys(safe).length) this.model.applyFiles(safe, 'native-agent');
        for (const path of deleted) if (this.model.files[path] === local[path]) this.model.remove(path);
      } finally { this.applying = false; }
      this.baseline = remote; this.conflicts = []; this.onStatus(`Synchronized · ${Object.keys(remote.files).length} files`);
    });
    this.queue = operation; return operation;
  }
  dispose() { this.disconnect(); this.unsubscribe(); }
  disconnect() { ++this.generation; clearTimeout(this.timer); this.enabled = false; this.baseline = null; this.conflicts = []; }
}
