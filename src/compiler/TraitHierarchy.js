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
      const parents = new Set();
      for (const bound of trait.bounds ?? []) parents.add(this.canonical(bound, trait.module, trait));
      for (const predicate of trait.predicates ?? []) {
        if (predicate.type !== 'Self') throw new Diagnostic('F_TRAIT_PREDICATE',
          'Trait-level predicates currently require Self as their subject', predicate.span);
        for (const bound of predicate.bounds) parents.add(this.canonical(bound, trait.module, predicate));
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
  canonical(raw, module = '', node = null) {
    const app = T.application(raw);
    const declaration = this.index.typeResolver.find(this.index.traits, app.name, module, node);
    if (declaration) {
      if (app.args.length) throw new Diagnostic('E0107', `Trait ${declaration.name} has no type arguments`, node?.span);
      return declaration.name;
    }
    const name = raw.split('::').at(-1);
    if (Object.hasOwn(paths, name) && (raw === name || raw === paths[name] || raw === paths[name].replace(/^core::/, 'std::'))) return paths[name];
    if (/^(Fn|FnMut|FnOnce)\(/.test(raw)) return this.index.type(raw, module, null, new Set(), node);
    throw new Diagnostic('E0405', `Unknown trait '${raw}'`, node?.span);
  }
  builtinName(identity) {
    return builtins.has(identity) ? identity.split('::').at(-1) : null;
  }
  parents(identity) { return this.direct.get(identity) ?? builtinParents.get(identity) ?? empty; }
  validateCycles() {
    const color = new Map();
    for (const root of this.direct.keys()) {
      if (color.get(root) === 2) continue;
      const stack = [{id: root, next: 0}]; color.set(root, 1);
      while (stack.length) {
        const frame = stack.at(-1), parents = this.parents(frame.id);
        this.tick(this.index.traits.get(frame.id));
        if (frame.next === parents.length) { color.set(frame.id, 2); stack.pop(); continue; }
        const parent = parents[frame.next++];
        if (color.get(parent) === 1) {
          const cycle = [...stack.slice(stack.findIndex(entry => entry.id === parent)).map(entry => entry.id), parent];
          throw new Diagnostic('E0391', `Cycle in supertraits: ${cycle.join(' -> ')}`, this.index.traits.get(frame.id)?.span);
        }
        if (color.get(parent) !== 2) { color.set(parent, 1); stack.push({id: parent, next: 0}); }
      }
    }
  }
  /** Includes the trait itself; deterministic preorder deduplicates diamonds. */
  closure(identity) {
    if (this.cache.has(identity)) {
      this.hits++; const value = this.cache.get(identity);
      this.cache.delete(identity); this.cache.set(identity, value); return value;
    }
    const seen = new Set(), pending = [identity], result = [];
    let queryVisits = 0;
    while (pending.length) {
      if (++queryVisits > this.maxQueryVisits || ++this.queryVisits > this.maxTotalVisits) this.limit(this.index.traits.get(identity));
      const next = pending.pop(); this.tick(this.index.traits.get(identity));
      if (seen.has(next)) continue;
      seen.add(next); result.push(next);
      const parents = this.parents(next);
      for (let i = parents.length - 1; i >= 0; i--) pending.push(parents[i]);
    }
    const value = Object.freeze(result), cost = identity.length + result.reduce((sum, item) => sum + item.length, 0);
    if (this.maxEntries > 0 && cost <= this.maxCharacters) {
      while (this.cache.size && (this.cache.size >= this.maxEntries || this.characters + cost > this.maxCharacters)) {
        const first = this.cache.keys().next().value, old = this.cache.get(first);
        this.characters -= first.length + old.reduce((sum, item) => sum + item.length, 0); this.cache.delete(first);
      }
      this.cache.set(identity, value); this.characters += cost;
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
