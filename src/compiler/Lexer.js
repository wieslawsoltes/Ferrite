import {Diagnostic} from './Diagnostic.js';

const IDENT_START = /[\p{ID_Start}_]/u;
const IDENT_CONTINUE = /[\p{ID_Continue}_]/u;
const KEYWORDS = new Set('as async await break const continue else enum false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while dyn'.split(' '));
const OPERATORS = ['..=', '::', '->', '=>', '==', '!=', '<=', '>=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '..'];

/** A deterministic scanner; nested comments and raw strings are lexed atomically. */
export class Lexer {
  constructor(source, {file = 'src/main.rs', trivia = false, maxTokens = 200000} = {}) {
    if (typeof source !== 'string') throw new TypeError('Expected source text');
    if (source.length > 2_000_000) throw new Diagnostic('F0001', 'Source exceeds the 2 MB per-file limit');
    this.source = source;
    this.file = file;
    this.trivia = trivia;
    this.maxTokens = maxTokens;
    this.offset = 0;
    this.line = 1;
    this.column = 1;
    this.tokens = [];
  }
  position() { return {file: this.file, start: this.offset, line: this.line, column: this.column}; }
  advance() {
    const c = this.source[this.offset++];
    if (c === '\n') { this.line++; this.column = 1; } else this.column++;
    return c;
  }
  emit(kind, start) {
    const span = {...start, end: this.offset, endLine: this.line, endColumn: this.column};
    this.tokens.push({kind, value: this.source.slice(start.start, span.end), offset: start.start, end: span.end,
      file: this.file, line: start.line, column: start.column, span});
    if (this.tokens.length > this.maxTokens) throw new Diagnostic('F0002', 'Token budget exceeded', span);
  }
  error(message, start) { throw new Diagnostic('E0001', message, {...start, end: this.offset}); }
  scan() {
    while (this.offset < this.source.length) {
      const start = this.position();
      const c = this.source[this.offset];
      if (/\s/.test(c)) {
        while (this.offset < this.source.length && /\s/.test(this.source[this.offset])) this.advance();
        if (this.trivia) this.emit('whitespace', start);
        continue;
      }
      if (this.source.startsWith('//', this.offset)) {
        while (this.offset < this.source.length && this.source[this.offset] !== '\n') this.advance();
        if (this.trivia) this.emit('comment', start);
        continue;
      }
      if (this.source.startsWith('/*', this.offset)) {
        this.advance(); this.advance();
        let depth = 1;
        while (depth && this.offset < this.source.length) {
          if (this.source.startsWith('/*', this.offset)) { this.advance(); this.advance(); depth++; }
          else if (this.source.startsWith('*/', this.offset)) { this.advance(); this.advance(); depth--; }
          else this.advance();
        }
        if (depth) this.error('Unterminated block comment', start);
        if (this.trivia) this.emit('comment', start);
        continue;
      }
      const raw = /^r(#+)?"/.exec(this.source.slice(this.offset));
      if (raw) {
        for (let n = 0; n < raw[0].length; n++) this.advance();
        const end = '"' + (raw[1] ?? '');
        while (this.offset < this.source.length && !this.source.startsWith(end, this.offset)) this.advance();
        if (this.offset === this.source.length) this.error('Unterminated raw string', start);
        for (let n = 0; n < end.length; n++) this.advance();
        this.emit('string', start);
        continue;
      }
      if (c === '"' || c === "'") {
        if (c === "'" && /^'[A-Za-z_]\w*(?!')/.test(this.source.slice(this.offset))) {
          const match = /^'[A-Za-z_]\w*/.exec(this.source.slice(this.offset))[0];
          if (this.source[this.offset + match.length] !== "'") {
            for (let n = 0; n < match.length; n++) this.advance();
            this.emit('lifetime', start);
            continue;
          }
        }
        this.advance();
        let closed = false;
        while (this.offset < this.source.length) {
          const next = this.advance();
          if (next === c) { closed = true; break; }
          if (next === '\\' && this.offset < this.source.length) this.advance();
        }
        if (!closed) this.error('Unterminated string or character literal', start);
        this.emit(c === '"' ? 'string' : 'char', start);
        continue;
      }
      if (/[0-9]/.test(c)) {
        const match = /^(?:0[xX][0-9a-fA-F_]+|0[bB][01_]+|0[oO][0-7_]+|[0-9][0-9_]*(?:\.[0-9][0-9_]*)?(?:[eE][+-]?[0-9_]+)?)(?:u(?:8|16|32|64|128|size)|i(?:8|16|32|64|128|size)|f(?:32|64))?/.exec(this.source.slice(this.offset));
        for (let n = 0; n < match[0].length; n++) this.advance();
        this.emit('number', start);
        continue;
      }
      const point = String.fromCodePoint(this.source.codePointAt(this.offset));
      if (IDENT_START.test(point)) {
        for (let n = 0; n < point.length; n++) this.advance();
        while (this.offset < this.source.length) {
          const next = String.fromCodePoint(this.source.codePointAt(this.offset));
          if (!IDENT_CONTINUE.test(next)) break;
          for (let n = 0; n < next.length; n++) this.advance();
        }
        this.emit(KEYWORDS.has(this.source.slice(start.start, this.offset)) ? 'keyword' : 'identifier', start);
        continue;
      }
      const operator = OPERATORS.find(value => this.source.startsWith(value, this.offset));
      if (operator) {
        for (let n = 0; n < operator.length; n++) this.advance();
        this.emit('operator', start);
      } else if ('{}()[],:;.!<>+=*/%&|-?#'.includes(c)) {
        this.advance(); this.emit('punctuation', start);
      } else this.error(`Unexpected character ${JSON.stringify(c)}`, start);
    }
    const start = this.position();
    this.emit('eof', start);
    this.tokens.at(-1).value = 'EOF';
    return this.tokens;
  }
  static tokenize(source, options) { return new Lexer(source, options).scan(); }
  static decode(text) {
    const raw = /^r(#+)?"([\s\S]*)"\1$/.exec(text);
    if (raw) return raw[2];
    const body = text.slice(1, -1);
    return body.replace(/\\(?:u\{([\da-fA-F_]+)\}|x([\da-fA-F]{2})|([\s\S]))/g, (_, unicode, hex, escape) => {
      if (unicode) return String.fromCodePoint(parseInt(unicode.replaceAll('_', ''), 16));
      if (hex) return String.fromCharCode(parseInt(hex, 16));
      const values = {'n': '\n', 'r': '\r', 't': '\t', '0': '\0', '\\': '\\', '"': '"', "'": "'"};
      if (!(escape in values)) throw new Diagnostic('E0002', `Unsupported escape \\${escape}`);
      return values[escape];
    });
  }
}
