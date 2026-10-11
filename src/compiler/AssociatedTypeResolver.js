import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplObligations} from './ImplObligations.js';

/** Declaration-scoped associated types, independent of runtime value layouts.
 *
 * Canonical projections retain both the self type and the declaring trait.
 * Symbolic projections are not nominal constructors and are never inverted to
 * infer their inputs. Only a selected implementation may reveal its definition.
 * The memo contains concrete, successful normalizations from this index only.
 */
export class AssociatedTypeResolver {
  constructor(index) {
    this.index = index;
    this.enabled = [...index.traits.values()].some(trait => trait.associatedTypes.length) || index.impls.some(impl => impl.associatedTypes.length);
    this.implementations = null;
    this.entries = new WeakMap();
    this.checkedUses = new WeakMap();
    this.cache = new Map();
    this.active = new Set();
    this.characters = 0;
    this.queries = 0;
    this.hits = 0;
    this.maxQueries = 100000;
    this.maxDepth = 64;
    this.maxEntries = 2048;
    this.maxCharacters = 4000000;
  }

  attach(implementations) {
    this.implementations = implementations;
    for (const entry of implementations.entries) this.entries.set(entry.impl, entry);
    // The hierarchy may have requested symbolic types during bootstrap. They
    // cannot shadow implementation-aware results once selection is available.
    this.index.typeResolver.cache.clear();
    this.index.typeResolver.characters = 0;
  }

  context(node) { return node?.typeContext ?? node ?? {}; }

  traitContext(node) {
    const context = this.context(node);
    if (context.defaultTrait) return context.defaultTrait;
    if (context.implementedTrait) return context.implementedTrait;
    if (context.kind === 'impl') return context.trait;
    const trait = context.kind === 'trait' ? context : this.index.traits.get(context.traitContext);
    if (trait) return trait.name + (trait.generics.length ? `<${trait.generics.map(g => g.name).join(',')}>` : '');
    return context.trait ?? null;
  }

  canonicalTrait(raw, module, self, parameters, node) {
    const app = T.traitApplication(raw);
    const trait = this.index.typeResolver.find(this.index.traits, app.name, module, node);
    if (!trait) throw new Diagnostic('E0405', `Unknown trait '${app.name}' in associated type`, node?.span);
    if (trait.generics.length !== app.args.length)
      throw new Diagnostic('E0107', `Trait ${trait.name} expects ${trait.generics.length} type argument(s)`, node?.span);
    const args = app.args.map(type => this.index.type(type, module, self, parameters, node));
    return T.traitName(trait.name, args, app.bindings.map(binding => ({...binding, type: this.index.type(binding.type, module, self, parameters, node)})));
  }

  member(traitName, name, node) {
    const trait = this.index.traits.get(T.application(traitName).name);
    if (!trait) throw new Diagnostic('E0405', `Unknown trait '${traitName}'`, node?.span);
    const item = trait.associatedTypes.find(item => item.localName === name);
    if (!item) throw new Diagnostic('E0576', `Trait ${trait.name} has no associated type ${name}`, node?.span);
    return {trait, item};
  }

  traitsFor(origin, module, self, parameters, node) {
    const context = this.context(node), result = new Set(), raw = [];
    const trait = this.index.traits.get(context.traitContext) ?? (context.kind === 'trait' ? context : null);
    const generics = [...(trait?.generics ?? []), ...(context.generics ?? [])];
    for (const generic of generics) if (generic.name === origin) raw.push(...generic.bounds);
    for (const predicate of [...(trait?.predicates ?? []), ...(context.predicates ?? [])])
      if (predicate.type === origin) raw.push(...predicate.bounds);
    if (origin === 'Self' && this.traitContext(node)) raw.push(this.traitContext(node));
    const projection = T.projection(origin);
    if (projection) raw.push(...this.declaredBounds(projection, node));
    for (const bound of raw) {
      const app = T.application(bound);
      if (!this.index.typeResolver.find(this.index.traits, app.name, module, node)) continue;
      const identity = this.canonicalTrait(T.traitIdentity(bound), module, self, parameters, node);
      const closure = this.implementations?.traits.hierarchy.closure(identity, origin) ?? [identity];
      for (const candidate of closure) result.add(T.traitIdentity(candidate));
    }
    return result;
  }

  resolve(raw, module = '', self = null, parameters = new Set(), node = null) {
    if (!raw.includes('::')) return null;
    const explicit = T.projection(raw);
    if (explicit) {
      if (!explicit.trait) throw new Diagnostic('E0223', 'An associated type requires its declaring trait', node?.span);
      if (explicit.args.length) throw new Diagnostic('E0107', 'This associated type does not accept generic arguments', node?.span);
      if (explicit.tail.length) throw new Diagnostic('F_ASSOC_PATH', 'Use an explicitly qualified nested associated-type projection', node?.span);
      const target = this.index.type(explicit.self, module, self, parameters, node);
      const trait = this.canonicalTrait(explicit.trait, module, self, parameters, node);
      this.member(trait, explicit.member, node);
      return this.reduce(target, trait, explicit.member, parameters, node);
    }
    // Resolve actual nominal/alias/module paths before considering shorthand.
    const app = T.application(raw);
    for (const map of [this.index.aliases, this.index.structs, this.index.enums, this.index.traits])
      if (this.index.candidates(app.name, module).some(name => map.has(name))) return null;
    const parts = T.split(raw, ':').filter(Boolean);
    if (parts.length < 2) return null;
    const member = T.application(parts.pop()), origin = parts.join('::');
    if (member.args.length) throw new Diagnostic('E0107', 'This associated type does not accept generic arguments', node?.span);
    const symbolic = parameters.has(origin) || origin === 'Self' || T.projection(origin);
    if (!symbolic) {
      const root = T.application(origin).name;
      if (this.index.typeResolver.find(this.index.structs, root, module, node) || this.index.typeResolver.find(this.index.enums, root, module, node))
        throw new Diagnostic('E0223', `Use <${origin} as Trait>::${member.name} to name this associated type`, node?.span);
      return null;
    }
    const choices = [...this.traitsFor(origin, module, self, parameters, node)].filter(identity =>
      this.index.traits.get(T.application(identity).name)?.associatedTypes.some(item => item.localName === member.name));
    if (!choices.length) throw new Diagnostic('E0220', `No declared bound provides ${origin}::${member.name}`, node?.span);
    if (choices.length > 1) throw new Diagnostic('E0221', `Ambiguous associated type ${origin}::${member.name}; qualify its trait`, node?.span);
    const target = this.index.type(origin, module, self, parameters, node);
    return this.reduce(target, choices[0], member.name, parameters, node);
  }

  symbolic(type, parameters) {
    if (parameters.has(type) || type === '_') return true;
    if (T.reference(type)) return this.symbolic(T.target(type), parameters);
    const fn = T.function(type);
    if (fn) return [...fn.params, fn.result].some(t => this.symbolic(t, parameters));
    const tuple = T.tuple(type), array = T.array(type);
    if (tuple || array) return (tuple ?? [array.element]).some(t => this.symbolic(t, parameters));
    const projection = T.projection(type);
    if (projection) return this.symbolic(projection.self, parameters) || this.symbolic(projection.trait, parameters);
    const app = T.traitApplication(type);
    return [...app.args, ...app.bindings.map(binding => binding.type)].some(t => this.symbolic(t, parameters));
  }

  currentEntry(node) {
    const context = this.context(node);
    return context.implIndex === undefined ? this.entries.get(context) : this.implementations?.entries[context.implIndex];
  }

  reduce(self, trait, name, parameters, node) {
    const {item} = this.member(trait, name, node);
    const projection = T.projectionName(self, trait, name);
    if (++this.queries > this.maxQueries || projection.length > 1000000)
      throw new Diagnostic('F_ASSOC_TYPE_LIMIT', 'Associated-type normalization budget exceeded', node?.span);
    if (!this.implementations) return projection;
    const symbolic = this.symbolic(self, parameters) || this.symbolic(trait, parameters);
    if (!symbolic && this.cache.has(projection)) { this.hits++; return this.cache.get(projection); }
    if (symbolic && !this.index.associatedBindings.building) {
      const value = this.index.associatedBindings.lookup(projection, parameters, node);
      if (value !== null && value !== projection) {
        const key = `equality:${projection}`;
        if (this.active.has(key)) throw new Diagnostic('E0391', `Cycle in associated type equality ${projection}`, node?.span);
        if (this.active.size >= this.maxDepth) throw new Diagnostic('F_ASSOC_TYPE_LIMIT', 'Associated-type equality recursion budget exceeded', node?.span);
        this.active.add(key);
        try { return this.normalize(value, parameters, node); }
        finally { this.active.delete(key); }
      }
    }
    // A bare type parameter remains abstract even when the current program has
    // just one implementing type. Concrete coincidence is not a generic proof.
    const current = this.currentEntry(node);
    const ownsProjection = symbolic && current && self === current.target && trait === current.traitRef;
    if ((parameters.has(self) || self === 'Self' || self === '_') && !ownsProjection) return projection;
    if (this.active.has(projection)) throw new Diagnostic('E0391', `Cycle in associated type ${projection}`, node?.span);
    if (this.active.size >= this.maxDepth) throw new Diagnostic('F_ASSOC_TYPE_LIMIT', 'Associated-type recursion budget exceeded', node?.span);
    // Applicability itself can depend on projections in where clauses. Guard the
    // entire query, not merely expansion after implementation selection.
    this.active.add(projection);
    try {
      const candidates = this.implementations.traits.candidates(self, trait);
      const matches = [];
      for (const entry of candidates) {
        if (symbolic && entry !== current) continue;
        const mapping = ownsProjection && entry === current
          ? new Map([...entry.parameters].map(name => [name, name]))
          : this.implementations.traits.match(entry, self, trait);
        if (!mapping || [...mapping.values()].some(value => value === null)) continue;
        if (!symbolic && !this.implementations.applicable(entry, mapping)) continue;
        matches.push({entry, mapping});
      }
      if (!matches.length) {
        if (symbolic) return projection;
        throw new Diagnostic('E0277', `Cannot normalize ${projection}: no applicable implementation`, node?.span ?? item.span);
      }
      if (matches.length !== 1) throw new Diagnostic('E0283', `Ambiguous implementation for ${projection}`, node?.span);
      const {entry, mapping} = matches[0];
      const definition = entry.impl.associatedTypes.find(type => type.localName === name);
      if (!definition?.target) throw new Diagnostic('E0046', `Missing associated type ${entry.trait.name}::${name}`, entry.impl.span);
      const declaration = this.definitionContext(entry, definition);
      const formal = this.index.type(definition.target, definition.module, entry.target, entry.parameters, {...definition, typeContext: declaration});
      const value = this.normalize(T.substitute(formal, mapping), parameters, {...definition, typeContext: declaration});
      if (value.length > 1000000) throw new Diagnostic('F_ASSOC_TYPE_LIMIT', 'Associated type exceeds the type size budget', node?.span);
      if (!symbolic) this.remember(projection, value);
      return value;
    } finally { this.active.delete(projection); }
  }

  /** Normalize already canonical caller types without repeating visibility/name
   * lookup at the callee's module. No private caller identity is reinterpreted. */
  normalize(type, parameters = new Set(), node = null, depth = 0) {
    if (!type.includes('>::')) return type;
    if (depth > 128) throw new Diagnostic('F_ASSOC_TYPE_LIMIT', 'Type normalization depth exceeded', node?.span);
    const next = value => this.normalize(value, parameters, node, depth + 1);
    if (T.reference(type)) return (type.startsWith('&mut ') ? '&mut ' : '&') + next(T.target(type));
    const fn = T.function(type); if (fn) return T.functionName(fn.params.map(next), next(fn.result));
    const tuple = T.tuple(type); if (tuple) return T.tupleName(tuple.map(next));
    const array = T.array(type); if (array) return `[${next(array.element)};${array.length}]`;
    const projection = T.projection(type);
    if (projection) return this.reduce(next(projection.self), next(projection.trait), projection.member, parameters, node);
    const app = T.traitApplication(type);
    return T.traitName(app.name, app.args.map(next), app.bindings.map(binding => ({...binding, type: next(binding.type)})));
  }

  remember(key, value) {
    const cost = key.length + value.length;
    if (cost > this.maxCharacters) return;
    while (this.cache.size && (this.cache.size >= this.maxEntries || this.characters + cost > this.maxCharacters)) {
      const oldest = this.cache.keys().next().value;
      this.characters -= oldest.length + this.cache.get(oldest).length;
      this.cache.delete(oldest);
    }
    this.cache.set(key, value); this.characters += cost;
  }

  definitionContext(entry, item) {
    return {...item, owner: entry.target, implIndex: entry.id, implementedTrait: entry.traitRef,
      generics: entry.impl.generics, predicates: entry.impl.predicates};
  }

  validateProjection(projection, parameters, node) {
    const {trait} = this.member(projection.trait, projection.member, node);
    const args = T.application(projection.trait).args;
    if (projection.args.length || projection.tail.length || args.length !== trait.generics.length)
      throw new Diagnostic('E0107', 'Invalid associated type arguments', node?.span);
    this.index.typeResolver.validateKnown(projection.self, parameters, node);
    args.forEach(type => this.index.typeResolver.validateKnown(type, parameters, node));
  }

  declaredBounds(projection, node) {
    const {trait, item} = this.member(projection.trait, projection.member, node);
    const args = T.application(projection.trait).args;
    const mapping = new Map([['Self', projection.self], ...trait.generics.map((g, i) => [g.name, args[i]])]);
    const parameters = new Set(['Self', ...trait.generics.map(g => g.name)]);
    return [...(item.relaxedSized ? [] : ['core::marker::Sized']), ...item.bounds].map(bound =>
      T.substitute(this.index.type(bound, trait.module, 'Self', parameters, {...item, typeContext: trait}), mapping));
  }

  validateDeclarations() {
    for (const trait of this.index.traits.values()) {
      const seen = new Set();
      for (const item of trait.associatedTypes) {
        if (seen.has(item.localName)) throw new Diagnostic('E0428', `Duplicate associated type ${item.localName}`, item.span);
        seen.add(item.localName);
        if (item.target) throw new Diagnostic('E0658', 'Associated type defaults are not supported on stable Rust', item.span);
        if (item.visibility === 'pub') throw new Diagnostic('E0449', 'Associated types inherit trait visibility', item.span);
        this.checkItemScope(item);
        const parameters = new Set(['Self', ...trait.generics.map(g => g.name)]);
        for (const bound of item.bounds) this.implementations.traits.hierarchy.canonical(bound, trait.module, {...item, typeContext: trait}, parameters, 'Self');
      }
    }
    for (const entry of this.implementations.entries) {
      const seen = new Set();
      for (const item of entry.impl.associatedTypes) {
        if (!entry.trait) throw new Diagnostic('E0658', 'Inherent associated types are not supported on stable Rust', item.span);
        if (seen.has(item.localName)) throw new Diagnostic('E0201', `Duplicate associated type ${item.localName}`, item.span);
        seen.add(item.localName);
        if (item.visibility === 'pub') throw new Diagnostic('E0449', 'Trait implementation types cannot declare visibility', item.span);
        this.checkItemScope(item);
        if (item.bounds.length || item.relaxedSized) throw new Diagnostic('F_ASSOC_BOUND', 'Associated type definitions cannot add bounds', item.span);
      }
    }
  }

  checkItemScope(item) {
    if (item.generics.length) throw new Diagnostic('F_ASSOC_GENERIC', 'Generic associated types require their binder and lifetime continuation', item.span);
    if (item.predicates.length) throw new Diagnostic('F_ASSOC_WHERE', 'Conditional associated-type definitions require their obligation continuation', item.span);
  }

  validateImplementation(entry) {
    const declared = new Map(entry.trait.associatedTypes.map(item => [item.localName, item]));
    const definitions = new Map(entry.impl.associatedTypes.map(item => [item.localName, item]));
    for (const item of definitions.values()) if (!declared.has(item.localName))
      throw new Diagnostic('E0437', `${item.localName} is not an associated type of ${entry.trait.name}`, item.span);
    for (const [name, expected] of declared) {
      const item = definitions.get(name);
      if (!item?.target) throw new Diagnostic('E0046', `Missing associated type ${entry.trait.name}::${name}`, entry.impl.span);
      if (/\b_\b/.test(item.target) || item.target.startsWith('impl ')) throw new Diagnostic('E0121', 'An associated type needs an explicit type definition', item.span);
      const context = this.definitionContext(entry, item);
      const type = this.index.type(item.target, item.module, entry.target, entry.parameters, {...item, typeContext: context});
      this.index.typeResolver.validateKnown(type, entry.parameters, context);
      const environment = new ImplObligations(this.implementations.a, entry, context);
      environment.validateCanonical(type, context);
      const projection = {self: entry.target, trait: entry.traitRef, member: name};
      for (const raw of this.declaredBounds(projection, expected)) {
        const bound = this.implementations.traits.hierarchy.canonical(raw, entry.impl.module, context, entry.parameters, entry.target);
        if (!environment.prove(type, bound)) throw new Diagnostic('E0277', `Associated type ${name} does not satisfy ${bound}`, item.span);
      }
    }
  }

  containsProjection(type) {
    if (!type.includes('>::')) return false;
    if (T.projection(type)) return true;
    if (T.reference(type)) return this.containsProjection(T.target(type));
    const fn = T.function(type);
    if (fn) return [...fn.params, fn.result].some(t => this.containsProjection(t));
    const tuple = T.tuple(type), array = T.array(type);
    return (tuple ?? (array ? [array.element] : T.application(type).args)).some(t => this.containsProjection(t));
  }

  /** Verify symbolic evidence before monomorphization can erase its origins. */
  checkUse(type, declaration, self, parameters, node) {
    if (!this.containsProjection(type)) return;
    let checked = this.checkedUses.get(declaration);
    if (!checked) { checked = new Set(); this.checkedUses.set(declaration, checked); }
    const key = JSON.stringify([self, [...parameters].sort(), type]);
    if (checked.has(key)) return;
    const environment = new ImplObligations(this.implementations.a, {target: self, impl: declaration}, declaration);
    const visit = value => {
      if (T.projection(value)) { environment.validateCanonical(value, node); return; }
      if (T.reference(value)) { visit(T.target(value)); return; }
      const fn = T.function(value);
      if (fn) { [...fn.params, fn.result].forEach(visit); return; }
      const tuple = T.tuple(value), array = T.array(value);
      (tuple ?? (array ? [array.element] : T.application(value).args)).forEach(visit);
    };
    visit(type); checked.add(key);
  }

  /** Check projection evidence in unused signatures and stored field types.
   * This does not execute or monomorphize generic bodies. */
  validateUses() {
    if (!this.enabled) return;
    const declarations = [...this.index.functions.values(), ...this.index.structs.values(), ...this.index.enums.values()];
    for (const declaration of declarations) {
      if (declaration.builtin) continue;
      const parameters = new Set((declaration.generics ?? []).map(g => g.name));
      const self = declaration.owner ?? declaration.name;
      const fields = declaration.fields?.map(field => field.type) ?? declaration.variants?.flatMap(variant => variant.fields) ?? [];
      const types = [...fields, ...(declaration.params ?? []).map(param => param.type), ...(declaration.returnType ? [declaration.returnType] : [])];
      for (const raw of types) {
        if (!raw.includes('::')) continue;
        const canonical = this.index.type(raw, declaration.module, self, parameters, declaration);
        this.checkUse(canonical, declaration, self, parameters, declaration);
      }
    }
  }

  symbols() {
    const symbol = (item, name, trait) => ({id: item.id, name, trait, kind: 'typeAlias', associatedType: true,
      namespace: 'type', span: item.span, loc: item.loc, line: item.span?.line});
    return [...this.index.traits.values()].flatMap(trait => trait.associatedTypes.map(item =>
      symbol(item, `${trait.name}::${item.localName}`, trait.name))).concat(
      this.implementations.entries.flatMap(entry => entry.impl.associatedTypes.map(item =>
        symbol(item, T.projectionName(entry.target, entry.traitRef, item.localName), entry.traitRef))));
  }

  snapshot() {
    return {queries: this.queries, cacheHits: this.hits, cacheEntries: this.cache.size, cacheCharacters: this.characters};
  }
}
