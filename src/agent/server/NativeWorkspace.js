import {realpath, readdir, readFile, lstat, mkdir, open, rename, unlink, rm} from 'node:fs/promises';
import {resolve, relative, dirname, join, isAbsolute, sep} from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {AgentError} from '../core/AgentError.js';
import {VirtualFileSystem} from '../../project/VirtualFileSystem.js';

/** Persistent native checkout with rooted, non-symlink text tools and optimistic edit transactions.
 * This is an accident-prevention boundary, NOT an OS sandbox against executed native programs.
 */
export class NativeWorkspace {
  static ignoredDirectories = new Set(['.git', '.ferrite-agent', 'node_modules', 'target', 'target-ra', '.idea', '.venv', '__pycache__']);
  static hash(text) { return text === null ? null : createHash('sha256').update(text).digest('hex'); }
  constructor(root, {store, events, maxFileBytes = 2 * 1024 * 1024} = {}) { this.root = resolve(root); this.store = store; this.events = events; this.maxFileBytes = maxFileBytes; this.queue = Promise.resolve(); }
  async initialize() { this.root = await realpath(this.root); if (!(await lstat(this.root)).isDirectory()) throw Error('Workspace root must be a directory'); return this; }
  normalize(path, {directory = false} = {}) {
    if (typeof path !== 'string' || path.includes('\0') || path.includes('\\') || isAbsolute(path) || /^[A-Za-z]:/.test(path) || path.length > 2048) throw new AgentError('UNSAFE_PATH', 'Expected a workspace-relative path');
    const parts = path.split('/').filter(part => part && part !== '.');
    if (parts.some(part => part === '..' || ['__proto__', 'constructor', 'prototype'].includes(part))) throw new AgentError('UNSAFE_PATH', 'Traversal and unsafe path components are forbidden');
    if (!parts.length && !directory) throw new AgentError('UNSAFE_PATH', 'File path is empty');
    if (parts.some(part => ['.git', '.ferrite-agent', '.ssh', '.aws', '.gnupg'].includes(part) || /^\.env(?:\.|$)/i.test(part) || /^(?:credentials|id_rsa|id_ed25519)$/i.test(part) || /\.(?:pem|key|p12|pfx)$/i.test(part))) throw new AgentError('PROTECTED_PATH', 'Credential and internal paths are not exposed to agent file tools');
    return parts.join('/');
  }
  async path(path, {directory = false, missing = false} = {}) {
    const normalized = this.normalize(path, {directory}), absolute = resolve(this.root, normalized);
    const rel = relative(this.root, absolute); if (rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) throw Error('Path escapes workspace');
    let current = this.root;
    for (const part of normalized.split('/').filter(Boolean)) {
      current = join(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw new AgentError('SYMLINK_DENIED', 'Agent tools do not follow symlinks'); }
      catch (error) { if (missing && error.code === 'ENOENT') break; throw error; }
    }
    return absolute;
  }
  async text(path, {optional = false} = {}) {
    let absolute; try { absolute = await this.path(path); } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    let handle;
    try {
      handle = await open(absolute, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); const stat = await handle.stat();
      if (!stat.isFile() || stat.size > this.maxFileBytes) throw new AgentError('FILE_LIMIT', 'Only regular text files up to 2 MiB are supported by text tools');
      const bytes = await handle.readFile(); if (bytes.length > this.maxFileBytes || bytes.includes(0)) throw new AgentError('BINARY_FILE', 'Binary or oversized file; use a trusted native utility');
      try { return new TextDecoder('utf-8', {fatal: true}).decode(bytes); } catch { throw new AgentError('ENCODING', 'Text tools require UTF-8'); }
    } catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    finally { await handle?.close(); }
  }
  async read(path, {startLine = 1, endLine = startLine + 499} = {}) {
    if (!Number.isSafeInteger(startLine) || startLine < 1 || !Number.isSafeInteger(endLine) || endLine < startLine || endLine - startLine > 2000) throw Error('Invalid line range');
    const text = await this.text(path), lines = text.split('\n');
    return {path: this.normalize(path), hash: NativeWorkspace.hash(text), startLine, endLine: Math.min(lines.length, endLine), totalLines: lines.length,
      text: lines.slice(startLine - 1, endLine).join('\n'), truncated: startLine > 1 || endLine < lines.length};
  }
  async list({path = '', limit = 1000, cursor = 0} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 2000 || !Number.isSafeInteger(cursor) || cursor < 0 || cursor > 100000) throw Error('Invalid listing range');
    const base = this.normalize(path, {directory: true}), absolute = await this.path(base, {directory: true}); const files = []; let visited = 0, more = false;
    const walk = async (directory, prefix, depth) => {
      if (depth > 32) return;
      const entries = (await readdir(directory, {withFileTypes: true})).sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (more) break;
        const name = [prefix, entry.name].filter(Boolean).join('/');
        try { this.normalize(name); } catch { continue; }
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory()) { if (!NativeWorkspace.ignoredDirectories.has(entry.name)) await walk(join(directory, entry.name), name, depth + 1); }
        else if (entry.isFile()) { if (visited++ < cursor) continue; if (files.length === limit) { more = true; break; } files.push(name); }
      }
    };
    await walk(absolute, base, 0); return {files, nextCursor: more ? cursor + files.length : null};
  }
  async snapshot() {
    const listing = await this.list({limit: 1000}), files = Object.create(null), hashes = Object.create(null), excluded = []; let bytes = 0;
    for (const path of listing.files) {
      try {
        VirtualFileSystem.path(path); const text = await this.text(path); bytes += Buffer.byteLength(text);
        if (bytes > VirtualFileSystem.MAX_BYTES) throw new AgentError('WORKSPACE_LIMIT', 'IDE synchronization is limited to 10 MiB of text');
        files[path] = text; hashes[path] = NativeWorkspace.hash(text);
      } catch (error) { if (error.code === 'WORKSPACE_LIMIT') throw error; excluded.push({path, reason: error.message}); }
    }
    if (listing.nextCursor !== null) throw new AgentError('WORKSPACE_LIMIT', 'IDE synchronization supports 1000 files; file tools remain available with pagination');
    return {root: this.root, files, hashes, excluded};
  }
  async preview(changes) {
    if (!Array.isArray(changes) || !changes.length || changes.length > 100) throw Error('Expected 1–100 file changes');
    const seen = new Set(), prepared = [];
    for (const change of changes) {
      const path = this.normalize(change.path); if (seen.has(path)) throw Error('Duplicate file in transaction'); seen.add(path);
      if (change.text !== null && (typeof change.text !== 'string' || Buffer.byteLength(change.text) > this.maxFileBytes || change.text.includes('\0'))) throw Error('Invalid UTF-8 text change');
      const before = await this.text(path, {optional: true}), hash = NativeWorkspace.hash(before);
      if (!Object.hasOwn(change, 'expectedHash') || change.expectedHash !== hash) throw new AgentError('EDIT_CONFLICT', `${path} changed; read the current version before editing`, {status: 409});
      prepared.push({path, before, after: change.text, beforeHash: hash, afterHash: NativeWorkspace.hash(change.text)});
    }
    return prepared;
  }
  async atomicWrite(path, text) {
    const absolute = await this.path(path, {missing: true});
    if (text === null) { await unlink(absolute); return; }
    await mkdir(dirname(absolute), {recursive: true}); await this.path(path, {missing: true});
    let mode = 0o644; try { mode = (await lstat(absolute)).mode & 0o777; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    const temporary = absolute + '.ferrite-' + randomUUID(); let handle;
    try { handle = await open(temporary, 'wx', mode); await handle.writeFile(text, 'utf8'); await handle.sync(); await handle.close(); handle = null; await this.path(path, {missing: true}); await rename(temporary, absolute); }
    finally { await handle?.close(); await rm(temporary, {force: true}); }
  }
  async apply(changes, {label = 'Agent edit', sessionId} = {}) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const edits = await this.preview(changes), id = randomUUID(), checkpoint = {id, label, sessionId, at: new Date().toISOString(), status: 'prepared', edits};
      await this.store?.write('checkpoints', id, checkpoint); const written = [];
      try {
        for (const edit of edits) {
          const current = await this.text(edit.path, {optional: true});
          if (NativeWorkspace.hash(current) !== edit.beforeHash) throw new AgentError('EDIT_CONFLICT', `${edit.path} changed during the transaction`, {status: 409});
          if (edit.before === edit.after) continue;
          await this.atomicWrite(edit.path, edit.after); written.push(edit);
        }
      } catch (error) {
        for (const edit of written.reverse()) {
          try { if (NativeWorkspace.hash(await this.text(edit.path, {optional: true})) === edit.afterHash) await this.atomicWrite(edit.path, edit.before); }
          catch { checkpoint.status = 'recovery-required'; }
        }
        if (checkpoint.status !== 'recovery-required') checkpoint.status = 'failed'; checkpoint.error = error.message; await this.store?.write('checkpoints', id, checkpoint); throw error;
      }
      checkpoint.status = 'applied'; await this.store?.write('checkpoints', id, checkpoint);
      this.events?.emit('workspace.changed', {id, sessionId, label, paths: edits.map(edit => edit.path)});
      return {checkpoint: id, changes: edits.map(({path, beforeHash, afterHash}) => ({path, beforeHash, afterHash}))};
    });
    this.queue = operation; return operation;
  }
  async restore(id, context = {}) {
    const checkpoint = await this.store.read('checkpoints', id);
    if (checkpoint.status !== 'applied') throw new AgentError('CHECKPOINT_STATE', 'Only an applied checkpoint can be restored automatically');
    return this.apply(checkpoint.edits.map(edit => ({path: edit.path, expectedHash: edit.afterHash, text: edit.before})), {...context, label: `Restore ${id}`});
  }
}
