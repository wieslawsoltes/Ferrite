import {FileMask} from './FileMask.js';
import {SourceFile} from '../../project/SourceFile.js';

/** Bounded literal search. Escaped regular expressions preserve UTF-16 offsets during Unicode case folding. */
export class WorkspaceSearch {
  constructor({maxResults = 2000, yieldTask = () => new Promise(resolve => setTimeout(resolve, 0))} = {}) {
    if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 10000) throw Error('Invalid search result limit');
    this.maxResults = maxResults; this.yieldTask = yieldTask;
  }
  static escape(text) { return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  static globList(value = '') {
    if (typeof value !== 'string' || value.length > 1024) throw Error('File masks exceed 1024 characters');
    return value.split(',').map(part => part.trim()).filter(Boolean).map(pattern => new FileMask(pattern));
  }

  static wordBefore(text, offset) {
    if (!offset) return '';
    const last = text.charCodeAt(offset - 1);
    return text.slice(last >= 0xdc00 && last <= 0xdfff ? offset - 2 : offset - 1, offset);
  }
  static wordAfter(text, offset) { return offset < text.length ? String.fromCodePoint(text.codePointAt(offset)) : ''; }
  static wordCharacter(character) { return !!character && /[\p{L}\p{N}\p{M}_]/u.test(character); }
  async find(files, query, {caseSensitive = false, wholeWord = false, include = '', exclude = '', file = null, revision = 0, signal} = {}) {
    if (typeof query !== 'string' || query.length > 1024) throw Error('Search text exceeds 1024 UTF-16 units');
    const result = {query, revision, matches: [], sources: Object.create(null), scannedFiles: 0, truncated: false};
    if (!query) return result;
    const inclusions = WorkspaceSearch.globList(include), exclusions = WorkspaceSearch.globList(exclude);
    const expression = new RegExp(WorkspaceSearch.escape(query), caseSensitive ? 'gu' : 'giu');
    const check = () => { if (signal?.aborted) throw new DOMException('Search cancelled', 'AbortError'); };
    let sliceStart = performance.now();
    for (const path of Object.keys(files).sort()) {
      check();
      if (file && file !== path || inclusions.length && !inclusions.some(mask => mask.test(path)) || exclusions.some(mask => mask.test(path))) continue;
      const text = files[path]; if (typeof text !== 'string') throw Error('Only text files can be searched');
      result.scannedFiles++; expression.lastIndex = 0; let source = null, match;
      while ((match = expression.exec(text))) {
        check(); if (performance.now() - sliceStart > 8) { await this.yieldTask(); check(); sliceStart = performance.now(); }
        const start = match.index, end = start + match[0].length;
        if (wholeWord && (WorkspaceSearch.wordCharacter(WorkspaceSearch.wordBefore(text, start)) || WorkspaceSearch.wordCharacter(WorkspaceSearch.wordAfter(text, end)))) continue;
        if (result.matches.length === this.maxResults) { result.truncated = true; return result; }
        source ??= new SourceFile(path, text); result.sources[path] = text;
        const lineStart = text.lastIndexOf('\n', start - 1) + 1;
        const newline = text.indexOf('\n', end), lineEnd = newline < 0 ? text.length : newline;
        result.matches.push({span: source.span(start, end), text: match[0], before: text.slice(Math.max(lineStart, start - 80), start), after: text.slice(end, Math.min(lineEnd, end + 120))});
        if (performance.now() - sliceStart > 8) { await this.yieldTask(); check(); sliceStart = performance.now(); }
      }
      if (performance.now() - sliceStart > 8) { await this.yieldTask(); check(); sliceStart = performance.now(); }
    }
    check(); return result;
  }
}
