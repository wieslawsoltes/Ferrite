import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';
import {AgentError} from '../core/AgentError.js';
import {contentHash, randomUUID} from '../core/Platform.js';

/** An adapter over the LIVE editor model, not an independent or simulated filesystem. */
export class BrowserWorkspace {
  constructor(model, {store, events, beforeEdit = () => {}} = {}) {
    this.model = model; this.beforeEdit = beforeEdit; this.store = store; this.events = events; this.identity = model.workspaceId;
    this.epoch = model.workspaceEpoch; this.root = 'browser:' + this.identity; this.queue = Promise.resolve(); this.revoked = false;
  }
  assertCurrent(signal) {
    AgentError.abort(signal);
    if (this.revoked || this.model.workspaceId !== this.identity || this.model.workspaceEpoch !== this.epoch)
      throw new AgentError('WORKSPACE_CHANGED', 'The browser project was replaced. This task cannot access the new project.');
  }
  normalize(path, {directory = false} = {}) {
    if (typeof path !== 'string' || path.length > 2048 || path.split('/').includes('..')) throw new AgentError('UNSAFE_PATH', 'Use a project-relative path without traversal');
    if (path.split('/').some(part => ['.git', '.ssh', '.aws', '.gnupg'].includes(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials|id_rsa|id_ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part)))
      throw new AgentError('PROTECTED_PATH', 'Credential paths are not exposed to browser agent tools');
    return directory && ['', '.'].includes(path) ? '' : V.path(path);
  }
  async text(path, {optional = false} = {}) {
    this.assertCurrent(); path = this.normalize(path);
    if (!Object.hasOwn(this.model.files, path)) { if (optional) return null; throw new AgentError('ENOENT', 'No such browser project file: ' + path); }
    const text = this.model.read(path);
    if (new TextEncoder().encode(text).length > 2 * 1024 * 1024 || text.includes('\0')) throw new AgentError('FILE_LIMIT', 'Text tools accept files up to 2 MiB without NUL bytes');
    return text;
  }
  async read(path, {startLine = 1, endLine = startLine + 499} = {}) {
    if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine || endLine - startLine > 2000) throw Error('Invalid line range');
    const source = await this.text(path), lines = source.split('\n'), hash = await contentHash(source); this.assertCurrent();
    return {path: this.normalize(path), hash, startLine, endLine: Math.min(lines.length, endLine), totalLines: lines.length,
      text: lines.slice(startLine - 1, endLine).join('\n'), truncated: startLine > 1 || endLine < lines.length};
  }
  async list({path = '', limit = 1000, cursor = 0} = {}) {
    this.assertCurrent(); const base = this.normalize(path, {directory: true});
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000 || !Number.isSafeInteger(cursor) || cursor < 0) throw Error('Invalid listing range');
    const paths = Object.keys(this.model.files).filter(file => {
      try { this.normalize(file); } catch { return false; }
      return !file.split('/').some(part => ['target', 'node_modules', '__pycache__'].includes(part)) && (!base || file === base || file.startsWith(base + '/'));
    }).sort();
    return {files: paths.slice(cursor, cursor + limit), nextCursor: cursor + limit < paths.length ? cursor + limit : null};
  }
  async snapshot() {
    this.assertCurrent(); const revision = this.model.revision, listing = await this.list(), files = Object.create(null), hashes = Object.create(null);
    for (const path of listing.files) { files[path] = await this.text(path); hashes[path] = await contentHash(files[path]); }
    this.assertCurrent(); if (revision !== this.model.revision) throw new AgentError('EDIT_CONFLICT', 'Workspace changed while capturing source; read again');
    return {root: this.root, identity: this.identity, revision, files, hashes, excluded: Object.keys(this.model.files).filter(path => !Object.hasOwn(files, path))};
  }
  async preview(changes) {
    this.assertCurrent(); const revision = this.model.revision, seen = new Set(), edits = [];
    if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw Error('Expected 1–100 file changes');
    for (const change of changes) {
      const path = this.normalize(change.path); if (seen.has(path)) throw Error('Duplicate file in transaction'); seen.add(path);
      if (change.text !== null && (typeof change.text !== 'string' || change.text.includes('\0') || new TextEncoder().encode(change.text).length > 2 * 1024 * 1024)) throw Error('Invalid text change');
      const before = await this.text(path, {optional: true}), beforeHash = await contentHash(before);
      if (!Object.hasOwn(change, 'expectedHash') || beforeHash !== change.expectedHash) throw new AgentError('EDIT_CONFLICT', path + ' changed; read it again before editing', {status: 409});
      edits.push({path, before, after: change.text, beforeHash, afterHash: await contentHash(change.text)});
    }
    this.assertCurrent(); if (revision !== this.model.revision) throw new AgentError('EDIT_CONFLICT', 'Workspace changed while preparing the transaction');
    return edits;
  }
  apply(changes, {label = 'Browser agent edit', sessionId, signal} = {}) {
    const operation = this.queue.catch(() => {}).then(async () => {
      this.assertCurrent(signal); this.beforeEdit(); const revision = this.model.revision, edits = await this.preview(changes), id = randomUUID();
      const checkpoint = {id, label, sessionId, workspaceId: this.identity, at: new Date().toISOString(), status: 'prepared', edits};
      await this.store.write('checkpoints', id, checkpoint);
      try {
        this.assertCurrent(signal); this.beforeEdit();
        if (revision !== this.model.revision) throw new AgentError('EDIT_CONFLICT', 'Source changed while the checkpoint was being saved; no edits were applied');
        // No awaits between the final revision check and the atomic in-memory model mutation.
        this.model.applyWorkspaceTransaction(Object.fromEntries(edits.map(edit => [edit.path, edit.after])));
      } catch (error) { checkpoint.status = 'failed'; await this.store.write('checkpoints', id, checkpoint); throw error; }
      const saved = this.model.save(); checkpoint.status = 'applied';
      try { await this.store.write('checkpoints', id, checkpoint); }
      catch { throw new AgentError('CHECKPOINT_COMMIT', 'The source edit was applied but its checkpoint completion was not saved. Inspect the current source; do not replay the edit.'); }
      this.events?.emit('workspace.changed', {id, sessionId, label, paths: edits.map(edit => edit.path)});
      return {checkpoint: id, workspaceSaved: saved && !!this.model.storage, changes: edits.map(({path, beforeHash, afterHash}) => ({path, beforeHash, afterHash}))};
    });
    this.queue = operation; return operation;
  }
  async restore(id, context = {}) {
    const checkpoint = await this.store.read('checkpoints', id); this.assertCurrent(context.signal);
    if (checkpoint.status !== 'applied' || checkpoint.workspaceId !== this.identity) throw new AgentError('CHECKPOINT_STATE', 'Only an applied checkpoint in this project can be restored');
    return this.apply(checkpoint.edits.map(edit => ({path: edit.path, text: edit.before, expectedHash: edit.afterHash})), {...context, label: 'Restore ' + id});
  }
  revoke() { this.revoked = true; }
}
