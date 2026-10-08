/** Validated text-only project boundary. No prototype keys or ambient filesystem access. */
export class VirtualFileSystem {
  static MAX_FILES = 1000;
  static MAX_BYTES = 10 * 1024 * 1024;
  static path(input, base = '') {
    if (typeof input !== 'string' || input.startsWith('/') || /[\\\0:]/.test(input)) throw Error(`Invalid project path: ${input}`);
    const result = base ? base.split('/').filter(Boolean) : [];
    for (const part of input.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') { if (!result.length) throw Error('Project path escapes its root'); result.pop(); }
      else {
        if (!/^[\p{L}\p{N}_ .@+-]+$/u.test(part) || ['__proto__', 'prototype', 'constructor', '.git'].includes(part)) throw Error(`Unsafe project path: ${part}`);
        result.push(part);
      }
    }
    if (!result.length) throw Error('Empty project path');
    return result.join('/');
  }
  static directory(path) { return path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : ''; }
  static validate(files) {
    if (!files || typeof files !== 'object' || Array.isArray(files)) throw Error('A project must contain a text file map');
    const entries = Object.entries(files);
    if (!entries.length || entries.length > this.MAX_FILES) throw Error(`Project file count must be between 1 and ${this.MAX_FILES}`);
    const output = Object.create(null); let bytes = 0;
    for (const [input, content] of entries) {
      const path = this.path(input);
      if (typeof content !== 'string') throw Error(`Non-text file: ${path}`);
      if (Object.hasOwn(output, path)) throw Error(`Duplicate normalized file: ${path}`);
      bytes += new TextEncoder().encode(content).length;
      if (bytes > this.MAX_BYTES) throw Error('Project exceeds the 10 MiB text limit');
      output[path] = content;
    }
    return output;
  }
  constructor(files) { this.files = VirtualFileSystem.validate(files); }
  has(path) { return Object.hasOwn(this.files, path); }
  read(path) { if (!this.has(path)) throw Error(`Missing project file: ${path}`); return this.files[path]; }
}
