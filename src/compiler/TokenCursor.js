import {Diagnostic} from './Diagnostic.js';

/** Contextual punctuation splitting without mutating the cached lexer stream. */
export class TokenCursor {
  constructor(tokens) { this.tokens = tokens.slice(); this.index = 0; this.nextId = 0; }
  peek(ahead = 0) { return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)]; }
  is(value) { return this.peek().value === value || value === '>' && ['>=', '>>', '>>='].includes(this.peek().value); }
  take() { const token = this.peek(); if (token.kind !== 'eof') this.index++; return token; }
  split(value) {
    const token = this.peek();
    if (token.value === value || !token.value.startsWith(value)) return;
    const length = value.length, middle = token.span.start + length;
    const first = {...token, value, end: middle,
      span: {...token.span, end: middle, endColumn: token.span.column + length}};
    const rest = {...token, value: token.value.slice(length), offset: middle, column: token.column + length,
      span: {...token.span, start: middle, column: token.span.column + length}};
    this.tokens.splice(this.index, 1, first, rest);
  }
  eat(value) {
    if (!this.is(value)) throw new Diagnostic('E0003', `Expected '${value}', got '${this.peek().value}'`, this.peek().span);
    if (value === '>') this.split(value);
    return this.take();
  }
  match(value) { return this.is(value) ? this.eat(value) : null; }
  identifier() {
    const token = this.peek();
    if (token.kind !== 'identifier' && !['self', 'Self', 'crate', 'super'].includes(token.value))
      throw new Diagnostic('E0004', 'Expected an identifier', token.span);
    return this.take().value;
  }
  node(kind, start, fields = {}) {
    const last = this.tokens[Math.max(0, this.index - 1)], first = start.span ?? start;
    const span = {...first, end: last.span.end, endLine: last.span.endLine, endColumn: last.span.endColumn};
    return {id: `${span.file}:${span.start}:${this.nextId++}`, kind, ...fields, span,
      loc: {file: span.file, line: span.line, column: span.column, offset: span.start, end: span.end}};
  }
}
