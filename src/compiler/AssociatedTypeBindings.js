import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplTypePattern} from './ImplTypePattern.js';

/** Declaration-local equations for non-generic associated type bindings.
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
    ].some(bound => bound.includes('=')));
    this.environments = new WeakMap();
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
      return {projection: T.projectionName(subject, [...owners][0], binding.name), type: binding.type};
    });
  }

  environment(parameters, node) {
    const context = this.index.associatedTypes.context(node);
    if (!this.enabled || !context || typeof context !== 'object' || !this.graph || this.building) return null;
    const self = context.kind === 'impl' ? context.target : context.owner ?? 'Self';
    const key = JSON.stringify([self, [...parameters].sort()]);
    let variants = this.environments.get(context);
    if (variants?.has(key)) return variants.get(key);
    this.tick(node);
    const equations = new Map();
    let characters = 0;
    const add = (projection, type) => {
      if (!equations.has(projection)) equations.set(projection, new Set());
      const set = equations.get(projection);
      if (set.has(type)) return;
      set.add(type); characters += projection.length + type.length;
      if (equations.size > this.maxEquations || characters > this.maxCharacters)
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
        if (!rawBound.includes('=') && !this.index.typeResolver.find(this.index.traits, T.application(rawBound).name, module, context)) continue;
        const subject = this.index.type(rawSubject, module, self, parameters, context);
        const bound = this.graph.canonical(rawBound, module, context, parameters, self);
        for (const implied of this.graph.closure(bound, subject))
          for (const equation of this.constraints(subject, implied, context)) add(equation.projection, equation.type);
      }
    } finally { this.building--; }
    if (!variants) { variants = new Map(); this.environments.set(context, variants); }
    // Each key is declaration-local; retain a bounded number of synthetic contexts.
    if (variants.size >= 32) variants.delete(variants.keys().next().value);
    variants.set(key, equations); this.environmentBuilds++;
    return equations;
  }

  lookup(projection, parameters, node) {
    const context = this.index.associatedTypes.context(node);
    // Bounds on free type aliases are not enforced by Rust and must not rewrite
    // the alias's actual associated output. Member spellings are still validated.
    if (context?.kind === 'typeAlias' && !context.owner) return null;
    const equations = this.environment(parameters, node), values = equations?.get(projection);
    if (!values) return null;
    if (values.size > 1) throw new Diagnostic('E0284', `Conflicting associated-type equalities for ${projection}`, node?.span);
    return values.values().next().value;
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

  satisfies(subject, bound, parameters, node) {
    const constraints = this.constraints(subject, bound, node);
    for (const equation of constraints) {
      const actual = this.index.associatedTypes.normalize(equation.projection, parameters, node);
      const expected = this.index.associatedTypes.normalize(equation.type, parameters, node);
      if (actual !== expected) return false;
    }
    return true;
  }

  snapshot() {
    return {enabled: this.enabled, queries: this.queries, environmentBuilds: this.environmentBuilds,
      inferredArguments: this.inferredArguments};
  }

  /** Validate binding syntax/member names even when unused. Contradictory
   * generic assumptions are diagnosed only when a projection needs their value. */
  validateUses() {
    const index = this.index;
    for (const declaration of [...index.functions.values(), ...index.structs.values(), ...index.enums.values(),
      ...index.aliases.values(), ...index.traits.values(), ...index.impls]) {
      if (declaration.builtin) continue;
      const parameters = new Set((declaration.generics ?? []).map(g => g.name));
      if (declaration.kind === 'trait' || declaration.traitContext) parameters.add('Self');
      const bounds = [...(declaration.bounds ?? []), ...(declaration.generics ?? []).flatMap(g => g.bounds),
        ...(declaration.predicates ?? []).flatMap(p => p.bounds)];
      for (const raw of bounds) {
        const app = T.traitApplication(raw);
        const trait = index.typeResolver.find(index.traits, app.name, declaration.module, declaration);
        if (trait && app.args.length !== trait.generics.length)
          throw new Diagnostic('E0107', `Trait ${trait.name} expects ${trait.generics.length} type argument(s)`, declaration.span);
      }
      const equations = this.environment(parameters, declaration);
      if (!equations) continue;
      for (const [projection, values] of equations) {
        for (const value of values) index.typeResolver.validateKnown(value, parameters, declaration);
      }
    }
  }
}
