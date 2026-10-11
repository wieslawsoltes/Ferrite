import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplTypePattern} from './ImplTypePattern.js';

/** Declaration-local equations and obligations for associated type constraints.
 *
 * Trait selection uses only the self type and positional trait arguments. The
 * equations are independently checked after selection, or used as explicit
 * symbolic evidence inside their declaring environment. No inverse lookup,
 * guessed implementor, runtime representation, or AST mutation is involved.
 */
export class AssociatedTypeBindings {
  constructor(index) {
    this.index = index;
    const declarations = [...index.functions.values(), ...index.structs.values(), ...index.enums.values(),
      ...index.aliases.values(), ...index.traits.values(), ...index.impls];
    const members = declarations.flatMap(declaration => [...(declaration.methods ?? []), ...(declaration.associatedTypes ?? [])]);
    this.enabled = [...declarations, ...members].some(declaration => [
      ...(declaration.bounds ?? []), ...(declaration.generics ?? []).flatMap(g => g.bounds),
      ...(declaration.predicates ?? []).flatMap(p => p.bounds), declaration.returnType ?? ''
    ].some(bound => bound.includes('=') || /[<,][_\p{ID_Start}][_\p{ID_Continue}]*:(?!:)/u.test(bound)));
    this.environments = new WeakMap();
    // Keep the public equation-table shape stable. Predicate tables share the
    // same lifetime and declaration/parameter key, but are never type equations.
    this.predicateTables = new WeakMap();
    this.inheritedDepth = 0;
    this.predicateCount = 0;
    this.building = 0;
    this.queries = 0;
    this.environmentBuilds = 0;
    this.inferredArguments = 0;
    this.maxQueries = 100000;
    this.maxEquations = 4096;
    this.maxCharacters = 4000000;
  }

  get graph() { return this.index.associatedTypes.implementations?.traits.hierarchy; }

  tick(node) {
    if (++this.queries > this.maxQueries)
      throw new Diagnostic('F_ASSOC_BINDING_LIMIT', 'Associated-type binding budget exceeded', node?.span);
  }

  /** Resolve a binding's member against the complete, applied supertrait graph.
   * The declaring trait, not the spelling used to inherit it, owns the key. */
  constraints(subject, bound, node) {
    const app = T.traitApplication(bound);
    if (!app.bindings.length) return [];
    this.tick(node);
    if (!this.graph) return [];
    const closure = this.graph.closure(T.traitIdentity(bound), subject);
    return app.bindings.map(binding => {
      const direct = this.index.traits.get(app.name)?.associatedTypes.some(item => item.localName === binding.name);
      const candidates = direct ? [T.traitIdentity(bound)] : closure;
      const owners = new Set(candidates.filter(identity =>
        this.index.traits.get(T.application(identity).name)?.associatedTypes.some(item => item.localName === binding.name)
      ).map(identity => T.traitIdentity(identity)));
      if (!owners.size) throw new Diagnostic('E0220', `Trait ${app.name} has no associated type ${binding.name}`, node?.span);
      if (owners.size > 1) throw new Diagnostic('E0222', `Associated type ${binding.name} is ambiguous in ${app.name}`, node?.span);
      const projection = T.projectionName(subject, [...owners][0], binding.name);
      return binding.bounds ? {projection, bounds: binding.bounds} : {projection, type: binding.type};
    });
  }

  /** Elaborate finite syntax only. A recursive declaration such as
   * `type Item: Node` is not eagerly expanded into an infinite projection tree. */
  requirements(subject, bound, node) {
    const pending = [{subject, bound, depth: 0}], seen = new Set(), result = [];
    while (pending.length) {
      const next = pending.pop(); this.tick(node);
      if (next.depth > 64) throw new Diagnostic('F_ASSOC_BINDING_LIMIT', 'Associated bound elaboration depth exceeded', node?.span);
      const key = JSON.stringify([next.subject, next.bound]);
      if (seen.has(key)) continue;
      seen.add(key);
      for (const implied of this.graph?.closure(next.bound, next.subject) ?? [next.bound]) {
        for (const requirement of this.constraints(next.subject, implied, node)) {
          result.push(requirement);
          for (const required of requirement.bounds ?? [])
            pending.push({subject: requirement.projection, bound: required, depth: next.depth + 1});
        }
      }
    }
    return result;
  }

  /** Check argument types without treating a bound's trait name as a type. */
  validateArguments(bound, parameters, node, depth = 0) {
    this.tick(node);
    if (depth > 64) throw new Diagnostic('F_ASSOC_BINDING_LIMIT', 'Associated bound argument depth exceeded', node?.span);
    const callable = /^(Fn|FnMut|FnOnce)(?=\()/.exec(bound);
    if (callable) {
      const signature = T.function('fn' + bound.slice(callable[1].length));
      if (signature) for (const type of [...signature.params, signature.result])
        this.index.typeResolver.validateKnown(type, parameters, node);
      return;
    }
    const app = T.traitApplication(bound);
    for (const type of app.args) this.index.typeResolver.validateKnown(type, parameters, node);
    for (const binding of app.bindings) {
      if (binding.bounds) for (const required of binding.bounds) this.validateArguments(required, parameters, node, depth + 1);
      else this.index.typeResolver.validateKnown(binding.type, parameters, node);
    }
  }

  environment(parameters, node) {
    const context = this.index.associatedTypes.context(node);
    if (!this.enabled || !context || typeof context !== 'object' || !this.graph || this.building) return null;
    const self = context.kind === 'impl' ? context.target : context.owner ?? 'Self';
    const key = JSON.stringify([self, [...parameters].sort()]);
    let variants = this.environments.get(context);
    if (variants?.has(key)) return variants.get(key);
    this.tick(node);
    const equations = new Map(), boundsTable = new Map();
    let characters = 0;
    const add = (table, projection, type) => {
      if (!table.has(projection)) table.set(projection, new Set());
      const set = table.get(projection);
      if (set.has(type)) return;
      set.add(type); characters += projection.length + type.length;
      if (equations.size + boundsTable.size > this.maxEquations || characters > this.maxCharacters)
        throw new Diagnostic('F_ASSOC_BINDING_LIMIT', 'Associated-type equation environment exceeds its budget', node?.span);
    };
    // Suppressed queries have a distinct TypeResolver cache key. Building the
    // equation table cannot publish unrefined answers as normal type queries.
    this.building++;
    try {
      const trait = context.kind === 'trait' ? context : this.index.traits.get(context.traitContext);
      const module = context.module ?? trait?.module ?? '';
      const generics = [...(trait?.generics ?? []), ...(context.generics ?? [])];
      const predicates = [...(trait?.predicates ?? []), ...(context.predicates ?? [])];
      const pairs = generics.flatMap(generic => generic.bounds.map(bound => [generic.name, bound]));
      for (const predicate of predicates) for (const bound of predicate.bounds) pairs.push([predicate.type, bound]);
      const currentTrait = this.index.associatedTypes.traitContext(context);
      if (currentTrait) pairs.push(['Self', currentTrait]);
      for (const [rawSubject, rawBound] of pairs) {
        // Builtin marker/callable bounds cannot carry associated equations. Leave
        // their validation to their existing owner rather than changing diagnostics.
        if (!T.traitApplication(rawBound).bindings.length && !this.index.typeResolver.find(this.index.traits, T.application(rawBound).name, module, context)) continue;
        const subject = this.index.type(rawSubject, module, self, parameters, context);
        const bound = this.graph.canonical(rawBound, module, context, parameters, self);
        add(boundsTable, subject, bound);
        for (const requirement of this.requirements(subject, bound, context)) {
          if (requirement.bounds) for (const required of requirement.bounds) add(boundsTable, requirement.projection, required);
          else add(equations, requirement.projection, requirement.type);
        }
      }
      // Transfer obligations along declared output equalities, never from a
      // concrete implementation or by reversing trait selection. This gives
      // `U: Copy` from `T: Source<Item = U, Item: Copy>`. Conflicting equations
      // stay lazy; merely declaring an uninhabited generic context is legal.
      const pending = [];
      for (const [projection, values] of equations) if (values.size === 1)
        for (const bound of boundsTable.get(projection) ?? []) pending.push([projection, bound]);
      while (pending.length) {
        this.tick(node);
        const [projection, bound] = pending.pop(), values = equations.get(projection);
        if (values?.size !== 1) continue;
        const target = values.values().next().value;
        if (!boundsTable.get(target)?.has(bound)) {
          add(boundsTable, target, bound); pending.push([target, bound]);
        }
      }
    } finally { this.building--; }
    if (!variants) { variants = new Map(); this.environments.set(context, variants); }
    // Each key is declaration-local; retain a bounded number of synthetic contexts.
    if (variants.size >= 32) variants.delete(variants.keys().next().value);
    variants.set(key, equations); this.environmentBuilds++;
    this.predicateTables.set(equations, boundsTable);
    this.predicateCount += [...boundsTable.values()].reduce((count, bounds) => count + bounds.size, 0);
    return equations;
  }

  lookup(projection, parameters, node) {
    const context = this.index.associatedTypes.context(node);
    // Bounds on free type aliases are not enforced by Rust and must not rewrite
    // the alias's actual associated output. Member spellings are still validated.
    if (context?.kind === 'typeAlias' && !context.owner) return null;
    const equations = this.environment(parameters, node);
    const values = new Set(equations?.get(projection) ?? []);
    for (const inherited of this.inheritedRequirements(projection, parameters, node))
      if (!inherited.bounds) values.add(inherited.type);
    if (!values.size) return null;
    if (values.size > 1) throw new Diagnostic('E0284', `Conflicting associated-type equalities for ${projection}`, node?.span);
    return values.values().next().value;
  }

  parametersFor(node) {
    const context = this.index.associatedTypes.context(node);
    const trait = context.kind === 'trait' ? context : this.index.traits.get(context.traitContext);
    return new Set([...(trait?.generics ?? []).map(g => g.name), ...(context.generics ?? []).map(g => g.name),
      ...(trait || context.defaultTrait ? ['Self'] : [])]);
  }

  boundsFor(projection, parameters, node) {
    if (!this.enabled || this.building) return [];
    const context = this.index.associatedTypes.context(node);
    if (context?.kind === 'typeAlias' && !context.owner) return [];
    const equations = this.environment(parameters, node);
    const bounds = new Set(this.predicateTables.get(equations)?.get(projection) ?? []);
    for (const inherited of this.inheritedRequirements(projection, parameters, node))
      for (const bound of inherited.bounds ?? []) bounds.add(bound);
    return [...bounds];
  }

  /** Demand-driven evidence from the receiver's declaration. This also handles
   * `type Item: Source<Output: Copy>` without expanding recursive associated
   * declarations eagerly or using a monomorphized value as symbolic evidence. */
  inheritedRequirements(projection, parameters, node) {
    if (!this.enabled || this.building || !this.graph) return [];
    const outer = T.projection(projection), receiver = outer && T.projection(outer.self);
    if (!receiver) return [];
    this.tick(node);
    if (++this.inheritedDepth > 64) {
      this.inheritedDepth--;
      throw new Diagnostic('F_ASSOC_BINDING_LIMIT', 'Associated bound evidence depth exceeded', node?.span);
    }
    try {
      const result = [];
      for (const bound of this.index.associatedTypes.declaredBounds(receiver, node, parameters))
        for (const requirement of this.requirements(outer.self, bound, node))
          if (requirement.projection === projection) result.push(requirement);
      return result;
    } finally { this.inheritedDepth--; }
  }

  /** Outputs can constrain impl parameters once every projection input is
   * constrained. This is a directed dependency closure, never inverse trait
   * lookup. Projections inside the output are opaque/non-injective. */
  variables(type, parameters, found = new Set(), inputs = false) {
    if (parameters.has(type)) { found.add(type); return found; }
    const projection = T.projection(type);
    if (projection) {
      if (inputs) { this.variables(projection.self, parameters, found, true); this.variables(projection.trait, parameters, found, true); }
      return found;
    }
    if (T.reference(type)) return this.variables(T.target(type), parameters, found, inputs);
    const fn = T.function(type), tuple = T.tuple(type), array = T.array(type);
    const children = fn ? [...fn.params, fn.result] : tuple ?? (array ? [array.element] : T.application(type).args);
    for (const child of children) this.variables(child, parameters, found, inputs);
    return found;
  }

  constrainImplementation(entry, used) {
    const equations = this.environment(entry.parameters, entry.impl);
    if (!equations) return;
    const prefix = `impl${entry.id}:`;
    for (let pass = 0; pass < entry.parameters.size; pass++) {
      const before = used.size;
      for (const [projection, values] of equations) {
        if (![...this.variables(projection, entry.parameters, new Set(), true)].every(name => used.has(prefix + name))) continue;
        for (const value of values) for (const name of this.variables(value, entry.parameters)) used.add(prefix + name);
      }
      if (before === used.size) break;
    }
  }

  completeArguments(declaration, mapping) {
    return this.completeImplementation({id: 'call:' + declaration.name, impl: declaration,
      parameters: new Set((declaration.generics ?? []).map(g => g.name))}, mapping);
  }

  outputDependent(type, mapping, declaration) {
    if (!this.enabled) return false;
    const unknown = new Set([...mapping].filter(([, value]) => value === null).map(([name]) => name));
    const used = this.variables(type, unknown);
    if (!used.size) return false;
    const equations = this.environment(new Set(mapping.keys()), declaration);
    if (!equations) return false;
    for (const values of equations.values()) for (const value of values)
      if ([...this.variables(value, unknown)].some(name => used.has(name))) return true;
    return false;
  }

  /** Complete still-unknown impl arguments from a selected input's associated
   * output. Structural unification is invariant (not expression coercion).
   * Candidate failures are not cached as globally false projection proofs. */
  completeImplementation(entry, mapping) {
    if (!mapping || ![...mapping.values()].some(value => value === null) || !this.enabled) return mapping;
    const equations = this.environment(entry.parameters, entry.impl);
    if (!equations?.size) return mapping;
    const key = JSON.stringify([entry.id, [...mapping]]);
    const active = this.inferenceActive ??= new Set();
    if (active.has(key)) return null;
    if (active.size >= 64) throw new Diagnostic('E0275', 'Associated output inference recursion limit exceeded', entry.impl.span);
    active.add(key);
    try {
      for (let pass = 0; pass < entry.parameters.size; pass++) {
        const before = [...mapping.values()].filter(value => value !== null).length;
        for (const [projection, values] of equations) {
          if ([...this.variables(projection, entry.parameters, new Set(), true)].some(name => mapping.get(name) == null)) continue;
          for (const value of values) {
            const unknown = new Set([...mapping].filter(([, value]) => value === null).map(([name]) => name));
            if (![...this.variables(value, unknown)].length) continue;
            const query = T.substitute(projection, mapping);
            let actual;
            try { actual = this.index.associatedTypes.normalize(query, new Set(), entry.impl); }
            catch (error) { if (error instanceof Diagnostic && ['E0277', 'E0391'].includes(error.code)) return null; throw error; }
            const expected = T.substitute(value, mapping);
            if (this.index.associatedTypes.containsProjection(expected) || this.index.associatedTypes.containsProjection(actual)) continue;
            const bindings = ImplTypePattern.unify(ImplTypePattern.parse(expected, unknown, 'output:'), ImplTypePattern.parse(actual));
            if (!bindings) return null;
            for (const name of unknown) {
              const inferred = ImplTypePattern.render({variable: 'output:' + name}, bindings);
              if (inferred !== null) { mapping.set(name, inferred); this.inferredArguments++; }
            }
          }
        }
        if ([...mapping.values()].filter(value => value !== null).length === before) break;
      }
      return mapping;
    } finally { active.delete(key); }
  }

  satisfies(subject, bound, parameters, node, prove = null) {
    const requirements = this.requirements(subject, bound, node);
    prove ??= (type, required) => this.index.associatedTypes.implementations.a.hasBound(type, required);
    for (const requirement of requirements) {
      const actual = this.index.associatedTypes.normalize(requirement.projection, parameters, node);
      if (requirement.bounds) {
        for (const required of requirement.bounds) if (!prove(actual, required)) return false;
      } else {
        const expected = this.index.associatedTypes.normalize(requirement.type, parameters, node);
        if (actual !== expected) return false;
      }
    }
    return true;
  }

  snapshot() {
    return {enabled: this.enabled, queries: this.queries, environmentBuilds: this.environmentBuilds,
      inferredArguments: this.inferredArguments, predicates: this.predicateCount};
  }

  /** Validate binding syntax/member names even when unused. Contradictory
   * generic assumptions are diagnosed only when a projection needs their value. */
  validateUses() {
    const index = this.index;
    const declarations = [...index.functions.values(), ...index.structs.values(), ...index.enums.values(),
      ...index.aliases.values(), ...index.traits.values(), ...index.impls];
    for (const trait of index.traits.values()) {
      declarations.push(...trait.methods);
      declarations.push(...trait.associatedTypes.map(item => ({...item, traitContext: trait.name, typeContext: trait})));
    }
    for (const declaration of new Set(declarations)) {
      if (declaration.builtin) continue;
      const parameters = this.parametersFor(declaration);
      const context = index.associatedTypes.context(declaration);
      const self = context.kind === 'impl' ? context.target : context.owner ?? 'Self';
      const bounds = [...(declaration.bounds ?? []), ...(declaration.generics ?? []).flatMap(g => g.bounds),
        ...(declaration.predicates ?? []).flatMap(p => p.bounds),
        ...(declaration.returnType?.startsWith('impl ') ? [declaration.returnType.slice(5)] : [])];
      for (const raw of bounds) {
        const app = T.traitApplication(raw);
        const trait = index.typeResolver.find(index.traits, app.name, declaration.module, declaration);
        if (trait && app.args.length !== trait.generics.length)
          throw new Diagnostic('E0107', `Trait ${trait.name} expects ${trait.generics.length} type argument(s)`, declaration.span);
        if (!this.enabled) continue;
        const bound = this.graph.canonical(raw, declaration.module ?? context.module, declaration, parameters, self);
        this.validateArguments(bound, parameters, declaration);
        this.requirements('_', bound, declaration); // includes member validation for an empty `Item:` bound
      }
      const equations = this.environment(parameters, declaration);
      if (!equations) continue;
      for (const values of equations.values()) for (const value of values)
        index.typeResolver.validateKnown(value, parameters, declaration);
      for (const values of this.predicateTables.get(equations)?.values() ?? []) for (const bound of values)
        this.validateArguments(bound, parameters, declaration);
    }
  }
}
