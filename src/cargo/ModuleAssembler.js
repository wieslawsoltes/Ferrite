import {Lexer} from '../compiler/Lexer.js';
import {VirtualFileSystem as V} from '../project/VirtualFileSystem.js';

/** Legacy text-export API. The compiler uses ModuleResolver ASTs, not this flattened view. */
export class ModuleAssembler {
  constructor(files) { this.files = files; this.parts = []; this.length = 0; this.modules = []; this.active = new Set(); this.sourceMap = []; }
  append(path, text, offset) {
    if (!text.length) return;
    if (this.length) { this.parts.push('\n'); this.length++; }
    this.sourceMap.push({path, start: this.length, originalOffset: offset, length: text.length});
    this.parts.push(text); this.length += text.length;
  }
  visit(path, directory) {
    if (this.active.has(path)) throw Error(`Cyclic module declaration: ${path}`);
    if (typeof this.files[path] !== 'string') throw Error(`Missing Rust module ${path}`);
    this.active.add(path); this.modules.push(path);
    const source = this.files[path], tokens = Lexer.tokenize(source, {file: path}); let cursor = 0, depth = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]; if (token.value === '{') depth++; if (token.value === '}') depth--;
      if (depth !== 0 || token.value !== 'mod' || tokens[i + 1]?.kind !== 'identifier' || tokens[i + 2]?.value !== ';') continue;
      const start = tokens[i - 1]?.value === 'pub' ? tokens[i - 1].span.start : token.span.start;
      this.append(path, source.slice(cursor, start), cursor);
      const name = tokens[i + 1].value, child = V.path(name, directory), direct = child + '.rs', indirect = child + '/mod.rs';
      if (Object.hasOwn(this.files, direct) && Object.hasOwn(this.files, indirect)) throw Error(`Ambiguous module ${name}`);
      this.visit(Object.hasOwn(this.files, direct) ? direct : indirect, child);
      cursor = tokens[i + 2].span.end; i += 2;
    }
    this.append(path, source.slice(cursor), cursor); this.active.delete(path);
  }
  assemble(entry = 'src/main.rs') { this.visit(entry, V.directory(entry)); return {source: this.parts.join(''), modules: this.modules, sourceMap: this.sourceMap}; }
  static originalForOffset(unit, offset) {
    let low = 0, high = unit.sourceMap.length;
    while (low < high) { const middle = (low + high) >>> 1; if (unit.sourceMap[middle].start <= offset) low = middle + 1; else high = middle; }
    const span = unit.sourceMap[low - 1];
    return span && offset < span.start + span.length ? {path: span.path, offset: span.originalOffset + offset - span.start} : null;
  }
}
