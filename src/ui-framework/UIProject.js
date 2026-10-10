import {VirtualFileSystem} from '../project/VirtualFileSystem.js';

/** Versioned, text-only UI project sidecars. Storage and transactions belong to the host. */
export class UIProject {
  static manifestPath(file) {
    file = VirtualFileSystem.path(file);
    if (!file.endsWith('.rs')) throw Error('A UI entry must be a Rust source file');
    return file.replace(/(?:\.ui)?\.rs$/, '.ui.json');
  }
  static settings(value, entryFile) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid UI project settings');
    const known = new Set(['version', 'entryFile', 'entry', 'backend', 'stylesheet', 'viewport', 'grid', 'snap', 'maxSteps']);
    if (Object.keys(value).some(key => !known.has(key))) throw Error('Unknown UI project setting');
    const file = VirtualFileSystem.path(entryFile);
    if (value.version !== 1 || value.entryFile !== file) throw Error('UI project version or entry file mismatch');
    if (typeof value.entry !== 'string' || !/^[A-Za-z_]\w*(?:::[A-Za-z_]\w*)*$/.test(value.entry) || value.entry.length > 200) throw Error('Invalid UI entry function');
    if (!['javascript', 'mir', 'wasm'].includes(value.backend)) throw Error('Invalid UI project backend');
    if (typeof value.stylesheet !== 'string' || value.stylesheet !== VirtualFileSystem.path(value.stylesheet) || !value.stylesheet.endsWith('.css')) throw Error('A UI stylesheet must be a workspace CSS path');
    if (!['100%', '375px', '768px', '1280px'].includes(value.viewport)) throw Error('Invalid UI viewport');
    if (!Number.isFinite(value.grid) || value.grid < 1 || value.grid > 256 || typeof value.snap !== 'boolean') throw Error('Invalid canvas grid');
    if (value.maxSteps !== undefined && (!Number.isSafeInteger(value.maxSteps) || value.maxSteps < 1 || value.maxSteps > 2_000_000)) throw Error('UI instruction budget must be between 1 and 2,000,000');
    return Object.freeze({...value});
  }
  static load(files, entryFile, {css = ''} = {}) {
    const file = VirtualFileSystem.path(entryFile), manifest = this.manifestPath(file);
    if (typeof files?.[file] !== 'string') throw Error('UI entry source is missing');
    let settings;
    if (Object.hasOwn(files, manifest)) {
      if (typeof files[manifest] !== 'string' || files[manifest].length > 16000) throw Error('UI project manifest exceeds its limit');
      settings = JSON.parse(files[manifest]);
    } else settings = {version: 1, entryFile: file, entry: 'app', backend: 'javascript', stylesheet: manifest.replace(/\.json$/, '.css'), viewport: '100%', grid: 8, snap: true};
    settings = this.settings(settings, file);
    const stylesheet = Object.hasOwn(files, settings.stylesheet) ? files[settings.stylesheet] : css;
    if (typeof stylesheet !== 'string' || stylesheet.length > 500000) throw Error('UI stylesheet exceeds its limit');
    return new UIProject(manifest, settings, stylesheet);
  }
  constructor(manifest, settings, css) { this.manifest = manifest; this.settings = settings; this.css = css; }
  changes(settings = {}, css = this.css) {
    const next = UIProject.settings({...this.settings, ...settings}, this.settings.entryFile);
    if (typeof css !== 'string' || css.length > 500000) throw Error('UI stylesheet exceeds its limit');
    return {[this.manifest]: JSON.stringify(next, null, 2) + '\n', [next.stylesheet]: css};
  }
}
