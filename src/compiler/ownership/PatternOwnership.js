import {Diagnostic} from '../Diagnostic.js';
import {BorrowContract} from './BorrowContract.js';

/** Typed pattern actions refer to source places, not a synthetic whole-value move.
 * Alternatives are joined as sets of possible projections, without a Cartesian
 * expansion. Observations precede committed moves (notably `whole @ (_, copy)`).
 * Explicit reference bindings create loans on these same source projections.
 * General aggregate regions and implicit match ergonomics are not inferred here. Plans and source-expression caches are owned by one analyzer. */
export class PatternOwnership {
  static MAX_NODES = 65_536;
  static MAX_DEPTH = 64;
  constructor(analyzer) { this.a = analyzer; this.plans = new WeakMap(); this.work = 0; }
  charge(node, depth = 0) {
    if (++this.work > PatternOwnership.MAX_NODES || depth > PatternOwnership.MAX_DEPTH)
      throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Pattern ownership exceeds its node or projection-depth budget', node.span);
    this.a.places.charge();
  }
  plan(pattern) {
    if (this.plans.has(pattern)) return this.plans.get(pattern);
    const reads = [], bindings = [];
    const visit = (node, path, depth, choices = []) => {
      this.charge(node, depth);
      if (node.binding) bindings.push({node, path, choices});
      switch (node.kind) {
        case 'wildcard': case 'bindingPattern': break;
        case 'literal': case 'rangePattern': reads.push({node, path}); break;
        case 'atPattern': visit(node.binder, path, depth + 1, choices); visit(node.pattern, path, depth + 1, choices); break;
        case 'orPattern': node.items.forEach((item, index) => visit(item, path, depth + 1, [...choices, [node, index]])); break;
        case 'structPattern': node.fields.forEach(field => visit(field.pattern, [...path, field.name], depth + 1, choices)); break;
        case 'tuplePattern': case 'arrayPattern':
          node.items.forEach((item, index) => visit(item, [...path, String(index)], depth + 1, choices));
          if (node.restBinding) {
            const {binder, start, length} = node.restBinding;
            for (let i = 0; i < length; i++) { this.charge(binder, depth + 1); bindings.push({node: binder, path: [...path, String(start + i)], choices, rest: true}); }
            // An empty rest still initializes its binding but moves no elements.
            if (!length) bindings.push({node: binder, path, choices, empty: true});
          }
          break;
        case 'variantPattern':
          // Enum discriminants must remain initialized even if every payload is
          // ignored. Payload projections are not record field identities.
          reads.push({node, path});
          node.items.forEach((item, index) => visit(item, [...path, `#${node.variant}`, String(index)], depth + 1, choices));
          break;
        default: throw new Diagnostic('F_PATTERN_OWNERSHIP', `No ownership rule for ${node.kind}`, node.span);
      }
    };
    visit(pattern, [], 0);
    const result = {reads, bindings}; this.plans.set(pattern, result); return result;
  }
  prepare(value) {
    const a = this.a;
    // Expire once before evaluation, not between a returned reference's value
    // and its receiving pattern. The old temporary borrower can already be out
    // of lexical scope; its result lineage must attach before another kill.
    a.expire(value);
    if (value.patternStorage) {
      const slot = value.patternStorage.slot;
      a.value(value, true, slot); a.initialize(slot);
      return {value, places: [slot], origins: a.referenceRoots(value), ids: [...a.resultLoans(value)], via: null};
    }
    // Computed pointers acquire their origins while evaluating the address.
    // Do not read/move the pointee, or evaluate a call/index expression twice.
    if (value.patternBorrowed) a.evaluatePlace(value);
    const places = a.roots(value);
    let origins;
    if (places.length) {
      if (!value.patternBorrowed) a.evaluatePlace(value);
      if (BorrowContract.reference(value.type)) {
        origins = places.flatMap(place => a.references.get(place) ??
          (a.places.get(place).external || value.binding?.parameter ? [value.binding?.parameter ? a.places.parameter(place, value) : a.places.pointee(place, value)] : []));
      } else origins = a.referenceRoots(value);
      a.valueOrigins.set(value, [...new Set(origins)]);
      a.provenance.set(value, [...new Set(places.flatMap(place => a.authority(place)))]);
    } else {
      if (value.patternBorrowed) throw new Diagnostic('F_PATTERN_BORROW', 'Reference pattern address has no tracked source origin', value.span);
      origins = a.value(value);
    }
    return {value, places, origins, ids: [...a.resultLoans(value)], via: a.referenceBase(value)};
  }
  project(prepared, path, node) {
    return path.reduce((roots, field) => roots.map(root => this.a.places.project(root, field, node)), prepared.places);
  }
  inspect(pattern, prepared) {
    for (const action of this.plan(pattern).reads)
      this.a.accessPlaces(this.project(prepared, action.path, action.node), action.node, 'read', prepared.via);
  }
  origin(prepared, action) {
    const a = this.a, places = this.project(prepared, action.path, action.node);
    if (!action.path.length) return {roots: prepared.origins, ids: prepared.ids};
    const roots = places.flatMap(place => a.references.get(place) ??
      (a.places.get(place).external ? [a.places.pointee(place, action.node)] : []));
    const ids = places.flatMap(place => a.authority(place));
    return {roots: [...new Set(roots)], ids: [...new Set(ids)]};
  }
  bind(pattern, prepared, commit = true) {
    const a = this.a, moves = new Map(), attachments = new Map();
    const actions = this.plan(pattern).bindings.map(action => ({...action,
      roots: action.empty ? [] : this.project(prepared, action.path, action.node)}));
    const borrows = actions.filter(action => action.node.byRef);
    const plannedIds = borrows.flatMap(action => action.roots.map(root => a.loanId(action.node, root)));
    const parents = a.authority(prepared.via), via = [...parents, ...plannedIds];
    // Validate against pre-existing loans before publishing any new loans. Copy
    // observations happen before borrows, so `ref mut whole @ (copy, _)` works.
    for (const action of borrows) {
      if (!action.roots.length) throw new Diagnostic('F_PATTERN_BORROW', 'Reference pattern needs tracked source storage', action.node.span);
      if (BorrowContract.reference(action.node.type) && action.roots.some(root => !a.references.has(root) &&
          !(prepared.value.binding?.parameter && prepared.value.binding.slot === root)))
        throw new Diagnostic('F_PATTERN_BORROW', 'Borrowing reference storage requires a tracked inner origin', action.node.span);
      a.accessPlaces(action.roots, action.node, action.node.mutable ? 'borrow mutably' : 'read', via);
      for (const other of actions) {
        this.charge(other.node);
        if (action === other || action.node === other.node || other.empty) continue;
        const overlap = action.roots.some(root => other.roots.some(place => a.places.overlaps(root, place)));
        if (!overlap) continue;
        a.places.charge(action.choices.length * other.choices.length);
        const together = !action.choices.some(([choice, branch]) => other.choices.some(([c, b]) => choice === c && branch !== b));
        if (!together) {
          if (other.node.byRef && action.node.binding.slot !== other.node.binding.slot && (action.node.mutable || other.node.mutable))
            throw new Diagnostic('F_PATTERN_BORROW', 'Correlated overlapping reference bindings across alternatives require disjunctive loan origins', other.node.span);
          continue;
        }
        if (other.node.byRef && (action.node.mutable || other.node.mutable))
          throw new Diagnostic('E0499', 'Pattern creates overlapping exclusive loans', other.node.span);
        if (!other.node.byRef && !other.node.copy)
          throw new Diagnostic('E0505', 'Pattern cannot both borrow and move overlapping storage', other.node.span);
      }
    }
    // All observations happen before any source place becomes uninitialized.
    for (const action of actions) {
      this.charge(action.node);
      if (action.node.byRef) continue;
      const {node, roots: places} = action;
      const move = commit && !node.copy && !action.empty;
      if (move && places.length && a.indirect(prepared.value))
        throw new Diagnostic('E0507', 'Cannot move a non-Copy pattern binding out of a borrowed value', prepared.value.span);
      if (move && places.length && a.indexed(prepared.value))
        throw new Diagnostic('E0508', 'Cannot move a non-Copy pattern binding out of an indexed collection', prepared.value.span);
      a.accessPlaces(places, node, move ? 'move' : 'read', via, false);
      if (!action.path.length && BorrowContract.reference(prepared.value.type))
        a.referenceAccess(prepared.value, move ? 'move' : 'read', false);
      if (move) for (const place of places) moves.set(place, node);
      if (BorrowContract.reference(node.type) && !action.rest) {
        const origin = this.origin(prepared, action);
        if (!origin.roots.length) throw new Diagnostic('F_PATTERN_REFERENCE',
          'A reference pattern binding requires a tracked projected origin', node.span);
        const old = attachments.get(node.binding.slot) ?? {roots: [], ids: [], node};
        old.roots.push(...origin.roots); old.ids.push(...origin.ids); attachments.set(node.binding.slot, old);
      } else if (!action.path.length && prepared.value.borrowCarrier && prepared.origins.length)
        attachments.set(node.binding.slot, {roots: prepared.origins, ids: prepared.ids, node});
    }
    for (const action of borrows) {
      const {node, roots} = action, slot = node.binding.slot;
      const ids = roots.map(root => a.loanId(node, root));
      for (let index = 0; index < roots.length; index++) {
        const root = roots[index], id = ids[index];
        if (!a.loans.some(loan => loan.id === id)) {
          a.loans.push({id, root, mutable: !!node.mutable, reserved: false,
            borrower: slot, borrowers: [slot], parents: [...parents], via: prepared.via,
            callFrame: null, until: a.lastUse.get(slot) ?? node.span.end, span: node.span});
          a.event(node.mutable ? 'mutable pattern loan' : 'shared pattern loan', node, root);
        }
      }
      const old = attachments.get(slot) ?? {roots: [], ids: [], node};
      old.roots.push(...roots); old.ids.push(...ids); attachments.set(slot, old);
    }
    for (const [place, node] of moves) { a.moved.add(place); a.event('move', node, place, 'pattern binding'); }
    for (const [slot, {roots, ids, node}] of attachments) a.attach(slot, [...new Set(roots)], node, null, [...new Set(ids)]);
    const initialized = new Set();
    for (const {node} of actions) if (!initialized.has(node.binding.slot)) {
      initialized.add(node.binding.slot); a.initialize(node.binding.slot);
      a.event('initialize pattern binding', node, node.binding.slot, node.binding.type);
    }
  }
  guard(pattern, prepared, expression, action) {
    const a = this.a, old = a.guardBindings, bindings = this.plan(pattern).bindings;
    a.guardBindings = new Set([...(old ?? []), ...bindings.map(item => item.node.binding.slot)]);
    const locks = new Set();
    for (const item of [...this.plan(pattern).reads, ...bindings])
      for (const root of this.project(prepared, item.path, item.node)) if (!locks.has(root)) {
        locks.add(root);
        a.loans.push({id: a.loanId(expression, root), root, mutable: false, reserved: false,
          borrowers: [], borrower: null, parents: [], via: null, callFrame: null,
          until: expression.span.end, span: expression.span, patternGuard: expression});
      }
    try { return action(); }
    finally { a.guardBindings = old; a.loans = a.loans.filter(loan => loan.patternGuard !== expression); }
  }
}
