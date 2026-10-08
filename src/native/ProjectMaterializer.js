import {mkdtemp, mkdir, writeFile, readFile, rm, lstat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join, resolve, dirname, sep} from 'node:path';
import {VirtualFileSystem} from '../project/VirtualFileSystem.js';

/** Materialize trusted native projects in one owned, reusable directory. */
export class ProjectMaterializer {
  constructor(root) { this.root = root; this.previous = new Map(); }
  static validate(snapshot) {
    const files = VirtualFileSystem.validate(snapshot?.files);
    if (!Object.hasOwn(files, 'Cargo.toml')) throw Error('Missing Cargo.toml');
    for (const key of Object.keys(snapshot.files)) if (key !== VirtualFileSystem.path(key) || key.split('/').includes('..')) throw Error(`Noncanonical project path ${key}`);
    return files;
  }
  static async create(snapshot) {
    const root = await mkdtemp(join(tmpdir(), 'ferrite-cargo-')), materializer = new ProjectMaterializer(root);
    try { await materializer.update(snapshot); return materializer; }
    catch (error) { await materializer.dispose(); throw error; }
  }
  async safePath(path) {
    const target = resolve(this.root, path);
    if (!target.startsWith(this.root + sep)) throw Error('Project path escapes its root');
    const parts = path.split('/'); let parent = this.root;
    for (const part of parts) {
      parent = join(parent, part);
      try { if ((await lstat(parent)).isSymbolicLink()) throw Error(`Native project contains a symlink at ${path}`); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    return target;
  }
  async update(snapshot) {
    const files = ProjectMaterializer.validate(snapshot);
    for (const path of this.previous.keys()) if (!Object.hasOwn(files, path)) await rm(await this.safePath(path), {force: true});
    for (const [path, text] of Object.entries(files)) if (this.previous.get(path) !== text) {
      const target = await this.safePath(path); await mkdir(dirname(target), {recursive: true}); await writeFile(target, text, 'utf8');
    }
    this.previous = new Map(Object.entries(files));
  }
  async outputFiles() {
    const files = {};
    for (const path of ['Cargo.lock', 'Cargo.toml']) try { files[path] = await readFile(await this.safePath(path), 'utf8'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return files;
  }
  async dispose() { await rm(this.root, {recursive: true, force: true}); }
}
