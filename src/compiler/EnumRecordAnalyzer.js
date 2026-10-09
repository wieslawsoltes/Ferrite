import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Adapt brace-shaped variants to the existing positional enum payload ABI.
 * Keep source evaluation order independent of declaration/storage order. */
export class EnumRecordAnalyzer {
  static members(constructor) {
    return constructor.variant.members ?? constructor.variant.fields.map((type, i) => ({name: String(i), type}));
  }

  static fields(index, node, constructor, partial = false) {
    const members = this.members(constructor);
    const seen = new Set();
    const indices = node.fields.map(field => {
      const position = index.variantPosition(constructor.variant, field.name);
      if (position === undefined) throw new Diagnostic('E0559', `Unknown field ${field.name} in ${constructor.tag}`, field.value?.span ?? field.pattern?.span ?? node.span);
      if (seen.has(field.name)) throw new Diagnostic('E0062', `Duplicate field ${field.name} in ${constructor.tag}`, node.span);
      seen.add(field.name); return position;
    });
    if (!partial && seen.size !== members.length)
      throw new Diagnostic('E0063', `Missing fields in ${constructor.tag}; all ${members.length} fields are required`, node.span);
    return indices;
  }

  static literal(analyzer, node, constructor, context, expected) {
    const order = this.fields(analyzer.index, node, constructor);
    // Type and execute initializers in their written order, not the enum layout.
    // The adapter descriptor is ephemeral; indexed declarations remain immutable.
    const view = {...constructor, form: 'record', variant: {...constructor.variant,
      fields: order.map(i => constructor.variant.fields[i])}};
    const type = analyzer.construct(node, view, node.fields.map(field => field.value), context, expected);
    node.payloadOrder = order;
    return type;
  }

  static pattern(analyzer, pattern, constructor, type, context, mutable, bindings, names, reuse) {
    if (T.application(type).name !== constructor.owner.name)
      throw new Diagnostic('E0308', `Pattern ${constructor.tag} does not match ${type}`, pattern.span);
    const order = this.fields(analyzer.index, pattern, constructor, !!pattern.rest);
    const items = constructor.variant.fields.map((_, i) => ({kind: 'wildcard', id: `${pattern.id}:field:${i}`, span: pattern.span}));
    pattern.fields.forEach((field, i) => { items[order[i]] = field.pattern; });
    pattern.kind = 'variantPattern'; pattern.recordSyntax = true; pattern.items = items;
    delete pattern.fields; delete pattern.rest;
    return analyzer.patterns.analyze(pattern, type, context, mutable, bindings, names, reuse);
  }
}
