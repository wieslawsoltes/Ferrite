import {Diagnostic} from '../Diagnostic.js';

/** Function-local, interned ownership places. Local IDs preserve the HIR slot
 * numbering. Referents of reference parameters have independent external roots:
 * moving a pointer must not mark its pointee as moved. Runtime indices deliberately
 * overlap, even when their source happens to be a constant (as in rustc). */
export class PlaceTable {
  static MAX_PLACES = 65_536;
  static MAX_DEPTH = 64;
  static MAX_WORK = 4_194_304;
  constructor(instance) {
    this.instance = instance; this.work = 0;
    if (instance.locals.length > PlaceTable.MAX_PLACES) throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Ownership locals exceed the place budget', instance.fn.span);
    this.entries = instance.locals.map(local => ({id: local.slot, root: local.slot,
      local: local.slot, path: [], external: false}));
    this.children = new Map();
    this.parameters = new Map();
  }
  charge(amount = 1) {
    this.work += amount;
    if (this.work > PlaceTable.MAX_WORK)
      throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Ownership place comparisons exceed their work budget', this.instance.fn.span);
  }
  get(id) { return this.entries[id]; }
  local(id) { return this.get(id)?.local; }
  name(id) {
    const place = this.get(id);
    return (place.external ? '*' : '') + this.instance.locals[place.local].name +
      place.path.map(part => part === null ? '[*]' : `.${part}`).join('');
  }
  allocate(place, node) {
    if (this.entries.length >= PlaceTable.MAX_PLACES || place.path.length > PlaceTable.MAX_DEPTH)
      throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Ownership place graph exceeds its size or depth budget', node?.span);
    const id = this.entries.length;
    this.entries.push({...place, id});
    return id;
  }
  parameter(slot, node) {
    if (!this.parameters.has(slot)) {
      const id = this.entries.length;
      this.parameters.set(slot, this.allocate({root: id, local: slot, path: [], external: true}, node));
    }
    return this.parameters.get(slot);
  }
  pointee(place, node) {
    const key = `pointee:${place}`;
    if (!this.parameters.has(key)) {
      const id = this.entries.length, source = this.get(place);
      this.parameters.set(key, this.allocate({root: id, local: source.local,
        path: [], external: true}, node));
    }
    return this.parameters.get(key);
  }
  project(id, field, node) {
    this.charge(1 + this.get(id).path.length);
    const key = JSON.stringify([id, field]);
    if (!this.children.has(key)) {
      const parent = this.get(id);
      this.children.set(key, this.allocate({...parent, path: [...parent.path, field]}, node));
    }
    return this.children.get(key);
  }
  /** Prefix containment, not overlap. Used to kill only initialized descendants. */
  contains(parent, child) {
    const a = this.get(parent), b = this.get(child);
    this.charge(1 + a.path.length);
    return a.root === b.root && a.path.length <= b.path.length &&
      a.path.every((part, index) => part === b.path[index]);
  }
  overlaps(left, right) {
    const a = this.get(left), b = this.get(right);
    this.charge(1 + Math.min(a.path.length, b.path.length));
    if (a.root !== b.root) return false;
    for (let i = 0; i < Math.min(a.path.length, b.path.length); i++) {
      // Indices may coincide, but subsequent distinct record fields remain
      // disjoint even when the indices are equal.
      if (a.path[i] === null || b.path[i] === null) continue;
      if (a.path[i] !== b.path[i]) return false;
    }
    return true;
  }
  snapshot() { return this.entries.map(place => ({...place, path: [...place.path], name: this.name(place.id)})); }
}
