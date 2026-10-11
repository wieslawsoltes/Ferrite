import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Source constants remain const items in the AST. Declaration indexing adapts
 * associated constants to checked, zero-argument const bodies for specialization.
 * These descriptors are NOT callable Rust functions or emitted runtime thunks. */
export class AssociatedConstant {
  static descriptor(item) {
    if (item.kind !== 'const') return item;
    const {type, value, ...declaration} = item;
    return {...declaration, kind: 'fn', associatedConstant: true, isConst: true,
      localName: item.name, name: `${item.owner}::${item.name}`,
      generics: [], predicates: [], params: [], returnType: type,
      body: value ? {kind: 'block', id: `${item.id}:initializer`, span: value.span,
        body: [], tail: value} : null};
  }

  static evaluate(analyzer, resolved, node, context, expected = null) {
    const {fn} = resolved;
    if (node.typeArguments?.length) throw new Diagnostic('E0107', 'Associated constants do not take item type arguments', node.span);
    const explicit = analyzer.implementations.explicit(resolved, node, context);
    const mapping = new Map(fn.generics.map((g, i) => [g.name, explicit[i] === '_' ? null : explicit[i] ?? null]));
    // As with calls, result context can determine an otherwise unspecified owner
    // parameter. Concrete explicit arguments may never be silently overwritten.
    if (expected && expected !== '_') T.unify(analyzer.formal(fn, fn.returnType, mapping, node), expected, mapping, node);
    analyzer.solveDefaultArguments(fn, mapping, node);
    const arguments_ = fn.generics.map(g => mapping.get(g.name));
    if (arguments_.some(type => !type || /\b_\b/.test(type)))
      throw new Diagnostic('E0282', `Cannot infer implementing type for ${node.name}`, node.span);
    if (analyzer.constants.checkingDefinition) {
      const type = analyzer.formal(fn, fn.returnType, mapping, node);
      return {type, expression: {kind: 'constantReference', name: fn.name, arguments: arguments_, type, span: node.span}};
    }
    const key = 'associated:' + JSON.stringify([fn.name, arguments_]);
    return analyzer.constants.evaluate(fn.body.tail, fn.module, fn.returnType, fn, key, node, fn.owner,
      {declaration: fn, explicit: arguments_});
  }
}
