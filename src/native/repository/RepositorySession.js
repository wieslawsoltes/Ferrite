import {mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {RepositoryPolicy as P} from './RepositoryPolicy.js';
import {RepositorySnapshot} from './RepositorySnapshot.js';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Persistent native checkout. Only explicitly submitted editor deltas are written. */
export class RepositorySession {
  constructor({root, owned = false, source, manifest = 'Cargo.toml'}) {
    this.id = randomUUID(); this.root = root; this.owned = owned; this.source = source;
    this.manifest = P.path(manifest); this.version = 0; this.previous = new Map(); this.busy = false;
  }
  async refresh(signal) {
    this.snapshot = await RepositorySnapshot.read(this.root, {manifest: this.manifest, signal});
    this.previous = new Map(Object.entries(this.snapshot.files)); this.version++; this.needsRefresh=false;
    return this.describe();
  }
  describe() { return {id: this.id, version: this.version, root: this.root, source: this.source,
    manifest: this.manifest, owned: this.owned, head: this.head ?? null, ...this.snapshot, metadata: this.metadata ?? null,
    metadataError: this.metadataError ?? null, needsRefresh: !!this.needsRefresh}; }
  async update(snapshot) {
    const files = V.validate(snapshot.files), changes = [];
    if (!Object.hasOwn(files, this.manifest)) throw Error('Keep the selected Cargo manifest in the editor');
    for (const path of new Set([...this.previous.keys(), ...Object.keys(files)])) {
      const before = this.previous.get(path), after = files[path];
      if (before === after) continue;
      if (after !== undefined && Buffer.byteLength(after) > 1024 * 1024) throw Error(`Edited file exceeds 1 MiB: ${path}`);
      if (P.ignored(path)) throw Error(`Protected repository path: ${path}`);
      const target = await P.target(this.root, path);
      let current = null, mode = 0o644;
      try { const data = await P.read(this.root, path); current = data.bytes; mode = data.mode; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const expected = before === undefined ? null : Buffer.from(before);
      if ((current === null) !== (expected === null) || (current && !current.equals(expected)))
        throw Error(`Repository conflict: ${path} changed on disk. Reload before overwriting it.`);
      changes.push({path, target, before: current, after, mode});
    }
    // Stage every new file before touching originals. Each replacement is atomic; a
    // multi-file transaction has rollback, but is not an OS-wide atomic transaction.
    const staged = [], written = [];
    try {
      for (const change of changes) {
        if (change.after === undefined) continue;
        await mkdir(dirname(change.target), {recursive: true});
        change.temp = `${change.target}.ferrite-${randomUUID()}`;
        staged.push(change.temp);
        await writeFile(change.temp, change.after, {flag: 'wx', mode: change.mode & 0o777});
      }
      // Revalidate after staging: do not knowingly overwrite an external editor.
      for (const change of changes) {
        let now = null;
        try { now = (await P.read(this.root, change.path)).bytes; } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if ((now === null) !== (change.before === null) || (now && !now.equals(change.before)))
          throw Error(`Repository conflict: ${change.path} changed during synchronization`);
      }
      for (const change of changes) {
        await P.target(this.root, change.path);
        if (change.after === undefined) await rm(change.target); else await rename(change.temp, change.target);
        written.push(change);
      }
    } catch (error) {
      const failures = [];
      for (const change of written.reverse()) {
        try {
          const now = change.after === undefined ? null : (await P.read(this.root, change.path)).bytes;
          if (change.after !== undefined && !now.equals(Buffer.from(change.after))) throw Error('concurrent external write');
          if (change.before === null) await rm(change.target, {force: true});
          else await writeFile(change.target, change.before, {flag: change.after === undefined ? 'wx' : 'w', mode: change.mode & 0o777});
        } catch (problem) { failures.push(`${change.path}: ${problem.message}`); }
      }
      if (failures.length) throw new AggregateError([error], `${error.message}; rollback needs review: ${failures.join('; ')}`);
      throw error;
    } finally { await Promise.all(staged.map(path => rm(path, {force: true}))); }
    this.previous = new Map(Object.entries(files));
  }
  async outputFiles() {
    const result = await RepositorySnapshot.read(this.root, {manifest: this.manifest});
    return Object.fromEntries(Object.entries(result.files).filter(([path, text]) => this.previous.get(path) !== text));
  }
  async dispose() { if (this.owned) await rm(this.root, {recursive: true, force: true}); }
}
