import {Diagnostic} from './Diagnostic.js';

const IDENT_START = /[\p{XID_Start}_]/u;
const IDENT_CONTINUE = /[\p{XID_Continue}_]/u;
const KEYWORDS = new Set('as async await break const continue else enum false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while dyn extern union'.split(' '));
const OPERATORS = ['<<=', '>>=', '..=', '::', '->', '=>', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '..'];
const NUMBER = /(?:0x[\da-fA-F_]+|0b[01_]+|0o[0-7_]+|\d[\d_]*(?:\.(?![.\p{XID_Start}_])[\d_]*)?(?:[eE][+-]?[\d_]+)?)(?:[ui](?:8|16|32|64|128|size)|f(?:32|64))?/uy;
const asciiStart = c => c === 95 || c >= 65 && c <= 90 || c >= 97 && c <= 122;
const asciiContinue = c => asciiStart(c) || c >= 48 && c <= 57;
const space = c => c === 32 || c >= 9 && c <= 13 || c === 0x85 || c === 0x200e || c === 0x200f || c === 0x2028 || c === 0x2029;

/** Linear source scanner with an ASCII fast path and original UTF-16 spans. */
export class Lexer {
  constructor(source, {file = 'src/main.rs', trivia = false, maxTokens = 200000} = {}) {
    if (typeof source !== 'string') throw new TypeError('Expected source text');
    if (source.length > 2_000_000) throw new Diagnostic('F0001', 'Source exceeds the 2 MB per-file limit');
    this.source = source; this.file = file; this.trivia = trivia; this.maxTokens = maxTokens;
    this.offset = 0; this.line = 1; this.column = 1; this.tokens = [];
  }
  position() { return {file: this.file, start: this.offset, line: this.line, column: this.column}; }
  advance() {
    const c = this.source[this.offset++];
    if (c === '\n') { this.line++; this.column = 1; } else this.column++;
    return c;
  }
  advanceTo(end) { while (this.offset < end) this.advance(); }
  identifierAt(offset, first = false) {
    const code = this.source.codePointAt(offset);
    if (code === undefined) return false;
    return code < 128 ? (first ? asciiStart(code) : asciiContinue(code)) :
      (first ? IDENT_START : IDENT_CONTINUE).test(String.fromCodePoint(code));
  }
  identifierEnd(offset) {
    while (this.identifierAt(offset)) offset += this.source.codePointAt(offset) > 0xffff ? 2 : 1;
    return offset;
  }
  emit(kind, start, value = null) {
    const span = {...start, end: this.offset, endLine: this.line, endColumn: this.column};
    this.tokens.push({kind, value: value ?? this.source.slice(start.start, span.end), offset: start.start, end: span.end,
      file: this.file, line: start.line, column: start.column, span});
    if (this.tokens.length > this.maxTokens) throw new Diagnostic('F0002', 'Token budget exceeded', span);
  }
  error(message, start, code = 'E0001') { throw new Diagnostic(code, message, {...start, end: this.offset}); }
  quoted(start, quote, byte = false) {
    this.advance(); let closed = false;
    while (this.offset < this.source.length) {
      const next = this.advance();
      if (next === quote) { closed = true; break; }
      if (next === '\\' && this.offset < this.source.length) this.advance();
      else if (quote === "'" && (next === '\n' || next === '\r')) this.error('Unterminated character literal', start);
    }
    if (!closed) this.error('Unterminated string or character literal', start);
    const text = this.source.slice(start.start, this.offset);
    // Validate during lexing too: unused literals are not a way to bypass errors.
    try { Lexer.decode(text); } catch (error) {
      if (error instanceof Diagnostic) { error.span = {...start, end: this.offset}; throw error; }
      this.error(error.message, start);
    }
    this.emit(byte ? (quote === "'" ? 'byte' : 'byteString') : quote === '"' ? 'string' : 'char', start);
  }
  raw(start, prefix = 0) {
    let cursor = this.offset + prefix + 1, hashes = 0;
    while (this.source[cursor] === '#') { hashes++; cursor++; }
    if (this.source[cursor] !== '"') return false;
    if (hashes > 255) this.error('Raw string delimiters may contain at most 255 hashes', start);
    const closing = '"' + '#'.repeat(hashes), end = this.source.indexOf(closing, cursor + 1);
    if (end < 0) this.error('Unterminated raw string', start);
    this.advanceTo(end + closing.length);
    const text = this.source.slice(start.start, this.offset);
    try { Lexer.decode(text); } catch (error) { error.span = {...start, end: this.offset}; throw error; }
    this.emit(prefix ? 'byteString' : 'string', start); return true;
  }
  scan() {
    if (this.source.charCodeAt(0) === 0xfeff) this.advance();
    // Rust accepts an interpreter directive, but not an inner attribute, on line 1.
    if (this.source.startsWith('#!', this.offset) && this.source[this.offset + 2] !== '[') {
      const start = this.position();
      while (this.offset < this.source.length && this.source[this.offset] !== '\n') this.advance();
      if (this.trivia) this.emit('comment', start);
    }
    while (this.offset < this.source.length) {
      const start = this.position(), c = this.source[this.offset], code = c.charCodeAt(0);
      if (space(code)) {
        do { this.advance(); } while (space(this.source.charCodeAt(this.offset)));
        if (this.trivia) this.emit('whitespace', start);
        continue;
      }
      if (c === '/' && this.source[this.offset + 1] === '/') {
        while (this.offset < this.source.length && this.source[this.offset] !== '\n') this.advance();
        if (this.trivia) this.emit('comment', start);
        continue;
      }
      if (c === '/' && this.source[this.offset + 1] === '*') {
        this.advance(); this.advance(); let depth = 1;
        while (depth && this.offset < this.source.length) {
          if (this.source.startsWith('/*', this.offset)) { this.advance(); this.advance(); depth++; }
          else if (this.source.startsWith('*/', this.offset)) { this.advance(); this.advance(); depth--; }
          else this.advance();
        }
        if (depth) this.error('Unterminated block comment', start);
        if (this.trivia) this.emit('comment', start);
        continue;
      }
      if (c === 'r' && this.raw(start)) continue;
      if (c === 'b' && this.source[this.offset + 1] === 'r' && this.raw(start, 1)) continue;
      if (c === 'b' && ['"', "'"].includes(this.source[this.offset + 1])) {
        this.advance(); this.quoted(start, this.source[this.offset], true); continue;
      }
      if (c === 'r' && this.source[this.offset + 1] === '#' && this.identifierAt(this.offset + 2, true)) {
        const begin = this.offset + 2, end = this.identifierEnd(begin), name = this.source.slice(begin, end).normalize('NFC');
        this.advanceTo(end);
        if (['_', 'crate', 'self', 'super', 'Self'].includes(name)) this.error(`'${name}' cannot be a raw identifier`, start);
        this.emit('identifier', start, name); this.tokens.at(-1).raw = true; continue;
      }
      if (c === '"' || c === "'") {
        if (c === "'" && this.identifierAt(this.offset + 1, true)) {
          const end = this.identifierEnd(this.offset + 1);
          if (this.source[end] !== "'") { this.advanceTo(end); this.emit('lifetime', start); continue; }
        }
        this.quoted(start, c); continue;
      }
      if (code >= 48 && code <= 57) {
        NUMBER.lastIndex = this.offset;
        const match = NUMBER.exec(this.source);
        this.advanceTo(NUMBER.lastIndex);
        if (!match || this.identifierAt(this.offset)) this.error('Invalid numeric literal or suffix', start);
        if (/^(?:0[xbo]_*$|\d[\d_]*(?:\.[\d_]*)?[eE][+-]?_*)$/.test(match[0])) this.error('Numeric literal requires digits', start);
        this.emit('number', start); continue;
      }
      if (this.identifierAt(this.offset, true)) {
        const end = this.identifierEnd(this.offset), value = this.source.slice(this.offset, end).normalize('NFC');
        this.advanceTo(end); this.emit(KEYWORDS.has(value) ? 'keyword' : 'identifier', start, value); continue;
      }
      const operator = OPERATORS.find(value => this.source.startsWith(value, this.offset));
      if (operator) { this.advanceTo(this.offset + operator.length); this.emit('operator', start); }
      else if ('{}()[],:;.!<>+=*/%&|-?#^@$'.includes(c)) { this.advance(); this.emit('punctuation', start); }
      else this.error(`Unexpected character ${JSON.stringify(c)}`, start);
    }
    this.emit('eof', this.position(), 'EOF'); return this.tokens;
  }
  static tokenize(source, options) { return new Lexer(source, options).scan(); }
  static decode(text) {
    const byte = text[0] === 'b';
    if (byte) text = text.slice(1);
    const raw = /^r(#{0,255})"([\s\S]*)"\1$/.exec(text);
    const char = text[0] === "'";
    const fail = message => { throw new Diagnostic('E0002', message); };
    let body = raw ? raw[2] : text.slice(1, -1), result = '';
    body = body.replaceAll('\r\n', '\n');
    for (let i = 0; i < body.length;) {
      const scalar = body.codePointAt(i), value = String.fromCodePoint(scalar); i += value.length;
      if (scalar === 13 || scalar >= 0xd800 && scalar <= 0xdfff) fail('Literal contains an invalid Unicode scalar or isolated carriage return');
      if (byte && scalar > 127) fail('Byte literals may contain only ASCII characters');
      if (value !== '\\' || raw) { result += value; continue; }
      const escape = body[i++];
      const simple = {n:'\n', r:'\r', t:'\t', 0:'\0', '\\':'\\', '"':'"', "'":"'"};
      if (Object.hasOwn(simple, escape)) { result += simple[escape]; continue; }
      if (escape === '\n' && !char) { while ([' ', '\t', '\n', '\r'].includes(body[i])) i++; continue; }
      if (escape === 'x') {
        const hex = body.slice(i, i + 2);
        if (!/^[\da-fA-F]{2}$/.test(hex)) fail('Hex escapes require exactly two digits');
        const value = parseInt(hex, 16); if (!byte && value > 127) fail('Non-ASCII hex escape in a Unicode literal');
        result += String.fromCharCode(value); i += 2; continue;
      }
      if (escape === 'u' && !byte && body[i] === '{') {
        const end = body.indexOf('}', i + 1), digits = body.slice(i + 1, end), compact = digits.replaceAll('_', '');
        if (end < 0 || !/^[\da-fA-F][\da-fA-F_]*$/.test(digits) || compact.length > 6) fail('Malformed Unicode escape');
        const code = parseInt(compact, 16);
        if (code > 0x10ffff || code >= 0xd800 && code <= 0xdfff) fail('Unicode escape is not a Unicode scalar');
        result += String.fromCodePoint(code); i = end + 1; continue;
      }
      fail(`Unsupported escape \\${escape ?? ''}`);
    }
    if (char && [...result].length !== 1) fail('A character literal must contain exactly one scalar');
    return result;
  }
}
