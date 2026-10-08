import {lstat, realpath, open} from 'node:fs/promises';
import {resolve, relative, isAbsolute, sep} from 'node:path';
import {constants} from 'node:fs';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Access control for the editor's file API, not a sandbox for trusted native code. */
export class RepositoryPolicy {
  static contains(root, target) {
    const path = relative(root, target);
    return path === '' || (!isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep));
  }
  static path(path) {
    if (typeof path !== 'string' || V.path(path) !== path) throw Error('Expected a canonical repository-relative path');
    return path;
  }
  static remote(input) {
    if (typeof input !== 'string' || input.length > 2048 || /[\s\x00-\x1f]/.test(input)) throw Error('Invalid Git URL');
    // SCP shorthand is normalized before passing one literal argv element to Git.
    const text = /^git@[^/:]+:[^/].*$/.test(input) ? 'ssh://' + input.replace(':', '/') : input;
    const url = new URL(text);
    if (!['https:', 'ssh:'].includes(url.protocol) || !url.hostname || url.password ||
        (url.username && !(url.protocol === 'ssh:' && url.username === 'git')) || url.search || url.hash || url.pathname === '/')
      throw Error('Use HTTPS or ssh://git@host/path (no embedded credentials, query, or fragment)');
    return url.href;
  }
  static ref(value = '') {
    if (typeof value !== 'string' || value.length > 256 || (value &&
        (!/^[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) || value.includes('..') || value.endsWith('/') || value.endsWith('.lock'))))
      throw Error('Invalid Git branch, tag, or commit');
    return value;
  }
  static async local(path, allowedRoots) {
    if (typeof path !== 'string' || !isAbsolute(path)) throw Error('Use an absolute local repository path');
    const root = await realpath(path);
    const allowed = await Promise.all(allowedRoots.map(value => realpath(value)));
    if (!allowed.some(value => this.contains(value, root))) throw Error('Local path is not authorized. Start the bridge with --allow-root PATH');
    if (!(await lstat(root)).isDirectory()) throw Error('Local repository root must be a directory');
    return root;
  }
  static async target(root, path) {
    this.path(path);
    const target = resolve(root, path);
    if (!this.contains(root, target) || target === root) throw Error('Path escapes repository');
    let current = root;
    for (const part of path.split('/')) {
      current = resolve(current, part);
      try { if ((await lstat(current)).isSymbolicLink()) throw Error(`Editor file access rejects symlinks: ${path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  static async read(root, path, maxBytes = 1024 * 1024) {
    const target = await this.target(root, path);
    const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > maxBytes) throw Error(`File is not a bounded regular file: ${path}`);
      // Read at most maxBytes+1 even if a concurrent writer grows the file.
      const buffer = Buffer.alloc(Math.min(stat.size + 1, maxBytes + 1));
      let used = 0;
      while (used < buffer.length) { const {bytesRead} = await handle.read(buffer, used, buffer.length - used, used); if (!bytesRead) break; used += bytesRead; }
      if (used > maxBytes || used > stat.size) throw Error(`File changed while reading: ${path}`);
      return {bytes: buffer.subarray(0, used), mode: stat.mode};
    } finally { await handle.close(); }
  }
  static ignored(path) {
    const parts = path.split('/'), name = parts.at(-1);
    return parts.some(p => ['.git', 'target', 'target-ra', 'node_modules', '.ssh', '.gnupg'].includes(p)) ||
      /^\.env(?:\.|$)/.test(name) || /\.(pem|key|p12|pfx)$/i.test(name) ||
      (parts.includes('.cargo') && /^credentials(?:\.|$)/.test(name));
  }
}
