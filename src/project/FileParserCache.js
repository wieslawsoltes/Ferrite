import {Lexer} from '../compiler/Lexer.js';
import {Parser} from '../compiler/Parser.js';

/** Exact-content, file-aware parsing cache; a changed file never reuses stale syntax. */
export class FileParserCache {
  constructor({maxEntries = 256, maxCharacters = 4_000_000} = {}) {
    this.entries = new Map(); this.maxEntries = maxEntries; this.maxCharacters = maxCharacters; this.characters = 0;
  }
  parse(file, source) {
    const cached = this.entries.get(file);
    if (cached?.source === source) { this.entries.delete(file); this.entries.set(file, cached); return {...cached, cached: true}; }
    const start = performance.now(), tokens = Lexer.tokenize(source, {file}), lexMs = performance.now() - start;
    const parseStart = performance.now(), ast = Parser.parse(tokens), parseMs = performance.now() - parseStart;
    const result = {file, source, tokens, ast, lexMs, parseMs};
    if (cached) this.characters -= cached.source.length;
    this.entries.delete(file); this.entries.set(file, result); this.characters += source.length;
    while (this.entries.size > this.maxEntries || this.characters > this.maxCharacters) {
      const key = this.entries.keys().next().value; this.characters -= this.entries.get(key).source.length; this.entries.delete(key);
    }
    return {...result, cached: false};
  }
  clear() { this.entries.clear(); this.characters = 0; }
}
