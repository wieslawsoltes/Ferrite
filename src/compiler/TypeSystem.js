import {Diagnostic} from './Diagnostic.js';
import {Lexer} from './Lexer.js';

/** Interned type names are structural keys, not JavaScript constructor names. */
export class TypeSystem {
  static integer(type) { return /^(?:[iu](?:8|16|32|64|128)|[iu]size)$/.test(type); }
  static numeric(type) { return this.integer(type) || type === 'f32' || type === 'f64'; }
  static reference(type) { return type?.startsWith('&'); }
  static target(type) { return type.replace(/^&(?:mut )?/, ''); }
  static split(text, separator = ',') {
    const parts = [], stack = []; let start = 0, braces = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (c === '"' || c === "'") {
        // Constant expressions inside a type are braced; punctuation in their
        // literals is data, not structural type delimiters.
        let hashes = 0, before = i - 1;
        while (text[before] === '#') { hashes++; before--; }
        const raw = c === '"' && text[before] === 'r';
        if (raw) { const end = text.indexOf('"' + '#'.repeat(hashes), i + 1); i = end < 0 ? text.length : end + hashes; }
        else while (++i < text.length) { if (text[i] === '\\') i++; else if (text[i] === c) break; }
        continue;
      }
      if (c === '{') { stack.push('}'); braces++; }
      else if (c === '(') stack.push(')');
      else if (c === '[') stack.push(']');
      else if (c === '<' && !braces) stack.push('>');
      else if (c === stack.at(-1) && !(c === '>' && text[i-1] === '-')) { stack.pop(); if (c === '}') braces--; }
      else if (c === separator && !stack.length) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    if (text.slice(start)) parts.push(text.slice(start));
    return parts;
  }
  static function(type) {
    if(typeof type!=='string'||!type.startsWith('fn('))return null;
    let depth=1,end=3;
    for(;end<type.length;end++){if(type[end]==='(')depth++;else if(type[end]===')'&&!--depth)break;}
    if(depth||type.slice(end+1,end+3)!=='->'||end+3===type.length)return null;
    return {params:this.split(type.slice(3,end)),result:type.slice(end+3)};
  }
  static functionName(params,result='()'){return `fn(${params.join(',')})->${result}`;}
  static tuple(type) { return type.startsWith('(') && type.endsWith(')') ? this.split(type.slice(1, -1)) : null; }
  static tupleName(items) { return '(' + items.join(',') + (items.length === 1 ? ',' : '') + ')'; }
  static array(type) {
    if (!type.startsWith('[') || !type.endsWith(']')) return null;
    const parts = this.split(type.slice(1, -1), ';');
    return parts.length === 2 ? {element: parts[0], length: parts[1]} : null;
  }
  static application(type) {
    const i = type.indexOf('<');
    return i < 0 ? {name: type, args: []} : {name: type.slice(0, i), args: this.split(type.slice(i + 1, -1))};
  }
  static substitute(type, map) {
    if (!map.size || ![...map.keys()].some(key => type.includes(key))) return type;
    const tokens = Lexer.tokenize(type), parts = []; let offset = 0;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i];
      if (token.kind !== 'identifier' && token.value !== 'Self') continue;
      let name = token.value, end = token.span.end;
      while (tokens[i + 1]?.value === '::' && tokens[i + 2]?.kind === 'identifier') { i += 2; name += '::' + tokens[i].value; end = tokens[i].span.end; }
      parts.push(type.slice(offset, token.span.start), map.get(name) ?? type.slice(token.span.start, end)); offset = end;
    }
    parts.push(type.slice(offset)); return parts.join('');
  }
  static unify(expected, actual, generics = new Map(), node = null) {
    if (expected === actual || actual === '!' || expected === '_') return actual;
    if (generics.has(expected)) {
      const previous = generics.get(expected);
      if (previous == null) { generics.set(expected, actual); return actual; }
      return this.unify(previous, actual, new Map(), node);
    }
    if (this.reference(expected) && this.reference(actual)) {
      if (expected.startsWith('&mut ') && !actual.startsWith('&mut ')) this.mismatch(expected, actual, node);
      this.unify(this.target(expected), this.target(actual), generics, node);
      return expected;
    }
    const ef=this.function(expected),af=this.function(actual);
    if(ef||af){
      if(!ef||!af||ef.params.length!==af.params.length)this.mismatch(expected,actual,node);
      ef.params.forEach((type,i)=>this.unify(type,af.params[i],generics,node));
      this.unify(ef.result,af.result,generics,node);return this.substitute(expected,generics);
    }
    const et = this.tuple(expected), at = this.tuple(actual);
    if ((et || at) && (!et || !at || et.length !== at.length)) this.mismatch(expected, actual, node);
    if (et && at && et.length === at.length) {
      et.forEach((type, i) => this.unify(type, at[i], generics, node));
      return this.substitute(expected, generics);
    }
    const ea = this.array(expected), aa = this.array(actual);
    if ((ea || aa) && (!ea || !aa || ea.length !== aa.length)) this.mismatch(expected, actual, node);
    if (ea && aa && ea.length === aa.length) {
      this.unify(ea.element, aa.element, generics, node); return this.substitute(expected, generics);
    }
    const e = this.application(expected), a = this.application(actual);
    if (e.name === a.name && e.args.length && e.args.length === a.args.length) {
      e.args.forEach((t, i) => this.unify(t, a.args[i], generics, node));
      return this.substitute(expected, generics);
    }
    this.mismatch(expected, actual, node);
  }
  static mismatch(expected, actual, node) { throw new Diagnostic('E0308', `Type mismatch: expected ${expected}, got ${actual}`, node?.span); }
  static primitiveCopy(type) {
    return this.numeric(type) || !!this.function(type) || ['bool', 'char', '&str', '()'].includes(type) || (this.reference(type) && !type.startsWith('&mut '));
  }
  static join(a, b, node) {
    if (a === '!') return b;
    if (b === '!') return a;
    this.unify(a, b, new Map(), node);
    return a;
  }
}
