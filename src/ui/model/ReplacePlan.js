import {VirtualFileSystem} from '../../project/VirtualFileSystem.js';

/** Immutable literal replacement transaction bound to one exact project revision. No regex substitutions. */
export class ReplacePlan {
  constructor(result, replacement) {
    if (!result || result.truncated) throw Error('Refine the search before replacing: results were truncated');
    if (typeof replacement !== 'string' || replacement.length > VirtualFileSystem.MAX_BYTES) throw Error('Invalid replacement text');
    this.revision = result.revision; this.before = Object.create(null); this.after = Object.create(null); this.count = result.matches.length;
    const groups = new Map();
    for (const match of result.matches) { const path = match.span.file; if (!groups.has(path)) groups.set(path, []); groups.get(path).push(match); }
    let totalOutputUnits = 0;
    for (const [path, matches] of groups) {
      const text = result.sources[path]; if (typeof text !== 'string') throw Error('Replacement lacks original source');
      let cursor = 0, outputUnits = text.length;
      // Bound growth before building chunks; a short query may have thousands of matches.
      for (const match of matches) {
        outputUnits += replacement.length - (match.span.end - match.span.start);
        if (outputUnits > VirtualFileSystem.MAX_BYTES) throw Error('Replacement exceeds the project text limit');
      }
      totalOutputUnits += outputUnits;
      if (totalOutputUnits > VirtualFileSystem.MAX_BYTES) throw Error('Replacement exceeds the project text limit');
      const chunks = [];
      for (const match of matches.toSorted((a, b) => a.span.start - b.span.start)) {
        const {start, end} = match.span;
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < cursor || end <= start || end > text.length || text.slice(start, end) !== match.text) throw Error('Invalid or overlapping replacement span');
        chunks.push(text.slice(cursor, start), replacement); cursor = end;
      }
      chunks.push(text.slice(cursor)); this.before[path] = text; this.after[path] = chunks.join('');
    }
    Object.freeze(this.before); Object.freeze(this.after); Object.freeze(this);
  }
  apply(model) {
    if (this.revision !== model.revision || Object.entries(this.before).some(([path, text]) => model.files[path] !== text)) throw Error('Replacement preview is stale. Search and preview again.');
    if (!this.count) return [];
    VirtualFileSystem.validate({...model.files, ...this.after});
    return model.applyTransaction(this.after);
  }
}
