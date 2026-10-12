import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Signature-owned direct-reference dependencies. A callee's implementation must
 * satisfy its contract, but cannot narrow the caller's borrow to the field it
 * happened to return. Lifetimes inside generic inputs are not fresh elided
 * lifetimes. Aggregate/region-polymorphic contracts remain explicit boundaries. */
export class BorrowContract {
  static MAX_DEPTH = 64;
  static MAX_WORK = 65_536;
  static reference(type) { return T.reference(type) && type !== '&str'; }
  static formals(analyzer, fn) {
    const parameters = new Map(fn.generics.map(g => [g.name, null]));
    return fn.params.map(p => analyzer.formal(fn, p.type, parameters, p));
  }
  static describe(analyzer, fn, types, result) {
    if (!this.reference(result)) return null;
    const parameters = new Map(fn.generics.map(g => [g.name, null]));
    const declared = fn.returnType === '_' ? '_' : analyzer.formal(fn, fn.returnType, parameters, fn);
    return this.signature(fn, this.formals(analyzer, fn), types, declared, result);
  }
  static signature(fn, formals, types, declared, result) {
    if (!this.reference(result)) return null;
    let work = 0;
    const charge = depth => {
      if (++work > this.MAX_WORK || depth > this.MAX_DEPTH)
        throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Reference signature exceeds its work or nesting budget', fn.span);
    };
    const count = (type, depth = 0) => {
      charge(depth);
      // Function types introduce their own lifetime binders.
      if (T.function(type)) return 0;
      if (T.reference(type)) return 1 + count(T.target(type), depth + 1);
      const children = T.tuple(type) ?? (T.array(type) ? [T.array(type).element] : T.application(type).args);
      return children.reduce((n, child) => n + count(child, depth + 1), 0);
    };
    const contract = {version: 1, kind: 'elided', sources: [], mutable: result.startsWith('&mut ')};
    if (fn.generatedClosure) return {...contract, kind: 'unsupported', error: 'F_BORROW_CONTRACT'};
    if (fn.generics.some(g => g.name === declared)) {
      // A generic identity/selector carries the input type's lifetime. All
      // independently supplied values of that type constrain the result.
      contract.kind = 'generic';
      const depths = [];
      for (let i = 0; i < formals.length; i++) {
        charge(0);
        let formal = formals[i], actual = types[i], depth = 0;
        while (T.reference(formal)) {
          charge(++depth); formal = T.target(formal);
          actual = T.reference(actual) ? T.target(actual) : '';
        }
        if (formal === declared && this.reference(actual)) {
          contract.sources.push(i); depths.push(depth);
        } else {
          // Containers and function types can carry the same generic lifetime
          // too. Do not silently discard a dependency just because its storage
          // path is not represented by the direct-reference domain.
          if (T.substitute(formals[i], new Map([[declared, '!']]), true) !== formals[i])
            contract.error = 'F_BORROW_CONTRACT';
        }
      }
      if (depths.some(depth => depth !== 0)) contract.indirections = depths;
      if (!contract.sources.length) contract.error = 'F_BORROW_CONTRACT';
    } else if (T.reference(declared)) {
      const receiver = fn.params.findIndex((p, i) => p.name === 'self' && T.reference(formals[i]));
      const counts = formals.map(type => count(type));
      if (receiver >= 0) contract.sources = [receiver];
      else if (counts.reduce((sum, n) => sum + n, 0) === 1) {
        const input = counts.findIndex(n => n === 1);
        if (this.reference(types[input]) && T.reference(formals[input])) contract.sources = [input];
        else contract.error = 'F_BORROW_CONTRACT';
      } else contract.error = 'E0106';
      if (!contract.error) {
        // An &T result has an outer elided lifetime AND the lifetimes of T.
        // The selected origin already traces its stored references. Additional
        // T-bearing inputs would constrain a deeper result layer; the flat
        // place/loan result domain cannot attach that constraint without
        // confusing an inner referent with the outer pointer-storage address.
        // Reject that contract until layered reference dataflow represents it.
        const generics = new Set(fn.generics.map(g => g.name));
        const visit = (formal, actual, depth = 0) => {
          charge(depth);
          if (generics.has(formal)) {
            if (count(actual)) for (let i = 0; i < formals.length; i++) {
              charge(depth);
              if (!contract.sources.includes(i) &&
                  T.substitute(formals[i], new Map([[formal, '!']]), true) !== formals[i])
                contract.error = 'F_BORROW_CONTRACT';
            }
            return;
          }
          if (T.function(formal)) return;
          if (T.reference(formal)) { visit(T.target(formal), T.target(actual), depth + 1); return; }
          const parts = type => T.tuple(type) ?? (T.array(type) ? [T.array(type).element] : T.application(type).args);
          const left = parts(formal), right = parts(actual);
          left.forEach((child, i) => { if (right[i] != null) visit(child, right[i], depth + 1); });
        };
        visit(declared, result);
      }
    } else contract.error = 'F_BORROW_CONTRACT';
    return contract;
  }
  static pointer(signature, node) {
    const fn = {params: signature.params.map(type => ({type})), generics: [], span: node.span};
    return this.signature(fn, signature.params, signature.params, signature.result, signature.result);
  }
  static validate(contract, node) {
    if (!contract?.error) return;
    throw new Diagnostic(contract.error, contract.error === 'E0106'
      ? 'The returned reference requires one unambiguous input lifetime or a reference receiver'
      : 'This reference result needs an aggregate or higher-ranked lifetime contract not yet represented by the checker', node.span);
  }
  /** Reborrow only an explicitly reference-shaped formal, never a generic T
   * merely specialized to &mut U. Explicit &mut operands remain active at once;
   * compiler-inserted mutable argument reborrows reserve and then activate. */
  static reborrow(analyzer, node, ctx, formals, types) {
    node.args = node.args.map((arg, i) => {
      const actual = types[i], formal = formals[i];
      if (!actual?.startsWith('&mut ') || !T.reference(formal) ||
          arg.implicitReceiverBorrow || arg.implicitReceiverReborrow || arg.implicitArgumentReborrow ||
          (arg.kind === 'unary' && arg.op === '&' && formal.startsWith('&mut '))) return arg;
      const mutable = formal.startsWith('&mut '), target = T.target(actual);
      const dereference = {kind: 'unary', op: '*', value: arg, type: target,
        copy: analyzer.hasTrait(target, 'Copy'), span: arg.span, loc: arg.loc};
      analyzer.place(dereference, ctx, mutable);
      types[i] = (mutable ? '&mut ' : '&') + target;
      return {kind: 'unary', op: '&', mutable, value: dereference, type: types[i],
        copy: !mutable, implicitArgumentReborrow: true, span: arg.span, loc: arg.loc};
    });
  }
}
