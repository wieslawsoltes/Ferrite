import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Deferred equalities for non-injective associated-type projections.
 * Ordinary structural positions infer parameters; a projected result never
 * guesses the implementing type. Revisit it only after independent evidence.
 * Nonliteral checking order and all runtime evaluation order are preserved. */
export class ProjectionInference {
  constructor(index, mapping, declaration) {
    this.index = index; this.mapping = mapping; this.declaration = declaration;
    this.pending = []; this.literals = []; this.visits = 0;
  }
  static literalTree(node) {
    if (node.kind === 'literal') return true;
    if (node.kind === 'unary' && node.op === '-') return this.literalTree(node.value);
    return ['tuple', 'array'].includes(node.kind) && node.items.every(item => this.literalTree(item));
  }
  expression(expected, node, infer, diagnostic = null) {
    const check = () => {
      const hint = this.index.typeResolver.substitute(expected, this.mapping, {typeContext: this.declaration});
      this.unify(hint, infer(hint), node, diagnostic);
    };
    // Only literal trees can be delayed. They create no bindings, captures,
    // moves, loans or calls; AST and generated evaluation order stay unchanged.
    // This avoids prematurely defaulting a projected u8 literal to i32.
    if ((this.index.associatedTypes.containsProjection(expected) || this.index.associatedBindings.outputDependent(expected, this.mapping, this.declaration)) && ProjectionInference.literalTree(node)) this.literals.push(check);
    else check();
  }
  unify(expected, actual, node, diagnostic = null) {
    try {
      const result = this.visit(expected, actual, node, 0, diagnostic);
      this.index.associatedBindings.completeArguments(this.declaration, this.mapping);
      return result;
    }
    catch (error) {
      // Keep caller-specific mismatch context through deferred equalities,
      // without disguising inference limits, missing traits or expression errors.
      if (diagnostic && error.code === 'E0308') throw diagnostic(expected, actual);
      throw error;
    }
  }
  visit(expected, actual, node, depth, diagnostic) {
    if (++this.visits > 65536 || depth > 128)
      throw new Diagnostic('F_ASSOC_INFERENCE_LIMIT', 'Projection inference budget exceeded', node?.span);
    if (!this.index.associatedTypes.containsProjection(expected)) return T.unify(expected, actual, this.mapping, node);
    expected = this.index.typeResolver.substitute(expected, this.mapping, {typeContext: this.declaration});
    if (expected === actual || actual === '!' || !this.index.associatedTypes.containsProjection(expected))
      return T.unify(expected, actual, this.mapping, node);
    if (T.projection(expected)) {
      this.pending.push({expected, actual, node, diagnostic});
      return actual;
    }
    const next = (left, right) => this.visit(left, right, node, depth + 1, diagnostic);
    if (T.reference(expected) && T.reference(actual)) {
      if (expected.startsWith('&mut ') && !actual.startsWith('&mut ')) T.mismatch(expected, actual, node);
      next(T.target(expected), T.target(actual)); return actual;
    }
    const ef = T.function(expected), af = T.function(actual);
    if (ef || af) {
      if (!ef || !af || ef.params.length !== af.params.length) T.mismatch(expected, actual, node);
      ef.params.forEach((type, i) => next(type, af.params[i])); next(ef.result, af.result); return actual;
    }
    const et = T.tuple(expected), at = T.tuple(actual);
    if (et || at) {
      if (!et || !at || et.length !== at.length) T.mismatch(expected, actual, node);
      et.forEach((type, i) => next(type, at[i])); return actual;
    }
    const ea = T.array(expected), aa = T.array(actual);
    if (ea || aa) {
      if (!ea || !aa || ea.length !== aa.length) T.mismatch(expected, actual, node);
      next(ea.element, aa.element); return actual;
    }
    const e = T.application(expected), a = T.application(actual);
    if (e.name !== a.name || e.args.length !== a.args.length) T.mismatch(expected, actual, node);
    e.args.forEach((type, i) => next(type, a.args[i])); return actual;
  }
  settle(required = true) {
    this.index.associatedBindings.completeArguments(this.declaration, this.mapping);
    const literals = this.literals; this.literals = [];
    for (const check of literals) check();
    for (let pass = 0; this.pending.length && pass <= this.mapping.size; pass++) {
      const before = [...this.mapping.values()].filter(value => value !== null).length;
      const pending = this.pending; this.pending = [];
      for (const constraint of pending) this.unify(constraint.expected, constraint.actual, constraint.node, constraint.diagnostic);
      if ([...this.mapping.values()].filter(value => value !== null).length === before) break;
    }
    if (required && this.pending.length) throw new Diagnostic('E0282',
      `Cannot infer the inputs of ${this.pending[0].expected}; specify its implementing type`, this.pending[0].node?.span);
  }
}
