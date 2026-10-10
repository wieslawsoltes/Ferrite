import {TypeSystem as T} from './TypeSystem.js';
import {ImplTypePattern as Pattern} from './ImplTypePattern.js';

/** Declaration-level type origins for method selection during monomorphization.
 * Two expressions with the same concrete type must not share generic-bound
 * privileges. Origins follow bindings/projections and are kept in side tables,
 * never embedded in immutable syntax, replayed HIR or runtime values. */
export class TraitMethodScope {
  constructor(analyzer, declaration, substitution = new Map()) {
    this.substitution=substitution;
    this.a = analyzer; this.fn = declaration;
    this.graph = analyzer.implementations.traits.hierarchy;
    this.bindings = new WeakMap(); this.expressions = new WeakMap(); this.bounds = new Map();
    this.parameters = new Set(declaration.generics.map(g => g.name));
    if (declaration.defaultTrait) this.parameters.add('Self');
    const assume = (type, raw) => {
      const subject = this.normalize(type), trait = this.graph.canonical(raw, declaration.module, declaration, this.parameters, 'Self');
      if (!this.bounds.has(subject)) this.bounds.set(subject, new Set());
      for (const parent of this.graph.closure(trait,subject)) this.bounds.get(subject).add(parent);
    };
    for (const parameter of declaration.generics) for (const bound of parameter.bounds) assume(parameter.name, bound);
    for (const predicate of declaration.predicates ?? []) for (const bound of predicate.bounds) assume(predicate.type, bound);
    if (declaration.defaultTrait) assume('Self', declaration.defaultTrait);
    this.closure = declaration.generatedClosure ? analyzer.closures.get(declaration.owner) : null;
    const inherited = this.closure?.ctx.methodScope;
    if (inherited) {
      this.substitution = new Map([...inherited.substitution, ...substitution]);
      for (const parameter of inherited.parameters) this.parameters.add(parameter);
      for (const [subject, traits] of inherited.bounds) {
        if (!this.bounds.has(subject)) this.bounds.set(subject, new Set());
        for (const trait of traits) this.bounds.get(subject).add(trait);
      }
    }
    this.active = this.bounds.size > 0;
  }
  normalize(type) {
    return this.a.index.type(type, this.fn.module, this.fn.defaultTrait ? 'Self' : this.fn.owner, this.parameters, this.fn);
  }
  traits(origin) {
    while (T.reference(origin)) origin = T.target(origin);
    const traits=this.bounds.get(origin);
    return traits?new Set([...traits].map(trait=>T.substitute(trait,this.substitution))):null;
  }
  remember(node, origin) { if (this.active && node && origin) this.expressions.set(node, origin); }
  bind(binding, origin) { if (this.active && binding && origin) this.bindings.set(binding, origin); }
  of(node) {
    if (!node) return '()';
    if (!this.active) return node.type ?? '_';
    if (this.expressions.has(node)) return this.expressions.get(node);
    let origin = node.type ?? '_';
    if (node.kind === 'variable' && node.binding) origin = this.bindings.get(node.binding) ?? origin;
    else if (node.kind === 'unary') {
      const value = this.of(node.value);
      if (node.op === '&') origin = (node.mutable ? '&mut ' : '&') + value;
      if (node.op === '*') origin = T.target(value);
    } else if (node.kind === 'field') origin = this.project(this.of(node.object), node.field) ?? origin;
    else if (node.kind === 'index') origin = this.element(this.of(node.object)) ?? origin;
    else if (node.kind === 'tuple') origin = T.tupleName(node.items.map(item => this.of(item)));
    else if (node.kind === 'array') origin = `[${this.of(node.items[0])};${node.items.length}]`;
    else if (node.kind === 'block') origin = this.of(node.tail);
    else if (node.kind === 'ifExpr' || node.kind === 'ifLet') origin = this.join([node.then, node.otherwise], origin);
    else if (node.kind === 'match') origin = this.join(node.arms.map(arm => arm.body), origin);
    else if (node.kind === 'try') origin = T.application(this.of(node.value)).args[0] ?? origin;
    else if (node.builtin === 'clone') origin = this.of(node.args[0]);
    else if (node.receiver) {
      let receiver = this.of(node.receiver); if (node.receiverDeref) receiver = T.target(receiver);
      if (node.builtin === 'method::clone') origin = receiver;
      if (node.builtin === 'method::unwrap') origin = T.application(receiver).args[0] ?? origin;
      if (node.builtin === 'method::pop') origin = `Option<${this.element(receiver) ?? '_'}>`;
    }
    this.remember(node, origin); return origin;
  }
  join(nodes, fallback) {
    const live = nodes.filter(node => node && node.type !== '!').map(node => this.of(node));
    return live.length && live.every(type => type === live[0]) ? live[0] : fallback;
  }
  element(type) {
    while (T.reference(type)) type = T.target(type);
    const app = T.application(type);
    return T.array(type)?.element ?? (app.name === 'Vec' ? app.args[0] : null);
  }
  project(type, field, variant = null) {
    while (T.reference(type)) type = T.target(type);
    const tuple = T.tuple(type); if (tuple) return tuple[Number(field)] ?? null;
    const closure = this.a.closures.get(type);
    if (closure && /^_capture[0-9]+$/.test(field)) {
      const value = closure.node.fields[Number(field.slice(8))]?.value;
      if (value) return closure.ctx.methodScope.of(value);
    }
    const app = T.application(type), shape = this.a.index.structs.get(app.name) ?? this.a.index.enums.get(app.name);
    if (!shape) return null;
    const definition = variant ? this.a.index.variant(shape, variant.split('::').at(-1))?.fields[Number(field)] : this.a.index.field(shape, String(field))?.type;
    if (!definition) return null;
    const formal = this.a.index.type(definition, shape.module, type, new Set(shape.generics.map(g => g.name)), shape);
    return T.substitute(formal, new Map(shape.generics.map((g, i) => [g.name, app.args[i]])));
  }
  bindPattern(pattern, origin) {
    if (pattern.binding) this.bind(pattern.binding, origin);
    if (pattern.kind === 'atPattern') { this.bindPattern(pattern.binder, origin); this.bindPattern(pattern.pattern, origin); }
    else if (pattern.kind === 'orPattern') pattern.items.forEach(item => this.bindPattern(item, origin));
    else if (pattern.kind === 'structPattern') pattern.fields.forEach(field => this.bindPattern(field.pattern, this.project(origin, field.name) ?? field.pattern.type));
    else if (pattern.kind === 'tuplePattern') pattern.items.forEach((item, i) => this.bindPattern(item, this.project(origin, i) ?? item.type));
    else if (pattern.kind === 'variantPattern') pattern.items.forEach((item, i) => this.bindPattern(item, this.project(origin, i, pattern.variant) ?? item.type));
    else if (pattern.kind === 'arrayPattern') {
      const element = this.element(origin);
      pattern.items.forEach(item => this.bindPattern(item, element ?? item.type));
      if (pattern.restBinding && element) this.bindPattern(pattern.restBinding.binder, `[${element};${pattern.restBinding.length}]`);
    }
  }
  /** Reconstruct the result's symbolic arguments with independently named callee
   * variables. Concrete fallback never invents a caller bound from equality. */
  callResult(node, fn, receiverOrigin = null) {
    if (!this.active) return;
    const parameters = new Set(fn.generics.map(g => g.name));
    const bindings = new Map(), formal = raw => {
      let type = this.a.index.type(raw, fn.module, fn.owner, parameters, fn);
      if (receiverOrigin && raw.includes('Self')) {
        const self = new Map([['Self', receiverOrigin]]);
        type = this.a.index.type(T.substitute(raw, self), fn.module, null, new Set([...parameters, ...this.parameters]), fn);
      }
      return Pattern.parse(type, parameters, 'callee:');
    };
    for (let i = 0; i < node.args.length; i++) {
      if (!Pattern.unify(formal(fn.params[i].type), Pattern.parse(this.of(node.args[i])), bindings)) return;
    }
    const explicit = node.callee?.typeArguments ?? [];
    const generics = fn.generics.slice(fn.implGenericCount ?? 0);
    for (let i = 0; i < explicit.length && i < generics.length; i++) {
      if (!Pattern.unify({variable: 'callee:' + generics[i].name}, Pattern.parse(this.normalize(explicit[i])), bindings)) return;
    }
    const origin = Pattern.render(formal(fn.returnType), bindings);
    if (origin) this.remember(node, origin);
  }
}
