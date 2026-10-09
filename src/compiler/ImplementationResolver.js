import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Structural, invariant matching for impl heads. This is deliberately NOT
 * expression coercion: Wrapper<&mut T> is not Wrapper<&T>. Variables belonging
 * to different declarations are alpha-renamed and unification has an occurs
 * check, so repeated parameters and recursive head equations remain sound. */
export class ImplTypePattern {
  static parse(type, parameters = new Set(), prefix = '', holes = {next: 0}, depth = 0) {
    if (depth > 128) throw new Diagnostic('F_IMPL_DEPTH', 'Implementation type nesting limit exceeded');
    if (parameters.has(type)) return {variable: prefix + type};
    if (type === '_') return {variable: prefix + '?' + holes.next++};
    const next = value => this.parse(value, parameters, prefix, holes, depth + 1);
    if (T.reference(type)) return {kind: 'reference', name: type.startsWith('&mut ') ? '&mut' : '&', args: [next(T.target(type))]};
    const fn = T.function(type);
    if (fn) return {kind: 'function', name: 'fn', args: [...fn.params, fn.result].map(next)};
    const tuple = T.tuple(type);
    if (tuple) return {kind: 'tuple', name: 'tuple', args: tuple.map(next)};
    const array = T.array(type);
    if (array) return {kind: 'array', name: '[' + array.length + ']', args: [next(array.element)]};
    const {name, args} = T.application(type);
    return {kind: 'nominal', name, args: args.map(next)};
  }
  static unify(left, right, bindings = new Map()) {
    const pending = [[left, right]];
    const resolve = term => { while (term.variable && bindings.has(term.variable)) term = bindings.get(term.variable); return term; };
    const occurs = (variable, root) => {
      const queue = [root];
      while (queue.length) { const term = resolve(queue.pop()); if (term.variable === variable) return true; if (!term.variable) queue.push(...term.args); }
      return false;
    };
    while (pending.length) {
      const pair = pending.pop(), a = resolve(pair[0]), b = resolve(pair[1]);
      if (a === b || a.variable && a.variable === b.variable) continue;
      if (a.variable) { if (occurs(a.variable, b)) return null; bindings.set(a.variable, b); }
      else if (b.variable) { if (occurs(b.variable, a)) return null; bindings.set(b.variable, a); }
      else {
        if (a.kind !== b.kind || a.name !== b.name || a.args.length !== b.args.length) return null;
        for (let i = 0; i < a.args.length; i++) pending.push([a.args[i], b.args[i]]);
      }
    }
    return bindings;
  }
  static render(term, bindings, depth = 0) {
    if (depth > 128) throw new Diagnostic('F_IMPL_DEPTH', 'Implementation substitution limit exceeded');
    if (term.variable) return bindings.has(term.variable) ? this.render(bindings.get(term.variable), bindings, depth + 1) : null;
    const args = term.args.map(value => this.render(value, bindings, depth + 1));
    if (args.some(value => value === null)) return null;
    if (term.kind === 'reference') return term.name + (term.name === '&mut' ? ' ' : '') + args[0];
    if (term.kind === 'function') return T.functionName(args.slice(0, -1), args.at(-1));
    if (term.kind === 'tuple') return T.tupleName(args);
    if (term.kind === 'array') return `[${args[0]};${term.name.slice(1, -1)}]`;
    return term.name + (args.length ? `<${args.join(',')}>` : '');
  }
}

/** Per-analysis impl-head/member index. Lookup never mutates an AST, HIR or
 * cached declaration; monomorphizations still use the production call pipeline. */
export class ImplementationResolver {
  constructor(analyzer) {
    this.a = analyzer; this.index = analyzer.index; this.byOwner = new Map(); this.entries = [];
    this.lookups = 0; this.candidatesExamined = 0;
    for (const [id, impl] of this.index.impls.entries()) {
      const parameters = new Set((impl.generics ?? []).map(g => g.name));
      const root = this.root(impl.target, impl.module, parameters);
      const entry = {id, impl, parameters, root, target: null, pattern: null, resolving: false, methods: new Map()};
      this.entries.push(entry);
      if (!this.byOwner.has(root)) this.byOwner.set(root, new Map());
    }
    for (const fn of this.index.functions.values()) if (fn.implIndex !== undefined) {
      const entry = this.entries[fn.implIndex], bucket = this.byOwner.get(entry.root);
      if (entry.methods.has(fn.localName)) throw new Diagnostic('E0592', `Duplicate method ${fn.localName}`, fn.span);
      entry.methods.set(fn.localName, fn);
      if (!bucket.has(fn.localName)) bucket.set(fn.localName, []);
      bucket.get(fn.localName).push(entry);
    }
  }
  root(type, module, parameters, seen = new Set()) {
    const app = T.application(type);
    if (parameters.has(app.name)) return app.name;
    const shape = this.index.typeResolver.find(this.index.structs, app.name, module, null) ??
      this.index.typeResolver.find(this.index.enums, app.name, module, null);
    if (shape) return shape.name;
    const alias = this.index.typeResolver.find(this.index.aliases, app.name, module, null);
    if (!alias) return app.name;
    if (seen.has(alias.name) || seen.size > 64) throw new Diagnostic('E0391', 'Cycle in implementation target aliases', alias.span);
    seen.add(alias.name);
    return this.root(T.substitute(alias.target, new Map(alias.generics.map((g,i) => [g.name, app.args[i]]))), alias.module, parameters, seen);
  }
  prepare(entry) {
    if (entry.pattern) return;
    if (entry.resolving) throw new Diagnostic('E0391', 'Implementation target depends on its own constant evaluation', entry.impl.span);
    entry.resolving = true;
    try {
      entry.target = this.index.type(entry.impl.target, entry.impl.module, null, entry.parameters, entry.impl);
      entry.pattern = ImplTypePattern.parse(entry.target, entry.parameters, `impl${entry.id}:`);
    } finally { entry.resolving = false; }
  }
  validate() {
    for (const entry of this.entries) {
      this.prepare(entry);
      const {impl, parameters, target} = entry;
      if (parameters.size !== (impl.generics ?? []).length) throw new Diagnostic('E0403', 'Duplicate implementation type parameter', impl.span);
      if (impl.trait && parameters.size) throw new Diagnostic('F_GENERIC_TRAIT_IMPL', 'Generic trait implementations require the trait-solving continuation', impl.span);
      if (impl.trait) continue;
      if (/\b_\b/.test(target)) throw new Diagnostic('E0121', 'Implementation targets cannot contain inferred placeholders', impl.span);
      this.index.typeResolver.validateKnown(target, parameters, {...impl, name: target});
      const root = T.application(target).name, shape = this.index.structs.get(root) ?? this.index.enums.get(root);
      if (!shape || ['Option', 'Result'].includes(root) || (shape.crateRoot ?? '') !== (impl.crateRoot ?? ''))
        throw new Diagnostic('E0116', 'Inherent implementations require a nominal type defined in this crate', impl.span);
      const used = new Set(), queue = [entry.pattern];
      while (queue.length) { const term = queue.pop(); if (term.variable) used.add(term.variable); else queue.push(...term.args); }
      for (const name of parameters) if (!used.has(`impl${entry.id}:` + name))
        throw new Diagnostic('E0207', `Implementation parameter ${name} is not constrained by its self type`, impl.span);
      for (const fn of entry.methods.values()) {
        const all = new Set(fn.generics.map(g => g.name));
        if (fn.params[0]?.name === 'self') {
          let receiver = this.index.type(fn.params[0].type, fn.module, target, all, fn);
          while (T.reference(receiver)) receiver = T.target(receiver);
          if (receiver !== target) throw new Diagnostic('E0307', 'The self receiver must refer to the implementing type', fn.params[0].span);
        }
        for (const raw of [...fn.params.map(p => p.type), fn.returnType]) {
          if (raw.startsWith('impl ')) continue; // Existing opaque-return analysis owns this case.
          const type = this.index.type(raw, fn.module, target, all, fn);
          this.index.typeResolver.validateKnown(type, all, fn);
        }
      }
    }
    // Only compare declarations sharing both nominal owner and member name.
    for (const methods of this.byOwner.values()) for (const [name, entries] of methods) {
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        if (!a.impl.trait && !b.impl.trait && ImplTypePattern.unify(a.pattern, b.pattern))
          throw new Diagnostic('E0592', `Overlapping inherent definitions of ${name}`, b.methods.get(name).span,
            [{message: 'Other definition is here', span: a.methods.get(name).span}]);
      }
    }
  }
  match(entry, type) {
    this.prepare(entry);
    const bindings = ImplTypePattern.unify(entry.pattern, ImplTypePattern.parse(type, new Set(), 'query:'));
    if (!bindings) return null;
    return new Map([...entry.parameters].map(name => [name, ImplTypePattern.render({variable: `impl${entry.id}:` + name}, bindings)]));
  }
  applicable(entry, mapping) {
    if ([...mapping.values()].some(type => type === null)) return true;
    const normalize = type => this.index.type(T.substitute(type, mapping), entry.impl.module, T.substitute(entry.target, mapping));
    for (const parameter of entry.impl.generics ?? []) for (const bound of parameter.bounds)
      if (!this.a.hasTrait(mapping.get(parameter.name), normalize(bound))) return false;
    for (const predicate of entry.impl.predicates ?? []) for (const bound of predicate.bounds)
      if (!this.a.hasTrait(normalize(predicate.type), normalize(bound))) return false;
    return true;
  }
  lookup(type, method, module, node) {
    this.lookups++;
    const candidates = this.byOwner.get(T.application(type).name)?.get(method) ?? [], matches = [];
    let boundFailure = false;
    for (const entry of candidates) {
      this.candidatesExamined++;
      const mapping = this.match(entry, type);
      if (!mapping) continue;
      if (!this.applicable(entry, mapping)) { boundFailure = true; continue; }
      matches.push({fn: entry.methods.get(method), mapping});
    }
    const inherent = matches.filter(candidate => !candidate.fn.implementedTrait), selected = inherent.length ? inherent : matches;
    if (selected.length > 1) throw new Diagnostic('E0034', `Multiple applicable methods named ${method} for ${type}`, node.span);
    if (!selected.length) {
      if (boundFailure) throw new Diagnostic('E0277', `Implementation bounds are not satisfied for ${type}::${method}`, node.span);
      return null;
    }
    const result = selected[0]; this.index.visible(result.fn, module, node);
    return result;
  }
  associated(node, context) {
    const separator = node.name.lastIndexOf('::'); if (separator < 0) return null;
    let owner = node.name.slice(0, separator);
    const method = node.name.slice(separator + 2), module = context.instance.fn.module;
    if (owner === 'Self') owner = context.instance.fn.owner;
    else owner = T.substitute(owner, context.instance.substitution ?? new Map(Object.entries(context.instance.typeArguments)));
    if (!owner) return null;
    const app = T.application(owner);
    const declaration = this.index.typeResolver.find(this.index.structs, app.name, module, node) ??
      this.index.typeResolver.find(this.index.enums, app.name, module, node) ?? this.index.typeResolver.find(this.index.aliases, app.name, module, node);
    if (!declaration) return null;
    const explicit = node.ownerTypeArguments?.map(type => this.a.normalize(type, context, node));
    const args = explicit ?? (app.args.length ? app.args : declaration.generics.map(() => '_'));
    if (args.length !== declaration.generics.length) throw new Diagnostic('E0107', `Wrong number of type arguments for ${app.name}`, node.span);
    const type = this.index.type(app.name + (args.length ? `<${args.join(',')}>` : ''), module, context.instance.fn.owner, new Set(), node);
    const result = this.lookup(type, method, module, node);
    if (!result) throw new Diagnostic('E0599', `No associated function ${method} for ${type}`, node.span);
    return result;
  }
  explicit(resolved, node, context) {
    const {fn, mapping} = resolved, count = fn.implGenericCount ?? 0;
    const method = (node.typeArguments ?? []).map(type => this.a.normalize(type, context, node));
    if (method.length && method.length !== fn.generics.length - count) throw new Diagnostic('E0107', `Wrong number of method type arguments for ${fn.localName}`, node.span);
    return [...fn.generics.slice(0, count).map(parameter => mapping.get(parameter.name)), ...method];
  }
  snapshot() { return {implementations: this.entries.length, lookups: this.lookups, candidatesExamined: this.candidatesExamined}; }
}
