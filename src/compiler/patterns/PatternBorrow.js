import {ConditionChain} from '../conditions/ConditionChain.js';
import {TypeSystem as T} from '../TypeSystem.js';
import {Diagnostic} from '../Diagnostic.js';

/** Source-side rules for explicit reference binding modes. A pattern borrows
 * evaluated storage; it must never silently borrow a cloned scrutinee register.
 * Compiler temporaries are private HIR locals with the enclosing pattern scope. */
export class PatternBorrow {
  static source(analyzer, pattern, source, context) {
    // HIR storage annotations are compiler-owned, never capabilities supplied
    // by a parsed/injected source tree. Multiple arms may share one scrutinee.
    const sources = analyzer.patternBorrowSources ??= new WeakMap();
    if (source && !sources.has(source)) { delete source.patternBorrow; delete source.patternStorage; }
    const bindings = ConditionChain.bindings(pattern).filter(binding => binding.byRef);
    if (!bindings.length) return;
    if (!source) throw new Diagnostic('F_PATTERN_BORROW_SOURCE', 'Reference bindings need a represented scrutinee storage scope', pattern.span);
    for (const binding of bindings) if (binding.refMutable && ConditionChain.containsReferences(analyzer, binding.matchedType))
      throw new Diagnostic('F_PATTERN_REFERENCE_MUTATION', 'Mutably borrowing reference-carrying pattern storage requires aggregate-region tracking', binding.span);
    for (const binding of bindings) if (!T.reference(binding.matchedType) && ConditionChain.containsReferences(analyzer, binding.matchedType))
      throw new Diagnostic('F_PATTERN_REFERENCE_CARRIER', 'Borrowing a reference-carrying aggregate requires field-origin tracking', binding.span);
    const place = node => !!node && (node.kind === 'variable' && !!node.binding ||
      node.kind === 'unary' && node.op === '*' || ['field', 'index'].includes(node.kind) && (node.autoDeref || place(node.object)));
    if (place(source)) analyzer.place(source, context, bindings.some(binding => binding.refMutable));
    else if (!sources.has(source)) {
      const slot = context.locals.length;
      source.patternStorage = {slot, name: `%pattern${slot}`, type: source.type, mutable: true,
        parameter: false, level: context.scopes.length - 1, span: source.span, patternTemporary: true};
      context.locals.push(source.patternStorage);
    }
    source.patternBorrow = true;
    sources.set(source, source.patternStorage ?? null);
  }
}
