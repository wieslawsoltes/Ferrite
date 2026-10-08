import {Diagnostic} from '../compiler/Diagnostic.js';
import {VirtualFileSystem as V} from './VirtualFileSystem.js';
import {FileParserCache} from './FileParserCache.js';

/** Resolve AST module declarations, never regular expressions over Rust source text. */
export class ModuleResolver {
  constructor(files, cache = new FileParserCache()) {
    this.files = files; this.cache = cache; this.records = new Map(); this.edges = []; this.active = [];
  }
  resolve(entry, {crateRoot = '', dependency = false} = {}) {
    const directory = V.directory(entry);
    const items = this.file(entry, directory, crateRoot, crateRoot, dependency);
    return {kind: 'crate', items};
  }
  file(path, moduleDirectory, namespace, crateRoot, dependency) {
    if (this.active.includes(path)) throw new Diagnostic('E0583', `Module cycle: ${[...this.active, path].join(' → ')}`);
    if (!Object.hasOwn(this.files, path)) throw new Diagnostic('E0583', `Missing Rust module ${path}`);
    this.active.push(path);
    const parsed = this.records.get(path) ?? this.cache.parse(path, this.files[path]); this.records.set(path, parsed);
    try { return this.items(parsed.ast.items, moduleDirectory, namespace, crateRoot, dependency); }
    finally { this.active.pop(); }
  }
  items(items, directory, namespace, crateRoot, dependency) {
    return items.map(item => {
      const result = {...item, module: namespace, crateRoot, dependency};
      if (item.kind !== 'mod') return result;
      const nextNamespace = [namespace, item.name].filter(Boolean).join('::');
      const nested = V.path(item.name, directory);
      if (!item.external) return {...result, items: this.items(item.items, nested, nextNamespace, crateRoot, dependency)};
      const direct = nested + '.rs', indirect = nested + '/mod.rs';
      if (Object.hasOwn(this.files, direct) && Object.hasOwn(this.files, indirect)) throw new Diagnostic('E0761', `Module '${item.name}' exists at both ${direct} and ${indirect}`, item.span);
      const path = Object.hasOwn(this.files, direct) ? direct : indirect;
      if (!Object.hasOwn(this.files, path)) throw new Diagnostic('E0583', `Missing Rust module '${item.name}': expected ${direct} or ${indirect}`, item.span);
      this.edges.push({from: item.span.file, to: path, namespace: nextNamespace, span: item.span});
      return {...result, external: false, file: path, items: this.file(path, nested, nextNamespace, crateRoot, dependency)};
    });
  }
  get result() {
    return {files: [...this.records.values()].map(({file, source, tokens, cached, lexMs, parseMs}) => ({file, source, tokens, cached, lexMs: cached ? 0 : lexMs, parseMs: cached ? 0 : parseMs})), edges: this.edges};
  }
}
