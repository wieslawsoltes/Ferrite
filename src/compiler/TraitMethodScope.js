import {ImplObligations} from './ImplObligations.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplTypePattern as Pattern} from './ImplTypePattern.js';

/** Declaration-level type origins for method selection during monomorphization.
 * Two expressions with the same concrete type must not share generic-bound
 * privileges. Origins follow bindings/projections and are kept in side tables,
 * never embedded in immutable syntax, replayed HIR or runtime values. */
export class TraitMethodScope {
  constructor(analyzer, declaration, substitution = new Map()) {
    this.substitution=substitution;
    if (declaration.bodyGenerics) declaration={...declaration,generics:declaration.bodyGenerics,predicates:declaration.bodyPredicates};
    this.a = analyzer; this.fn = declaration;
    this.graph = analyzer.implementations.traits.hierarchy;
    this.bindings = new WeakMap(); this.expressions = new WeakMap(); this.bounds = new Map();
    this.parameters = new Set(declaration.generics.map(g => g.name));
    if (declaration.defaultTrait) this.parameters.add('Self');
    const assume = (type, raw) => {
      const subject = this.normalize(type), trait = this.graph.canonical(raw, declaration.module, declaration, this.parameters, declaration.defaultTrait ? 'Self' : declaration.owner ?? 'Self', subject);
      if (!this.bounds.has(subject)) this.bounds.set(subject, new Set());
      for (const parent of this.graph.closure(trait,subject)) this.bounds.get(subject).add(T.traitIdentity(parent));
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
    this.active = this.bounds.size > 0 || this.parameters.size > 0;
  }
  normalize(type) {
    return this.a.index.type(type, this.fn.module, this.fn.defaultTrait ? 'Self' : this.fn.owner, this.parameters, this.fn);
  }
  declaredTraits(origin) {
    if (!origin) return null;
    const root = origin.split('::')[0];
    if (origin.includes('::') && (this.parameters.has(root) || root === 'Self')) origin = this.normalize(origin);
    while (T.reference(origin)) origin = T.target(origin);
    const explicit = this.bounds.get(origin), projection = T.projection(origin);
    const traits = new Set(explicit ?? []);
    if (projection) {
      // Associated bounds are declaration evidence, not privileges of whichever
      // concrete type happens to be substituted into this instantiation.
      for (const raw of this.a.index.associatedTypes.declaredBounds(projection, this.fn)) {
        const bound = this.graph.canonical(raw, this.fn.module, this.fn, this.parameters, this.fn.defaultTrait ? 'Self' : this.fn.owner ?? 'Self', origin);
        for (const parent of this.graph.closure(bound, origin)) traits.add(T.traitIdentity(parent));
      }
    }
    return explicit || projection ? traits : null;
  }
  traits(origin) {
    const traits = this.declaredTraits(origin);
    return traits ? new Set([...traits].map(trait =>
      this.a.index.typeResolver.substitute(trait, this.substitution, this.fn))) : null;
  }
  /** Only bare type parameters receive Rust's bound-first method lookup.
   * A projection carries proof of its bounds, but their traits still need to be
   * in lexical scope. Keep those two facts distinct from its concrete layout. */
  selection(origin) {
    if (!this.active || !origin) return null;
    origin = this.normalize(origin);
    while (T.reference(origin)) origin = T.target(origin);
    const parameter = this.parameters.has(origin) || origin === 'Self';
    const abstract = parameter || !!T.projection(origin) &&
      this.a.index.associatedTypes.symbolic(origin, this.parameters);
    const traits = this.traits(origin);
    return abstract || traits ? {traits: traits ?? new Set(), parameter, abstract} : null;
  }
  /** A concrete Copy instantiation cannot grant Copy to an abstract origin.
   * Reuse declaration obligation proofs and the existing ownership pass rather
   * than inferring privileges from the selected runtime layout. */
  copyOf(node) {
    if (!this.active) return null;
    return this.copyOrigin(this.of(node));
  }
  copyOrigin(origin) {
    if (!this.active || !this.a.index.associatedTypes.symbolic(origin, this.parameters)) return null;
    const inherited = this.closure?.ctx.methodScope;
    if (inherited && inherited !== this) {
      const proof = inherited.copyOrigin(origin);
      if (proof !== null) return proof;
    }
    const memo = this.copyProofs ??= new Map();
    if (memo.has(origin)) return memo.get(origin);
    if (!this.copyEnvironment) {
      const declaration = this.fn.defaultTrait ? {...this.fn, unsizedSelf: true,
        generics: [...this.fn.generics, {name: 'Self', bounds: [this.fn.defaultTrait]}]} : this.fn;
      this.copyEnvironment = new ImplObligations(this.a,
        {target: this.fn.defaultTrait ? 'Self' : this.fn.owner, impl: declaration}, declaration);
    }
    const environment = this.copyEnvironment;
    const copy = environment.prove(origin, 'core::marker::Copy');
    if (origin.length <= 32768) {
      while (memo.size && (memo.size >= 1024 || (this.copyProofCharacters ?? 0) + origin.length > 1000000)) {
        const oldest = memo.keys().next().value;
        this.copyProofCharacters -= oldest.length; memo.delete(oldest);
      }
      memo.set(origin, copy); this.copyProofCharacters = (this.copyProofCharacters ?? 0) + origin.length;
    }
    return copy;
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
  checkResult(node) {
    if (!this.fn.bodyGenerics || !node || node.type === '!' || this.fn.returnType.startsWith('impl ')) return;
    const actual = this.of(node), expected = this.normalize(this.fn.returnType);
    if (this.a.index.associatedTypes.symbolic(actual, this.parameters) || this.a.index.associatedTypes.symbolic(expected, this.parameters))
      T.unify(expected, actual, new Map(), node);
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
  /** Constant values are materialized concretely, but a local initialized from
   * T::VALUE still has the trait contract's abstract output, not its chosen
   * implementation's privileges. No const-body identity enters this scope. */
  constantResult(node, resolved) {
    if (!this.active) return;
    let owner = node.qualifiedSelf ?? node.name.slice(0, node.name.lastIndexOf('::'));
    if (node.ownerTypeArguments?.length) owner += `<${node.ownerTypeArguments.join(',')}>`;
    owner = this.normalize(owner);
    if (!this.a.index.associatedTypes.symbolic(owner, this.parameters)) return;
    const fn = resolved.fn;
    if (fn.implementedTrait) {
      const actual = T.substitute(fn.implementedTrait, resolved.mapping);
      const identity = node.qualifiedTrait ? this.graph.canonical(node.qualifiedTrait, this.fn.module,
        this.fn, this.parameters, owner) : [...(this.declaredTraits(owner) ?? [])].find(bound =>
        T.substitute(bound, this.substitution) === actual);
      const application = identity && T.traitApplication(identity), trait = application && this.a.index.traits.get(application.name);
      const member = trait?.methods.find(item => item.localName === fn.localName && item.associatedConstant);
      if (member) {
        const parameters = new Set(['Self', ...trait.generics.map(g => g.name)]);
        const type = this.a.index.type(member.returnType, trait.module, 'Self', parameters, member);
        this.remember(node, T.substitute(type, new Map([['Self', owner],
          ...trait.generics.map((g, i) => [g.name, application.args[i]])])));
        return;
      }
    } else {
      const entry = this.a.implementations.entries[fn.implIndex];
      const mapping = entry && this.a.implementations.match(entry, owner);
      if (mapping) {
        this.remember(node, T.substitute(this.a.index.type(fn.returnType, fn.module,
          entry.target, entry.parameters, fn), mapping));
        return;
      }
    }
    // Do not claim a concrete proof when an unsupported symbolic origin remains.
    this.remember(node, '_');
  }
  /** Reconstruct the result's symbolic arguments with independently named callee
   * variables. Concrete fallback never invents a caller bound from equality. */
  callResult(node, fn, receiverOrigin = null) {
    if (!this.active) return;
    let contract = null;
    if (receiverOrigin && fn.implementedTrait) {
      const instance = this.a.instances.get(node.resolved);
      const actual = T.substitute(fn.implementedTrait, new Map(Object.entries(instance?.typeArguments ?? {})));
      const identity = [...(this.declaredTraits(receiverOrigin) ?? [])].find(bound => T.substitute(bound, this.substitution) === actual);
      if (identity) {
        const trait = this.a.index.traits.get(T.application(identity).name);
        const member = trait?.methods.find(method => method.localName === fn.localName);
        if (member) {
          // An explicit impl may spell its return as a concrete type. Generic
          // callers nevertheless see the trait declaration's abstract result.
          const method = this.a.implementations.traits.freshen(member,
            new Set([...this.parameters, ...trait.generics.map(g => g.name)]), 'origin');
          const args = T.application(identity).args;
          contract = {trait, mapping: new Map([['Self', receiverOrigin], ...trait.generics.map((g, i) => [g.name, args[i]])])};
          fn = {...method, implGenericCount: 0};
        }
      }
    }
    const parameters = new Set(fn.generics.map(g => g.name));
    const bindings = new Map(), canonical = raw => {
      if (contract) {
        const names = new Set(['Self', ...parameters, ...contract.trait.generics.map(g => g.name)]);
        return T.substitute(this.a.index.type(raw, contract.trait.module, 'Self', names, fn), contract.mapping);
      }
      const names = receiverOrigin ? new Set([...parameters, 'Self']) : parameters;
      const type = this.a.index.type(raw, fn.module, receiverOrigin ? 'Self' : fn.owner, names, fn);
      return receiverOrigin ? T.substitute(type, new Map([['Self', receiverOrigin]])) : type;
    };
    const formal = raw => Pattern.parse(canonical(raw), parameters, 'callee:');
    for (let i = 0; i < node.args.length; i++) {
      if (!Pattern.unify(formal(fn.params[i].type), Pattern.parse(this.of(node.args[i])), bindings)) return;
    }
    const explicit = node.callee?.typeArguments ?? [];
    const generics = fn.generics.slice(fn.implGenericCount ?? 0);
    for (let i = 0; i < explicit.length && i < generics.length; i++) {
      if (!Pattern.unify({variable: 'callee:' + generics[i].name}, Pattern.parse(this.normalize(explicit[i])), bindings)) return;
    }
    // Projection inputs can be rendered from independently determined binders,
    // but must never be inferred by structurally inverting a projected result.
    const result = canonical(fn.returnType), substitution = new Map();
    for (const name of parameters) {
      const actual = Pattern.render({variable: 'callee:' + name}, bindings);
      if (actual === null && T.substitute(result, new Map([[name, '_']])) !== result) return;
      if (actual !== null) substitution.set(name, actual);
    }
    this.remember(node, T.substitute(result, substitution));
  }
}
