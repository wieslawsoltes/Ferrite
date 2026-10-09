import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Nominal record, tuple and unit construction. All forms become the same typed
 * field aggregate in HIR; no runtime backend needs a second object ABI. */
export class StructAnalyzer {
  constructor(analyzer) { this.a = analyzer; this.index = analyzer.index; }

  construct(node, descriptor, args, context, expected) {
    const {owner, form} = descriptor;
    if (form === 'unit' && node.kind === 'call')
      throw new Diagnostic('E0618', `Unit struct ${owner.name} is a value, not a callable constructor`, node.span);
    if (form === 'tuple' && node.kind !== 'call')
      throw new Diagnostic('F_CONSTRUCTOR_VALUE', 'First-class constructor function values are not yet supported; call the constructor directly', node.span);
    if (args.length !== owner.fields.length)
      throw new Diagnostic('E0061', `${owner.name} expects ${owner.fields.length} arguments, got ${args.length}`, node.span);
    for (const field of owner.fields) this.index.fieldVisible(owner, field, context.instance.fn.module, node);
    const typeArguments = node.callee?.typeArguments ?? node.typeArguments;
    node.kind = 'structLiteral'; node.name = owner.name; node.typeArguments = typeArguments;
    node.fields = args.map((value, i) => ({name: String(i), value}));
    delete node.callee; delete node.args; delete node.macro;
    return this.literal(node, context, expected);
  }

  literal(node, context, expected) {
    if (node.rest) throw new Diagnostic('E0070', 'Bare struct rest is only valid in a destructuring assignee', node.span);
    const module = context.instance.fn.module;
    const spelling = node.name === 'Self' ? context.instance.fn.owner : node.name;
    const alias = this.index.resolve(this.index.aliases, spelling, module, node, false);
    const explicit = (node.typeArguments ?? []).map(type => this.a.normalize(type, context, node));
    const app = alias ? T.application(this.index.type(spelling + (explicit.length ? `<${explicit.join(',')}>` : ''), module, null, new Set(), node)) : null;
    const shape = this.index.resolve(this.index.structs, app?.name ?? spelling, module, node);
    const supplied = app?.args ?? explicit;
    if (supplied.length && supplied.length !== shape.generics.length)
      throw new Diagnostic('E0107', `${shape.name} expects ${shape.generics.length} type arguments`, node.span);
    const hint = T.application(expected ?? '');
    const substitution = new Map(shape.generics.map((g, i) => [g.name, supplied[i] ?? (hint.name === shape.name ? hint.args[i] : null)]));
    if (node.fields.length !== shape.fields.length)
      throw new Diagnostic('E0063', `Incorrect number of fields for ${shape.name}`, node.span);
    const seen = new Set();
    for (const field of node.fields) {
      const definition = shape.fields.find(entry => entry.name === field.name);
      if (!definition || seen.has(field.name)) throw new Diagnostic('E0062', `Unknown or duplicate field ${field.name}`, node.span);
      seen.add(field.name); this.index.fieldVisible(shape, definition, module, field.value);
      const formal = this.index.type(T.substitute(definition.type, substitution), shape.module, shape.name, new Set(substitution.keys()), node);
      const actual = this.a.infer(field.value, context, substitution.has(formal) ? null : formal);
      try { T.unify(formal, actual, substitution, field.value); }
      catch { throw new Diagnostic('E0308', `Field ${shape.name}.${field.name} expects ${formal}, got ${actual}`, field.value.span); }
    }
    for (const generic of shape.generics) {
      const type = substitution.get(generic.name);
      if (!type || /\b_\b/.test(type)) throw new Diagnostic('E0282', `Cannot infer ${generic.name} in ${shape.name}`, node.span);
      for (const rawBound of generic.bounds) this.bound(type, rawBound, shape, substitution, node);
    }
    for (const predicate of shape.predicates ?? []) {
      const type = this.index.type(T.substitute(predicate.type, substitution), shape.module, shape.name);
      for (const bound of predicate.bounds) this.bound(type, bound, shape, substitution, node);
    }
    node.name = shape.name;
    return shape.name + (shape.generics.length ? `<${shape.generics.map(g => substitution.get(g.name)).join(',')}>` : '');
  }

  bound(type, raw, shape, substitution, node) {
    const bound = this.index.type(T.substitute(raw, substitution), shape.module, shape.name);
    if (!this.a.hasTrait(type, bound)) throw new Diagnostic('E0277', `Trait obligation failed: ${type}: ${bound}`, node.span);
    this.a.obligations.push({type, trait: bound, status: 'satisfied', span: node.span});
  }
}
