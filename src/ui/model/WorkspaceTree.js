import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

/** Pure, atomic filesystem plans. Empty directories are metadata, never fake source files. */
export class WorkspaceTree {
  static contains(parent, path) { return parent === path || path.startsWith(parent + '/'); }
  static folders(files, explicit = []) {
    if (!Array.isArray(explicit) || explicit.length > 2000) throw Error('Invalid project folders');
    const folders = new Set();
    const add = path => {
      path = V.path(path);
      for (let current = path; current; current = V.directory(current)) {
        if (Object.hasOwn(files, current)) throw Error(`A file blocks directory: ${current}`);
        folders.add(current);
      }
    };
    for (const path of Object.keys(files)) { const parent = V.directory(path); if (parent) add(parent); }
    for (const path of explicit) add(path);
    return folders;
  }
  static move(files, directories, source, target, {copy = false} = {}) {
    source = V.path(source); target = V.path(target);
    const folders = this.folders(files, [...directories]), isFile = Object.hasOwn(files, source);
    if (!isFile && !folders.has(source)) throw Error(`Path does not exist: ${source}`);
    if (source === target || this.contains(source, target)) throw Error('Cannot move a path into itself');
    if (Object.hasOwn(files, target) || folders.has(target)) throw Error(`Path already exists: ${target}`);
    const renamed = Object.create(null);
    if (isFile) renamed[source] = target;
    else for (const path of Object.keys(files)) if (this.contains(source, path)) renamed[path] = target + path.slice(source.length);
    // UI views own a source + manifest + conventional stylesheet. Shared CSS stays shared.
    if (isFile && source.endsWith('.rs')) {
      const manifest = source.replace(/(?:\.ui)?\.rs$/, '.ui.json');
      if (Object.hasOwn(files, manifest)) {
        const next = target.replace(/(?:\.ui)?\.rs$/, '.ui.json');
        if (!target.endsWith('.rs')) throw Error('UI view sources must retain the .rs extension');
        renamed[manifest] = next;
        const settings = JSON.parse(files[manifest]), css = manifest.replace(/\.json$/, '.css');
        if (settings.stylesheet === css && Object.hasOwn(files, css)) {
          const shared = Object.entries(files).some(([path, text]) => path !== manifest && path.endsWith('.ui.json') && (() => { try { return JSON.parse(text).stylesheet === css; } catch { return false; } })());
          if (!shared) renamed[css] = next.replace(/\.json$/, '.css');
        }
      }
    }
    const next = {...files};
    if (!copy) for (const path of Object.keys(renamed)) delete next[path];
    for (const [path, destination] of Object.entries(renamed)) {
      if (Object.hasOwn(next, destination) || folders.has(destination)) throw Error(`Path already exists: ${destination}`);
      next[destination] = files[path];
    }
    for (const [path, text] of Object.entries(next)) {
      if (!path.endsWith('.ui.json') || copy && !Object.values(renamed).includes(path)) continue;
      let settings; try { settings = JSON.parse(text); } catch { continue; }
      if (settings?.version !== 1) continue;
      let changed = false;
      for (const key of ['entryFile', 'stylesheet']) if (Object.hasOwn(renamed, settings[key])) { settings[key] = renamed[settings[key]]; changed = true; }
      if (changed) next[path] = JSON.stringify(settings, null, 2) + '\n';
    }
    const nextFolders = [...folders].flatMap(path => {
      if (isFile || !this.contains(source, path)) return [path];
      return copy ? [path, target + path.slice(source.length)] : [target + path.slice(source.length)];
    });
    if (!isFile) nextFolders.push(target);
    const candidate = V.validate(next);
    return {files: candidate, folders: this.folders(candidate, nextFolders), renamed: copy ? {} : renamed, source, target, copy};
  }
  static remove(files, directories, source) {
    source = V.path(source); const folders = this.folders(files, [...directories]);
    if (!Object.hasOwn(files, source) && !folders.has(source)) throw Error(`Path does not exist: ${source}`);
    const deleted = Object.keys(files).filter(path => this.contains(source, path));
    const next = {...files}; for (const path of deleted) delete next[path];
    const candidate = V.validate(next);
    return {files: candidate, folders: this.folders(candidate, [...folders].filter(path => !this.contains(source, path))), deleted};
  }
}
