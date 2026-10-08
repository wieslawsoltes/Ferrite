import {Diagnostic} from './Diagnostic.js';

export class TokenCursor {
  constructor(tokens) { this.tokens = tokens.slice(); this.index = 0; this.nextId = 0; }
  peek(ahead = 0) { return this.tokens[Math.min(this.index + ahead, this.tokens.length - 1)]; }
  is(value) { return this.peek().value === value || (value === '>' && this.peek().value === '>='); }
  take() { const token = this.peek(); if (token.kind !== 'eof') this.index++; return token; }
  eat(value) {
    // Contextual splitting keeps `Vec<i32>=...` legal without changing expression >=.
    // The input token stream remains immutable for incremental caches and visualizers.
    if (value === '>' && this.peek().value === '>=') {
      const token = this.peek(), middle = token.span.start + 1;
      const first = {...token, value: '>', end: middle,
        span: {...token.span, end: middle, endColumn: token.span.column + 1}};
      const rest = {...token, value: '=', offset: middle, column: token.column + 1,
        span: {...token.span, start: middle, column: token.span.column + 1}};
      this.tokens.splice(this.index, 1, first, rest);
    }
    if (!this.is(value)) throw new Diagnostic('E0003', `Expected '${value}', got '${this.peek().value}'`, this.peek().span);
    return this.take();
  }
  match(value) { return this.is(value) ? this.take() : null; }
  identifier() {
    const token = this.peek();
    if (token.kind !== 'identifier' && !['self', 'Self', 'crate', 'super'].includes(token.value))
      throw new Diagnostic('E0004', 'Expected an identifier', token.span);
    return this.take().value;
  }
  node(kind, start, fields = {}) {
    const last = this.tokens[Math.max(0, this.index - 1)];
    const first = start.span ?? start;
    const span = {...first, end: last.span.end, endLine: last.span.endLine, endColumn: last.span.endColumn};
    return {id: `${span.file}:${span.start}:${this.nextId++}`, kind, ...fields, span,
      loc: {file: span.file, line: span.line, column: span.column, offset: span.start, end: span.end}};
  }
}
