import {Diagnostic} from './Diagnostic.js';

/** Interned type names are structural keys, not JavaScript constructor names. */
export class TypeSystem {
  static integer(type) { return /^(?:[iu](?:8|16|32|64|128)|[iu]size)$/.test(type); }
  static numeric(type) { return this.integer(type) || type === 'f32' || type === 'f64'; }
  static reference(type) { return type?.startsWith('&'); }
  static target(type) { return type.replace(/^&(?:mut )?/, ''); }
  static split(text) {
    let depth = 0, start = 0;
    const parts = [];
    for (let i = 0; i < text.length; i++) {
      if ('<(['.includes(text[i])) depth++;
      if ('>)]'.includes(text[i])) depth--;
      if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
    }
    if (text.slice(start)) parts.push(text.slice(start));
    return parts;
  }
  static application(type) {
    const i = type.indexOf('<');
    return i < 0 ? {name: type, args: []} : {name: type.slice(0, i), args: this.split(type.slice(i + 1, -1))};
  }
  static substitute(type, map) {
    return type.replace(/[A-Za-z_]\w*/g, token => map.get(token) ?? token);
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
    const e = this.application(expected), a = this.application(actual);
    if (e.name === a.name && e.args.length && e.args.length === a.args.length) {
      e.args.forEach((t, i) => this.unify(t, a.args[i], generics, node));
      return this.substitute(expected, generics);
    }
    this.mismatch(expected, actual, node);
  }
  static mismatch(expected, actual, node) { throw new Diagnostic('E0308', `Type mismatch: expected ${expected}, got ${actual}`, node?.span); }
  static primitiveCopy(type) {
    return this.numeric(type) || ['bool', 'char', '&str', '()'].includes(type) || (this.reference(type) && !type.startsWith('&mut '));
  }
  static join(a, b, node) {
    if (a === '!') return b;
    if (b === '!') return a;
    this.unify(a, b, new Map(), node);
    return a;
  }
}
