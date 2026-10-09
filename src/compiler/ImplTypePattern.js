import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Structural, invariant matching for impl heads. This is deliberately NOT
 * expression coercion: Wrapper<&mut T> is not Wrapper<&T>. Variables belonging
 * to different declarations are alpha-renamed and unification has an occurs
 * check, so repeated parameters and recursive head equations remain sound. */
export class ImplTypePattern {
  static parse(type, parameters = new Set(), prefix = '', holes = {next: 0}, depth = 0) {
    if (depth > 128) throw new Diagnostic('F_IMPL_DEPTH', 'Implementation type nesting limit exceeded');
    if (parameters.has(type)) return {variable: prefix + type};
    if (type === '_') return {variable: prefix + '?' + holes.next++};
    const next = value => this.parse(value, parameters, prefix, holes, depth + 1);
    if (T.reference(type)) return {kind: 'reference', name: type.startsWith('&mut ') ? '&mut' : '&', args: [next(T.target(type))]};
    const fn = T.function(type);
    if (fn) return {kind: 'function', name: 'fn', args: [...fn.params, fn.result].map(next)};
    const tuple = T.tuple(type);
    if (tuple) return {kind: 'tuple', name: 'tuple', args: tuple.map(next)};
    const array = T.array(type);
    if (array) return {kind: 'array', name: '[' + array.length + ']', args: [next(array.element)]};
    const {name, args} = T.application(type);
    return {kind: 'nominal', name, args: args.map(next)};
  }
  static unify(left, right, bindings = new Map()) {
    const pending = [[left, right]];
    const resolve = term => { while (term.variable && bindings.has(term.variable)) term = bindings.get(term.variable); return term; };
    const occurs = (variable, root) => {
      const queue = [root];
      while (queue.length) { const term = resolve(queue.pop()); if (term.variable === variable) return true; if (!term.variable) queue.push(...term.args); }
      return false;
    };
    while (pending.length) {
      const pair = pending.pop(), a = resolve(pair[0]), b = resolve(pair[1]);
      if (a === b || a.variable && a.variable === b.variable) continue;
      if (a.variable) { if (occurs(a.variable, b)) return null; bindings.set(a.variable, b); }
      else if (b.variable) { if (occurs(b.variable, a)) return null; bindings.set(b.variable, a); }
      else {
        if (a.kind !== b.kind || a.name !== b.name || a.args.length !== b.args.length) return null;
        for (let i = 0; i < a.args.length; i++) pending.push([a.args[i], b.args[i]]);
      }
    }
    return bindings;
  }
  static render(term, bindings, depth = 0) {
    if (depth > 128) throw new Diagnostic('F_IMPL_DEPTH', 'Implementation substitution limit exceeded');
    if (term.variable) return bindings.has(term.variable) ? this.render(bindings.get(term.variable), bindings, depth + 1) : null;
    const args = term.args.map(value => this.render(value, bindings, depth + 1));
    if (args.some(value => value === null)) return null;
    if (term.kind === 'reference') return term.name + (term.name === '&mut' ? ' ' : '') + args[0];
    if (term.kind === 'function') return T.functionName(args.slice(0, -1), args.at(-1));
    if (term.kind === 'tuple') return T.tupleName(args);
    if (term.kind === 'array') return `[${args[0]};${term.name.slice(1, -1)}]`;
    return term.name + (args.length ? `<${args.join(',')}>` : '');
  }
}
