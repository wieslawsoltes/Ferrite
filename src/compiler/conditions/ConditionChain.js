import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/** Rust 2024 condition grammar shared by parsing and injected-AST validation.
 * A chain is ordered syntax, not a boolean value with escaping local bindings.
 * Parentheses establish an ordinary expression boundary. No user AST is mutated.
 */
export class ConditionChain {
  static MAX_TERMS = 256;

  static hasLet(expression) {
    const pending = [expression];
    while (pending.length) {
      const node = pending.pop();
      if (!node || node.parenthesized) continue;
      if (node.kind === 'letCondition') return true;
      if (node.kind === 'binary' && ['&&', '||'].includes(node.op)) pending.push(node.right, node.left);
    }
    return false;
  }

  static classify(expression) {
    if (!this.hasLet(expression)) return {kind: 'boolean', fields: {condition: expression}};
    const pending = [expression], terms = [];
    while (pending.length) {
      const node = pending.pop();
      if (!node.parenthesized && node.kind === 'binary' && node.op === '&&') {
        pending.push(node.right, node.left);
        continue;
      }
      if (!node.parenthesized && node.kind === 'binary' && node.op === '||')
        throw new Diagnostic('E0003', 'A let chain cannot contain an unparenthesized || condition', node.span);
      terms.push(node);
      if (terms.length > this.MAX_TERMS)
        throw new Diagnostic('F_CONDITION_LIMIT', 'Let-chain condition count exceeds the compilation budget', node.span);
    }
    if (terms.length === 1 && terms[0].kind === 'letCondition') {
      const {pattern, value} = terms[0];
      return {kind: 'let', fields: {pattern, value}};
    }
    return {kind: 'chain', fields: {conditions: terms}};
  }

  static bindings(pattern) {
    const result = [], pending = [pattern];
    while (pending.length) {
      const node = pending.pop();
      if (!node) continue;
      if (node.binding) result.push(node);
      if (node.kind === 'atPattern') pending.push(node.binder, node.pattern);
      else if (node.kind === 'referencePattern') pending.push(node.pattern);
      else if (node.fields) pending.push(...node.fields.map(field => field.pattern));
      else if (node.items) pending.push(...node.items);
      if (node.restBinding) pending.push(node.restBinding.binder);
    }
    return result;
  }

  /** Storage analysis, not textual generic-argument occurrence: PhantomData and
   * function signatures do not carry a loan. Memoization is local to this query. */
  static containsReferences(analyzer, type, seen = new Set(), depth = 0) {
    if (depth > 128 || seen.size >= 4096)
      throw new Diagnostic('F_CONDITION_LIMIT', 'Condition reference-storage analysis exceeds its type budget');
    if (type === '&str' || type === '!' || T.primitiveCopy(type) && !T.reference(type)) return false;
    if (T.reference(type)) return true;
    if (seen.has(type)) return false;
    seen.add(type);
    if (analyzer.closures.get(type)?.node.borrowCarrier) return true;
    const next = value => this.containsReferences(analyzer, value, seen, depth + 1);
    const tuple = T.tuple(type), array = T.array(type);
    if (tuple) return tuple.some(next);
    if (array) return next(array.element);
    const {name, args} = T.application(type);
    const shape = analyzer.index.structs.get(name) ?? analyzer.index.enums.get(name);
    if (shape?.builtin === 'phantom') return false;
    if (!shape) return name === 'Vec' && args.some(next);
    const mapping = new Map(shape.generics.map((generic, i) => [generic.name, args[i]]));
    const fields = shape.fields?.map(field => field.type) ?? shape.variants.flatMap(variant => variant.fields);
    return fields.some(field => next(analyzer.index.instantiatedType(field, shape, mapping, shape)));
  }

  static terms(node) {
    const terms = node.conditions;
    if (!Array.isArray(terms) || terms.length < 2 || !terms.some(term => term?.kind === 'letCondition'))
      throw new Diagnostic('E0003', 'Malformed let-chain condition list', node.span);
    if (terms.length > this.MAX_TERMS)
      throw new Diagnostic('F_CONDITION_LIMIT', 'Let-chain condition count exceeds the compilation budget', node.span);
    for (const term of terms) {
      if (!term || typeof term !== 'object' || term.parenthesized && term.kind === 'letCondition' ||
          !term.parenthesized && term.kind === 'binary' && ['&&', '||'].includes(term.op))
        throw new Diagnostic('E0003', 'Malformed let-chain condition operand', term?.span ?? node.span);
      if (term.kind === 'letCondition' && (!term.pattern || !term.value))
        throw new Diagnostic('E0003', 'A let condition requires a pattern and scrutinee', term.span);
    }
    return terms;
  }
}
