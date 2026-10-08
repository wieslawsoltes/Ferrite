import {Diagnostic} from './Diagnostic.js';
import {Lexer} from './Lexer.js';

/** Parses Rust meta items without evaluating configuration or expansion. */
export class AttributeParser {
  static meta(cursor, depth = 0) {
    if (depth > 64) throw new Diagnostic('F_CFG', 'Attribute nesting limit exceeded', cursor.peek().span);
    const start = cursor.peek();
    if (!['identifier','keyword'].includes(start.kind)) throw new Diagnostic('F_CFG', 'Expected an attribute name', start.span);
    let name = cursor.take().value;
    while (cursor.match('::')) name += '::' + cursor.identifier();
    if (cursor.match('=')) {
      const token = cursor.take();
      if (!['string','number','char'].includes(token.kind) && !['true','false'].includes(token.value))
        throw new Diagnostic('F_CFG', 'Attribute values must be literals', token.span);
      return {name, kind: 'value', value: token.kind === 'string' || token.kind === 'char' ? Lexer.decode(token.value) : token.value, valueKind: token.kind, span: start.span};
    }
    if (!cursor.match('(')) return {name, kind:'word', span:start.span};
    const args=[];
    while (!cursor.is(')')) { args.push(this.meta(cursor, depth+1)); if (!cursor.match(',')) break; }
    cursor.eat(')'); return {name, kind:'list', args, span:start.span};
  }
  static attribute(meta, inner = false) {
    return {name:meta.name, args:(meta.args??[]).map(arg=>arg.kind==='word'?arg.name:arg), meta, inner, span:meta.span};
  }
  static read(cursor, {inner = false} = {}) {
    const result=[];
    while (cursor.is('#') && (cursor.peek(1).value === '!') === inner) {
      cursor.take(); if (inner) cursor.eat('!'); cursor.eat('[');
      const meta=this.meta(cursor); cursor.eat(']'); result.push(this.attribute(meta,inner));
    }
    return result;
  }
}
