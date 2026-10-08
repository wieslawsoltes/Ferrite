import {readdir} from 'node:fs/promises';
import {RepositoryPolicy as P} from './RepositoryPolicy.js';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Bounded editable projection. Omitted assets remain on disk and participate in native builds. */
export class RepositorySnapshot {
  static async read(root, {manifest = 'Cargo.toml', signal, maxFiles = V.MAX_FILES, maxBytes = 8 * 1024 * 1024} = {}) {
    P.path(manifest);
    const candidates = [], omitted = []; let scanned = 0;
    const walk = async (directory = '') => {
      signal?.throwIfAborted();
      const entries = await readdir(directory ? await P.target(root, directory) : root, {withFileTypes: true});
      entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
      for (const entry of entries) {
        if (++scanned > 50000) throw Error('Repository scan exceeds 50,000 entries; open a smaller Cargo root');
        const path = directory ? `${directory}/${entry.name}` : entry.name;
        if (P.ignored(path)) continue;
        try { P.path(path); } catch { omitted.push({path, reason: 'editor path policy'}); continue; }
        if (entry.isSymbolicLink()) omitted.push({path, reason: 'symlink'});
        else if (entry.isDirectory()) await walk(path);
        else if (entry.isFile()) candidates.push(path);
      }
    };
    await walk();
    const priority = path => path === manifest ? 0 : path.endsWith('Cargo.toml') ? 1 : path.endsWith('.rs') ? 2 : path.endsWith('Cargo.lock') ? 3 : 4;
    candidates.sort((a, b) => priority(a) - priority(b) || a.localeCompare(b, 'en'));
    const files = Object.create(null); let bytes = 0, count = 0;
    for (const path of candidates) {
      signal?.throwIfAborted();
      if (count >= maxFiles) { omitted.push({path, reason: 'editor file limit'}); continue; }
      try {
        const data = await P.read(root, path);
        if (data.bytes.includes(0)) throw Error('binary');
        const text = new TextDecoder('utf-8', {fatal: true, ignoreBOM: true}).decode(data.bytes);
        if (bytes + data.bytes.length > maxBytes) throw Error('editor byte limit');
        files[path] = text; bytes += data.bytes.length; count++;
      } catch (error) { if (error.name === 'AbortError') throw error; omitted.push({path, reason: error.message}); }
    }
    if (!Object.hasOwn(files, manifest)) throw Error(`Cannot load selected manifest ${manifest}`);
    return {files, manifests: candidates.filter(p => p.split('/').at(-1) === 'Cargo.toml'),
      omitted: omitted.slice(0, 200), omittedCount: omitted.length, bytes};
  }
}
