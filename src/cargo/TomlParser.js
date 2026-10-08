import {SourceFile} from '../project/SourceFile.js';

/** Cargo-oriented TOML reader with quoted keys, multiline values and array tables. */
export class TomlParser {
  constructor() { this.source = ''; this.i = 0; this.depth = 0; }
  error(message) { const error = Error(message); error.offset = this.i; throw error; }
  whitespace(multiline = false) {
    for (;;) {
      while (this.i < this.source.length && (multiline ? /\s/ : /[ \t\r]/).test(this.source[this.i])) this.i++;
      if (this.source[this.i] === '#') { while (this.i < this.source.length && this.source[this.i] !== '\n') this.i++; }
      else break;
      if (!multiline) break;
    }
  }
  consume(value) {
    if (!this.source.startsWith(value, this.i)) this.error(`Expected '${value}'`);
    this.i += value.length;
  }
  key() {
    this.whitespace(); const result = [];
    for (;;) {
      let value;
      if (this.source[this.i] === '"' || this.source[this.i] === "'") value = this.string();
      else { const match = /^[A-Za-z0-9_-]+/.exec(this.source.slice(this.i)); if (!match) this.error('Expected a TOML key'); value = match[0]; this.i += value.length; }
      if (['__proto__', 'prototype', 'constructor'].includes(value)) this.error(`Reserved TOML key ${value}`);
      result.push(value); this.whitespace();
      if (this.source[this.i] !== '.') break;
      this.i++; this.whitespace();
    }
    return result;
  }
  string() {
    const quote = this.source[this.i], triple = this.source.startsWith(quote.repeat(3), this.i);
    this.i += triple ? 3 : 1; if (triple && this.source[this.i] === '\n') this.i++;
    let value = '';
    while (this.i < this.source.length) {
      if (triple ? this.source.startsWith(quote.repeat(3), this.i) : this.source[this.i] === quote) { this.i += triple ? 3 : 1; return value; }
      const char = this.source[this.i++];
      if (char === '\n' && !triple) this.error('Newline in single-line TOML string');
      if (char !== '\\' || quote === "'") { value += char; continue; }
      if (triple && /\s/.test(this.source[this.i] ?? '')) { this.whitespace(true); continue; }
      const escaped = this.source[this.i++], escapes = {b: '\b', t: '\t', n: '\n', f: '\f', r: '\r', '"': '"', '\\': '\\'};
      if (Object.hasOwn(escapes, escaped)) value += escapes[escaped];
      else if (escaped === 'u' || escaped === 'U') {
        const length = escaped === 'u' ? 4 : 8, digits = this.source.slice(this.i, this.i + length);
        if (!new RegExp(`^[0-9a-fA-F]{${length}}$`).test(digits)) this.error('Invalid Unicode escape');
        const cp = parseInt(digits, 16); if (cp > 0x10ffff || (cp >= 0xd800 && cp <= 0xdfff)) this.error('Invalid Unicode scalar');
        value += String.fromCodePoint(cp); this.i += length;
      } else this.error(`Invalid string escape \\${escaped}`);
    }
    this.error('Unterminated TOML string');
  }
  value() {
    if (++this.depth > 64) this.error('TOML nesting limit exceeded');
    try {
      this.whitespace(true); const c = this.source[this.i];
      if (c === '"' || c === "'") return this.string();
      if (c === '[') {
        this.i++; const values = []; this.whitespace(true);
        while (this.source[this.i] !== ']') {
          values.push(this.value()); this.whitespace(true);
          if (this.source[this.i] !== ',') break;
          this.i++; this.whitespace(true);
        }
        this.consume(']'); return values;
      }
      if (c === '{') {
        this.i++; const value = {}; this.whitespace();
        while (this.source[this.i] !== '}') {
          const keys = this.key(); this.consume('='); this.assign(value, keys, this.value()); this.whitespace();
          if (this.source[this.i] !== ',') break;
          this.i++; this.whitespace();
        }
        this.consume('}'); return value;
      }
      const raw = /^[^\s,\]}#]+/.exec(this.source.slice(this.i))?.[0];
      if (!raw) this.error('Missing TOML value'); this.i += raw.length;
      if (raw === 'true' || raw === 'false') return raw === 'true';
      const number = raw.replaceAll('_', '');
      if (/^[+-]?(?:\d+|0x[0-9a-fA-F]+|0o[0-7]+|0b[01]+)$/.test(number)) {
        const numeric = Number(number); if (!Number.isSafeInteger(numeric)) this.error('Manifest integer is outside JavaScript safe-integer range'); return numeric;
      }
      if (/^[+-]?(?:\d+\.\d+(?:e[+-]?\d+)?|\d+e[+-]?\d+)$/i.test(number)) return Number(number);
      if (/^[+-]?(inf|nan)$/.test(number)) return number.includes('nan') ? NaN : number.startsWith('-') ? -Infinity : Infinity;
      if (/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw)) return raw;
      this.error(`Unsupported TOML value '${raw}'`);
    } finally { this.depth--; }
  }
  table(root, path) {
    let current = root;
    for (const key of path) {
      if (Array.isArray(current)) current = current.at(-1);
      if (!current || typeof current !== 'object') this.error(`TOML table '${path.join('.')}' conflicts with a scalar`);
      if (!Object.hasOwn(current, key)) current[key] = Object.create(null);
      current = current[key];
    }
    if (Array.isArray(current)) current = current.at(-1);
    if (!current || typeof current !== 'object') this.error(`TOML table '${path.join('.')}' conflicts with a scalar`);
    return current;
  }
  assign(root, keys, value) {
    const leaf = keys.at(-1), target = this.table(root, keys.slice(0, -1));
    if (Object.hasOwn(target, leaf)) this.error(`Duplicate TOML key ${keys.join('.')}`);
    target[leaf] = value;
  }
  parseValue(source) { this.source = source; this.i = 0; this.depth = 0; const value = this.value(); this.whitespace(); if (this.i !== source.length) this.error('Unexpected TOML input'); return value; }
  parse(source, {file = 'Cargo.toml'} = {}) {
    this.source = source; this.i = 0; this.depth = 0;
    const sections = Object.create(null), errors = [], spans = Object.create(null), sourceFile = new SourceFile(file, source);
    let path = [], current = sections;
    while (this.i < source.length) {
      this.whitespace(true); if (this.i >= source.length) break;
      const start = this.i;
      try {
        if (source[this.i] === '[') {
          this.i++; const array = source[this.i] === '['; if (array) this.i++;
          path = this.key(); this.consume(array ? ']]' : ']');
          if (array) {
            const parent = this.table(sections, path.slice(0, -1)), key = path.at(-1);
            if (!Object.hasOwn(parent, key)) parent[key] = [];
            if (!Array.isArray(parent[key])) this.error('Array table conflicts with a standard table');
            current = Object.create(null); parent[key].push(current);
          } else current = this.table(sections, path);
          spans[path.join('.')] = sourceFile.span(start, this.i);
        } else {
          const keys = this.key(); this.consume('='); this.assign(current, keys, this.value());
          spans[[...path, ...keys].join('.')] = sourceFile.span(start, this.i);
        }
        this.whitespace(); if (this.i < source.length && source[this.i] !== '\n') this.error('Unexpected characters after TOML value');
      } catch (error) {
        errors.push({line: sourceFile.position(error.offset ?? start).line, message: error.message, span: sourceFile.span(start, Math.max(start + 1, this.i))});
        while (this.i < source.length && source[this.i] !== '\n') this.i++;
        this.depth = 0;
      }
    }
    return {package: sections.package ?? {}, dependencies: sections.dependencies ?? {}, sections, spans, errors};
  }
}
