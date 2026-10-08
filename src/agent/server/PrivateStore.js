import {mkdir, open, readFile, readdir, rename, rm, lstat, chmod} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {randomUUID, createHash} from 'node:crypto';
import {AgentError} from '../core/AgentError.js';

/** Atomic private persistence, outside source control. Session files never include API keys. */
export class PrivateStore {
  constructor(root) { this.root = resolve(root); this.writes = new Map(); }
  async initialize() {
    await mkdir(this.root, {recursive: true, mode: 0o700});
    if ((await lstat(this.root)).isSymbolicLink()) throw Error('State directory must not be a symlink');
    await chmod(this.root, 0o700);
    for (const directory of ['sessions', 'artifacts', 'checkpoints']) {
      const path = join(this.root, directory);
      await mkdir(path, {recursive: true, mode: 0o700});
      const stat = await lstat(path);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('Private storage directories must be real directories');
      await chmod(path, 0o700);
    }
    return this;
  }
  path(kind, id) {
    if (!['sessions', 'artifacts', 'checkpoints'].includes(kind) || !/^[a-zA-Z0-9-]{1,100}$/.test(id)) throw new AgentError('INVALID_ID', 'Invalid storage identifier');
    return join(this.root, kind, id + '.json');
  }
  async write(kind, id, value) {
    const path = this.path(kind, id), text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 48 * 1024 * 1024) throw new AgentError('SESSION_LIMIT', 'Session storage exceeds 48 MiB; start a new session');
    const previous = this.writes.get(path) ?? Promise.resolve();
    const operation = previous.catch(() => {}).then(async () => {
      const temporary = path + '.' + randomUUID() + '.tmp'; let handle;
      try { handle = await open(temporary, 'wx', 0o600); await handle.writeFile(text); await handle.sync(); await handle.close(); handle = null; await rename(temporary, path); }
      finally { await handle?.close(); await rm(temporary, {force: true}); }
    });
    this.writes.set(path, operation);
    try { await operation; } finally { if (this.writes.get(path) === operation) this.writes.delete(path); }
  }
  async read(kind, id) {
    const path = this.path(kind, id); if ((await lstat(path)).isSymbolicLink()) throw Error('State file must not be a symlink');
    return JSON.parse(await readFile(path, 'utf8'));
  }
  async list(kind) {
    this.path(kind, 'validate'); const entries = await readdir(join(this.root, kind));
    return entries.filter(path => /^[a-zA-Z0-9-]+\.json$/.test(path)).map(path => path.slice(0, -5));
  }
  async put(text) { const id = createHash('sha256').update(text).digest('hex'); await this.write('artifacts', id, {text}); return id; }
  async artifact(id, offset = 0, length = 16000) {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > 24000) throw Error('Invalid artifact range');
    const {text} = await this.read('artifacts', id); return {id, offset, text: text.slice(offset, offset + length), totalCharacters: text.length, nextOffset: offset + length < text.length ? offset + length : null};
  }
}
