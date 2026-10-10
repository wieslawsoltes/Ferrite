import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

const paths = Object.freeze({
  Copy: 'core::marker::Copy', Clone: 'core::clone::Clone',
  Debug: 'core::fmt::Debug', Display: 'core::fmt::Display',
  PartialEq: 'core::cmp::PartialEq', Eq: 'core::cmp::Eq',
  PartialOrd: 'core::cmp::PartialOrd', Ord: 'core::cmp::Ord',
  Sized: 'core::marker::Sized', Send: 'core::marker::Send',
  Sync: 'core::marker::Sync', Unpin: 'core::marker::Unpin', Default: 'core::default::Default',
});
const builtins = new Set(Object.values(paths));
const builtinParents = new Map([
  [paths.Copy, Object.freeze([paths.Clone])],
  [paths.Clone, Object.freeze([paths.Sized])],
  [paths.Default, Object.freeze([paths.Sized])],
  [paths.Eq, Object.freeze([paths.PartialEq])],
  [paths.PartialOrd, Object.freeze([paths.PartialEq])],
  [paths.Ord, Object.freeze([paths.Eq, paths.PartialOrd])],
]);
const empty = Object.freeze([]);

/** Immutable declaration graph and bounded, lazy supertrait elaboration.
 * It is a per-compilation side table: neither syntax trees nor replayed HIR are
 * modified. User and builtin identities cannot collide on a last path segment.
 * Cycle detection is iterative and independent of runtime impl availability. */
export class TraitHierarchy {
  constructor(index, {maxEdges = 65536, maxVisits = 1000000, maxEntries = 1024, maxCharacters = 4000000, maxQueryVisits = 200000, maxTotalVisits = 4000000} = {}) {
    for (const value of [maxEdges, maxVisits, maxEntries, maxCharacters, maxQueryVisits, maxTotalVisits])
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Trait hierarchy limits must be nonnegative safe integers');
    this.index = index; this.direct = new Map(); this.cache = new Map();
    this.maxEdges = maxEdges; this.maxVisits = maxVisits; this.maxEntries = maxEntries; this.maxCharacters = maxCharacters;
    this.maxQueryVisits = maxQueryVisits; this.maxTotalVisits = maxTotalVisits; this.queryVisits = 0;
    this.membership = new WeakMap(); this.ancestorLists = new WeakMap();
    this.edges = 0; this.visits = 0; this.hits = 0; this.characters = 0;
    for (const trait of index.traits.values()) {
      const parents = new Set(), parameters = new Set((trait.generics ?? []).map(g => g.name));
      if (parameters.has('Self') || parameters.size !== (trait.generics ?? []).length)
        throw new Diagnostic('E0403', 'Duplicate trait type parameter', trait.span);
      for (const bound of trait.bounds ?? []) parents.add(this.canonical(bound, trait.module, trait, parameters));
      for (const predicate of trait.predicates ?? []) {
        if (predicate.type === 'Self') for (const bound of predicate.bounds)
          parents.add(this.canonical(bound, trait.module, predicate, parameters));
      }
      for (const parent of parents) if (/^(Fn|FnMut|FnOnce)\(/.test(parent)) throw new Diagnostic('F_SUPERTRAIT_CALLABLE',
        'Callable supertraits require their associated output-type contract', trait.span);
      this.edges += parents.size;
      if (this.edges > maxEdges) this.limit(trait);
      this.direct.set(trait.name, Object.freeze([...parents]));
    }
    this.validateCycles();
  }
  limit(node) { throw new Diagnostic('F_TRAIT_HIERARCHY_LIMIT', 'Supertrait graph or elaboration budget exceeded', node?.span); }
  tick(node) { if (++this.visits > this.maxVisits) this.limit(node); }
  canonical(raw, module = '', node = null, parameters = new Set(), self = 'Self') {
    const app = T.application(raw);
    const declaration = this.index.typeResolver.find(this.index.traits, app.name, module, node);
    if (declaration) {
      const arity = declaration.generics?.length ?? 0;
      if (app.args.length !== arity) throw new Diagnostic('E0107', `Trait ${declaration.name} expects ${arity} type argument(s)`, node?.span);
      const args = app.args.map(type => this.index.type(type, module, self, parameters, node));
      return declaration.name + (args.length ? `<${args.join(',')}>` : '');
    }
    const name = raw.split('::').at(-1);
    if (Object.hasOwn(paths, name) && (raw === name || raw === paths[name] || raw === paths[name].replace(/^core::/, 'std::'))) return paths[name];
    if (/^(Fn|FnMut|FnOnce)\(/.test(raw)) return this.index.type(raw, module, null, new Set(), node);
    throw new Diagnostic('E0405', `Unknown trait '${raw}'`, node?.span);
  }
  builtinName(identity) {
    return builtins.has(identity) ? identity.split('::').at(-1) : null;
  }
  parents(identity, self = 'Self') {
    const {name, args} = T.application(identity), raw = this.direct.get(name);
    if (!raw) return builtinParents.get(identity) ?? empty;
    const generics = this.index.traits.get(name)?.generics ?? [];
    if (generics.length !== args.length) throw new Diagnostic('E0107', `Trait ${name} expects ${generics.length} type argument(s)`);
    if (!generics.length && self === 'Self') return raw;
    const map = new Map([['Self', self], ...generics.map((g, i) => [g.name, args[i]])]);
    const result = raw.map(parent => T.substitute(parent, map));
    if (result.some(parent => parent.length > 65536)) this.limit(this.index.traits.get(name));
    return result;
  }
  validateCycles() {
    const color = new Map();
    for (const root of this.direct.keys()) {
      if (color.get(root) === 2) continue;
      const stack = [{id: root, next: 0}]; color.set(root, 1);
      while (stack.length) {
        const frame = stack.at(-1), parents = this.direct.get(frame.id) ?? builtinParents.get(frame.id) ?? empty;
        this.tick(this.index.traits.get(frame.id));
        if (frame.next === parents.length) { color.set(frame.id, 2); stack.pop(); continue; }
        const parent = T.application(parents[frame.next++]).name;
        if (color.get(parent) === 1) {
          const cycle = [...stack.slice(stack.findIndex(entry => entry.id === parent)).map(entry => entry.id), parent];
          throw new Diagnostic('E0391', `Cycle in supertraits: ${cycle.join(' -> ')}`, this.index.traits.get(frame.id)?.span);
        }
        if (color.get(parent) !== 2) { color.set(parent, 1); stack.push({id: parent, next: 0}); }
      }
    }
  }
  /** Includes the trait itself; deterministic preorder deduplicates diamonds. */
  closure(identity, self = 'Self') {
    const key = self === 'Self' ? identity : JSON.stringify([identity, self]);
    if (this.cache.has(key)) {
      this.hits++; const value = this.cache.get(key);
      this.cache.delete(key); this.cache.set(key, value); return value;
    }
    const seen = new Set(), pending = [identity], result = [];
    let queryVisits = 0, queryCharacters = 0;
    while (pending.length) {
      if (++queryVisits > this.maxQueryVisits || ++this.queryVisits > this.maxTotalVisits) this.limit(this.index.traits.get(identity));
      const next = pending.pop(); this.tick(this.index.traits.get(identity));
      if (seen.has(next)) continue;
      if ((queryCharacters += next.length) > 4000000) this.limit(this.index.traits.get(T.application(identity).name));
      seen.add(next); result.push(next);
      const parents = this.parents(next, self);
      for (let i = parents.length - 1; i >= 0; i--) pending.push(parents[i]);
    }
    const value = Object.freeze(result), cost = key.length + result.reduce((sum, item) => sum + item.length, 0);
    if (this.maxEntries > 0 && cost <= this.maxCharacters) {
      while (this.cache.size && (this.cache.size >= this.maxEntries || this.characters + cost > this.maxCharacters)) {
        const first = this.cache.keys().next().value, old = this.cache.get(first);
        this.characters -= first.length + old.reduce((sum, item) => sum + item.length, 0); this.cache.delete(first);
      }
      this.cache.set(key, value); this.characters += cost;
    }
    return value;
  }
  ancestors(identity) {
    const value = this.closure(identity);
    if (!this.ancestorLists.has(value)) this.ancestorLists.set(value, Object.freeze(value.slice(1)));
    return this.ancestorLists.get(value);
  }
  implies(child, parent) {
    if (child === parent) return true;
    const value = this.closure(child);
    if (!this.membership.has(value)) this.membership.set(value, new Set(value));
    return this.membership.get(value).has(parent);
  }
  snapshot() { return {traits: this.direct.size, edges: this.edges, visits: this.visits, cacheHits: this.hits, cacheEntries: this.cache.size, cacheCharacters: this.characters}; }
}
