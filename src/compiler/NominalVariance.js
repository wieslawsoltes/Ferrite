import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {TypeResolver} from './TypeResolver.js';
import {AssociatedTypeResolver} from './AssociatedTypeResolver.js';
import {GenericDefaults} from './GenericDefaults.js';
import {AssociatedTypeBindings} from './AssociatedTypeBindings.js';
import {TraitHierarchy} from './TraitHierarchy.js';

/** Bounded, declaration-only nominal variance inference. The finite polarity
 * lattice has four values: bivariant, covariant, contravariant and invariant.
 * Each slot refines at most twice; reverse edges avoid rescanning unrelated
 * declarations and recursive applications never expand nominal bodies.
 *
 * Parameter validity is a separate query over the completed field variances:
 * an otherwise bivariant parameter may be determined by a declared associated
 * output equality. Such equations do NOT change its field variance. Neither
 * query consults concrete specializations to manufacture declaration evidence.
 */
export class NominalVariance {
  constructor(index, {maxNodes = 100000, maxEdges = 200000, maxWork = 2000000,
    maxDepth = 128, maxTypeCharacters = 1000000} = {}) {
    for (const value of [maxNodes, maxEdges, maxWork, maxDepth, maxTypeCharacters])
      if (!Number.isSafeInteger(value) || value < 0)
        throw new RangeError('Nominal variance limits must be nonnegative safe integers');
    this.index = index;
    Object.assign(this, {maxNodes, maxEdges, maxWork, maxDepth, maxTypeCharacters});
    this.result = null;
    this.running = false;
  }

  /** Numeric lattice order: bivariant=0, covariant=1, contravariant=2,
   * invariant=3. The ambient transform is deliberately not commutative. */
  static transform(outer, inner) {
    if (outer === 0 || outer === 3) return outer;
    if (outer === 1 || inner === 0 || inner === 3) return inner;
    return inner === 1 ? 2 : 1;
  }

  /** A private resolver view shares declarations, not query caches or reduction
   * state. Preserve projection inputs before equalities/blanket impls erase them.
   * Reuse the existing namespace, alias, default and projection parsers. */
  declarationView() {
    const view = Object.create(this.index);
    view.typeResolver = new TypeResolver(view);
    view.associatedTypes = new AssociatedTypeResolver(view, {preserveProjections: true});
    view.genericDefaults = new GenericDefaults(view);
    view.associatedBindings = new AssociatedTypeBindings(view);
    // The projection-preserving resolver needs only declaration hierarchy, never
    // implementation selection. Keep every mutable hierarchy cache private too.
    const hierarchy = new TraitHierarchy(view);
    view.associatedTypes.implementations = {traits: {hierarchy}, entries: []};
    // Array counts have no bearing on parameter polarity. Do not run CTFE from
    // an inspection query or inject checking-only identities into its evaluator.
    view.constantEvaluator = null;
    return view;
  }

  analyze() {
    if (this.result) return this.result;
    if (this.running) throw new Diagnostic('F_VARIANCE_LIMIT', 'Recursive nominal variance query');
    this.running = true;
    // All mutable state is attempt-local. A budget/typing failure publishes no
    // partial result and a subsequent explicit retry starts with a clean graph.
    const nodes = [], slots = new Map(), transforms = new Map();
    let work = 0, edges = 0, fields = 0, refinements = 0, evaluations = 0;
    const charge = (node, count = 1) => {
      work += count;
      if (work > this.maxWork) throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal variance work budget exceeded', node?.span);
    };
    const vertex = (kind, value = 0, node = null, left = null, right = null) => {
      charge(node);
      if (nodes.length >= this.maxNodes) throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal variance graph budget exceeded', node?.span);
      nodes.push({kind, value, left, right, users: new Set(), node});
      return nodes.length - 1;
    };
    const connect = (source, target, node) => {
      charge(node);
      if (nodes[source].users.has(target)) return;
      if (++edges > this.maxEdges) throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal variance edge budget exceeded', node?.span);
      nodes[source].users.add(target);
    };
    const transform = (left, right, node) => {
      charge(node);
      if (left === 1) return right; // The positive ambient is an identity.
      if (right === 1) return left;
      if (left === 0) return 0;
      if (left < 4 && right < 4) return NominalVariance.transform(left, right);
      const key = `${left},${right}`;
      if (transforms.has(key)) return transforms.get(key);
      const id = vertex('transform', NominalVariance.transform(nodes[left].value, nodes[right].value), node, left, right);
      transforms.set(key, id);
      connect(left, id, node); connect(right, id, node);
      return id;
    };
    const visit = (type, ambient, parameters, node, depth = 0) => {
      charge(node, type.length + 1);
      if (depth > this.maxDepth || type.length > this.maxTypeCharacters)
        throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal variance type traversal budget exceeded', node?.span);
      if (parameters.has(type)) { connect(ambient, parameters.get(type), node); return; }
      if (T.reference(type)) {
        visit(T.target(type), type.startsWith('&mut ') ? transform(ambient, 3, node) : ambient, parameters, node, depth + 1);
        return;
      }
      const fn = T.function(type);
      if (fn) {
        const input = transform(ambient, 2, node);
        for (const parameter of fn.params) visit(parameter, input, parameters, node, depth + 1);
        visit(fn.result, ambient, parameters, node, depth + 1);
        return;
      }
      const tuple = T.tuple(type), array = T.array(type);
      if (tuple || array) {
        for (const item of tuple ?? [array.element]) visit(item, ambient, parameters, node, depth + 1);
        return;
      }
      const projection = T.projection(type);
      if (projection) {
        const invariant = transform(ambient, 3, node);
        visit(projection.self, invariant, parameters, node, depth + 1);
        for (const argument of T.traitApplication(projection.trait).args)
          visit(argument, invariant, parameters, node, depth + 1);
        return;
      }
      const {name, args} = T.application(type);
      const target = slots.get(name);
      if (args.length && !target && name !== 'Vec')
        throw new Diagnostic('F_VARIANCE_TYPE', `Unresolved nominal type in variance analysis: ${type}`, node?.span);
      for (let i = 0; i < args.length; i++) {
        const variance = target ? target[i] : 1; // Only the compiler builtin Vec has no declaration slots.
        if (variance === undefined) throw new Diagnostic('E0107', `Invalid type arguments for ${name}`, node?.span);
        visit(args[i], transform(ambient, variance, node), parameters, node, depth + 1);
      }
    };
    try {
      // Constants: bivariant, covariant, contravariant, invariant.
      for (const value of [0, 1, 2, 3]) vertex('constant', value);
      const shapes = [...this.index.structs.values(), ...this.index.enums.values()];
      for (const shape of shapes) slots.set(shape.name,
        (shape.generics ?? []).map(generic => vertex('parameter', 0, generic.span ? generic : shape)));
      const view = this.declarationView();
      for (const shape of shapes) {
        const ids = slots.get(shape.name), names = (shape.generics ?? []).map(generic => generic.name);
        const parameters = new Map(names.map((name, i) => [name, ids[i]]));
        if (shape.builtin === 'phantom') {
          for (const id of ids) connect(1, id, shape);
          continue;
        }
        const stored = shape.fields?.map(field => ({type: field.type, node: field})) ??
          shape.variants.flatMap(variant => variant.fields.map((type, i) => ({type, node: variant.members?.[i] ?? variant})));
        for (const field of stored) {
          fields++; charge(field.node, field.type.length);
          if (field.type.length > this.maxTypeCharacters)
            throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal variance field type exceeds size budget', field.node.span ?? shape.span);
          const node = {...field.node, span: field.node.span ?? shape.span, typeContext: shape};
          this.variables(field.type, new Set(), new Set(), true, charge, node);
          const type = view.type(field.type, shape.module ?? '', T.traitName(shape.name, names), new Set(names), node);
          visit(type, 1, parameters, node);
        }
      }
      // Queue every initial constraint once, including constants and transforms
      // whose ambient invariant is already known before any slot is refined.
      const queue = nodes.map((_, id) => id), pending = new Uint8Array(nodes.length).fill(1);
      for (let head = 0; head < queue.length; head++) {
        const source = queue[head]; pending[source] = 0;
        for (const target of nodes[source].users) {
          const next = nodes[target]; charge(next.node); evaluations++;
          const value = next.kind === 'parameter' ? next.value | nodes[source].value :
            NominalVariance.transform(nodes[next.left].value, nodes[next.right].value);
          if (value === next.value) continue;
          if ((value | next.value) !== value) throw new Error('Non-monotone nominal variance constraint');
          next.value = value; refinements++;
          if (!pending[target]) { queue.push(target); pending[target] = 1; }
        }
      }
      const varianceNames = ['bivariant', 'covariant', 'contravariant', 'invariant'];
      let equationCount = 0, equationEdges = 0, equationRefinements = 0;
      const declarations = shapes.map(shape => {
        const generics = shape.generics ?? [], names = new Set(generics.map(generic => generic.name));
        const variance = new Map(generics.map((generic, i) => [generic.name, nodes[slots.get(shape.name)[i]].value]));
        const used = new Set([...variance].filter(([, value]) => value !== 0).map(([name]) => name));
        const context = {...shape, owner: T.traitName(shape.name, [...names])};
        // Directed hyperedges: all projection inputs must be constrained before
        // structural output variables can be constrained. Output projections are
        // non-injective and must never be walked in the reverse direction.
        const requirements = [], pendingBounds = [];
        const pairs = generics.flatMap(generic => generic.bounds.map(bound => [generic.name, bound]));
        for (const predicate of shape.predicates ?? []) for (const bound of predicate.bounds)
          pairs.push([predicate.type, bound]);
        for (const [subject, bound] of pairs) {
          const prefix = /^(Fn|FnMut|FnOnce)(?=\()/.exec(bound);
          if (!prefix && !T.traitApplication(bound).bindings.length) continue;
          charge(shape, subject.length + bound.length);
          const origin = view.type(subject, shape.module ?? '', context.owner, names, context);
          if (prefix) {
            // Builtin Fn-family bounds have an associated Output but no nominal
            // trait declaration in the catalog. Inputs are not output evidence.
            const resolved = view.type(bound, shape.module ?? '', context.owner, names, context);
            const fn = T.function('fn' + resolved.slice(prefix[1].length));
            if (fn) requirements.push({inputs: [origin, ...fn.params], output: fn.result});
          } else {
            const canonical = view.associatedBindings.graph.canonical(bound, shape.module ?? '', context, names, context.owner, origin);
            pendingBounds.push({subject: origin, bound: canonical, depth: 0});
          }
        }
        // Only syntactically declared output equations constrain unused slots.
        // A supertrait can own a named binding, but implicit equations inherited
        // merely by `T: Child<U>` do not make U a used nominal parameter.
        for (let head = 0; head < pendingBounds.length; head++) {
          const entry = pendingBounds[head]; charge(shape);
          if (entry.depth > this.maxDepth || pendingBounds.length > this.maxNodes)
            throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal nested equation budget exceeded', shape.span);
          for (const requirement of view.associatedBindings.constraints(entry.subject, entry.bound, context)) {
            if (requirement.bounds) for (const bound of requirement.bounds)
              pendingBounds.push({subject: requirement.projection, bound, depth: entry.depth + 1});
            else requirements.push({inputs: [requirement.projection], output: requirement.type});
          }
        }
        const dependencies = new Map(), ready = [], rules = [];
        for (const requirement of requirements) {
          charge(shape, requirement.inputs.reduce((sum, type) => sum + type.length, requirement.output.length));
          if (++equationCount > this.maxNodes) throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal output equation budget exceeded', shape.span);
          const inputs = new Set();
          for (const type of requirement.inputs) this.variables(type, names, inputs, true, charge, shape);
          const outputs = this.variables(requirement.output, names, new Set(), false, charge, shape);
          const missing = [...inputs].filter(name => !used.has(name));
          const id = rules.push({missing: missing.length, outputs}) - 1;
          for (const name of missing) {
            if (++equationEdges > this.maxEdges) throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal output dependency budget exceeded', shape.span);
            if (!dependencies.has(name)) dependencies.set(name, []);
            dependencies.get(name).push(id);
          }
          if (!missing.length) ready.push(id);
        }
        for (let head = 0; head < ready.length; head++) {
          charge(shape);
          for (const name of rules[ready[head]].outputs) {
            charge(shape);
            if (used.has(name)) continue;
            used.add(name); equationRefinements++;
            for (const id of dependencies.get(name) ?? []) {
              charge(shape);
              if (--rules[id].missing === 0) ready.push(id);
            }
          }
        }
        return Object.freeze({name: shape.name, parameters: Object.freeze(generics.map(generic => Object.freeze({
          name: generic.name, variance: varianceNames[variance.get(generic.name)],
          used: used.has(generic.name), constrainedByOutput: variance.get(generic.name) === 0 && used.has(generic.name),
        })))});
      });
      this.result = Object.freeze({declarations: Object.freeze(declarations), nodes: nodes.length, edges,
        storedFields: fields, work, evaluations, refinements, equationCount, equationEdges, equationRefinements});
      return this.result;
    } finally { this.running = false; }
  }

  /** Bounded structural variable extraction for directed constraints. Nominal
   * arguments are injective even when their field variance is bivariant; an
   * associated projection is not. The same rule applies inside function types. */
  variables(type, parameters, found, inputs, charge, node, depth = 0) {
    charge(node, type.length + 1);
    if (depth > this.maxDepth || type.length > this.maxTypeCharacters)
      throw new Diagnostic('F_VARIANCE_LIMIT', 'Nominal output traversal budget exceeded', node?.span);
    if (parameters.has(type)) { found.add(type); return found; }
    const projection = T.projection(type);
    if (projection) {
      if (inputs) {
        this.variables(projection.self, parameters, found, true, charge, node, depth + 1);
        for (const argument of T.traitApplication(projection.trait).args)
          this.variables(argument, parameters, found, true, charge, node, depth + 1);
      }
      return found;
    }
    if (T.reference(type)) return this.variables(T.target(type), parameters, found, inputs, charge, node, depth + 1);
    const fn = T.function(type), tuple = T.tuple(type), array = T.array(type);
    const children = fn ? [...fn.params, fn.result] : tuple ?? (array ? [array.element] : T.application(type).args);
    for (const child of children) this.variables(child, parameters, found, inputs, charge, node, depth + 1);
    return found;
  }

  validate() {
    for (const declaration of this.analyze().declarations) for (const parameter of declaration.parameters) {
      if (parameter.used) continue;
      const shape = this.index.structs.get(declaration.name) ?? this.index.enums.get(declaration.name);
      const generic = shape.generics.find(generic => generic.name === parameter.name);
      throw new Diagnostic('E0392', `Type parameter ${parameter.name} is unused or only recursively used in ${shape.name}`,
        generic.span ?? shape.span, ['Use the parameter in a constraining field, bind it through a determined associated output, or add std::marker::PhantomData.']);
    }
  }

  snapshot() { return this.analyze(); }
}
