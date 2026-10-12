import {Diagnostic} from '../Diagnostic.js';
import {BorrowContract} from './BorrowContract.js';

/** Typed pattern actions refer to source places, not a synthetic whole-value move.
 * Alternatives are joined as sets of possible projections, without a Cartesian
 * expansion. Observations precede committed moves (notably `whole @ (_, copy)`).
 * Explicit ref bindings add projected loans; general aggregate regions and implicit
 * match ergonomics are not inferred here. Plans and source-expression caches are owned by one analyzer. */
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
    const visit = (node, path, depth) => {
      this.charge(node, depth);
      if (node.binding) bindings.push({node, path});
      switch (node.kind) {
        case 'wildcard': case 'bindingPattern': break;
        case 'literal': case 'rangePattern': reads.push({node, path}); break;
        case 'atPattern': visit(node.binder, path, depth + 1); visit(node.pattern, path, depth + 1); break;
        case 'orPattern': node.items.forEach(item => visit(item, path, depth + 1)); break;
        case 'structPattern': node.fields.forEach(field => visit(field.pattern, [...path, field.name], depth + 1)); break;
        case 'tuplePattern': case 'arrayPattern':
          node.items.forEach((item, index) => visit(item, [...path, String(index)], depth + 1));
          if (node.restBinding) {
            const {binder, start, length} = node.restBinding;
            for (let i = 0; i < length; i++) { this.charge(binder, depth + 1); bindings.push({node: binder, path: [...path, String(start + i)], rest: true}); }
            // An empty rest still initializes its binding but moves no elements.
            if (!length) bindings.push({node: binder, path, empty: true});
          }
          break;
        case 'variantPattern':
          // Enum discriminants must remain initialized even if every payload is
          // ignored. Payload projections are not record field identities.
          reads.push({node, path});
          node.items.forEach((item, index) => visit(item, [...path, `#${node.variant}`, String(index)], depth + 1));
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
    let places = a.roots(value);
    let origins;
    if (value.patternStorage) {
      origins = a.value(value);
      const slot = value.patternStorage.slot;
      a.initialize(slot); a.attach(slot, origins, value);
      a.event('initialize pattern temporary', value, slot, value.type);
      return {value, places: [slot], origins, ids: [...a.resultLoans(value)], via: null};
    }
    let evaluated = false;
    if (value.patternBorrow) {
      // A returned-reference receiver acquires its origin only when its call
      // runs. Capture the address first, then resolve its projected places.
      a.evaluatePlace(value); places = a.roots(value); evaluated = true;
    }
    if (places.length) {
      if (!evaluated) a.evaluatePlace(value);
      if (BorrowContract.reference(value.type)) {
        origins = places.flatMap(place => a.references.get(place) ??
          (a.places.get(place).external || value.binding?.parameter ? [value.binding?.parameter ? a.places.parameter(place, value) : a.places.pointee(place, value)] : []));
      } else origins = a.referenceRoots(value);
      a.valueOrigins.set(value, [...new Set(origins)]);
      a.provenance.set(value, [...new Set(places.flatMap(place => a.authority(place)))]);
    } else origins = a.value(value);
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
    const a = this.a, actions = this.plan(pattern).bindings, moves = new Map(), attachments = new Map();
    // All observations happen before any source place becomes uninitialized.
    for (const action of [...actions.filter(action => !action.node.byRef), ...actions.filter(action => action.node.byRef)]) {
      this.charge(action.node);
      const {node} = action, places = action.empty ? [] : this.project(prepared, action.path, node);
      if (node.byRef) {
        if (!places.length) throw new Diagnostic('F_PATTERN_BORROW_SOURCE', 'Reference binding has no checked source place', node.span);
        if (BorrowContract.reference(node.matchedType)) {
          const storage = this.origin(prepared, action);
          if (!storage.roots.length) throw new Diagnostic('F_PATTERN_REFERENCE', 'Borrowed reference storage requires a tracked inner origin', node.span);
          a.accessPlaces(storage.roots, node, 'read', storage.ids, false);
        }
        const parents = [...a.authority(prepared.via)];
        const ids = places.map(root => a.loanId(node.binding, root));
        a.accessPlaces(places, node, node.refMutable ? 'borrow mutably' : 'read', [...parents, ...ids], false);
        for (const root of places) {
          const id = a.loanId(node.binding, root);
          if (!a.loans.some(loan => loan.id === id)) a.loans.push({id, root, mutable: !!node.refMutable, reserved: false,
            borrower: node.binding.slot, borrowers: [node.binding.slot], parents, via: prepared.via, callFrame: null,
            until: a.lastUse.get(node.binding.slot) ?? node.span.end, span: node.span});
          a.event(node.refMutable ? 'mutable pattern loan' : 'shared pattern loan', node, root);
        }
        const old = attachments.get(node.binding.slot) ?? {roots: [], ids: [], node};
        old.roots.push(...places); old.ids.push(...parents, ...ids); attachments.set(node.binding.slot, old);
        continue;
      }
      const move = commit && !node.copy && !action.empty;
      if (move && places.length && a.indirect(prepared.value))
        throw new Diagnostic('E0507', 'Cannot move a non-Copy pattern binding out of a borrowed value', prepared.value.span);
      if (move && places.length && a.indexed(prepared.value))
        throw new Diagnostic('E0508', 'Cannot move a non-Copy pattern binding out of an indexed collection', prepared.value.span);
      a.accessPlaces(places, node, move ? 'move' : 'read', prepared.via, false);
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
    // Borrows and moves in one pattern are simultaneous: a later borrowed
    // binding must still conflict with an earlier pending whole/field move.
    for (const [place, node] of moves) a.accessPlaces([place], node, 'move', prepared.via, false);
    for (const [place, node] of moves) { a.moved.add(place); a.event('move', node, place, 'pattern binding'); }
    for (const [slot, {roots, ids, node}] of attachments) a.attach(slot, [...new Set(roots)], node, null, [...new Set(ids)]);
    const initialized = new Set();
    for (const {node} of actions) if (!initialized.has(node.binding.slot)) {
      initialized.add(node.binding.slot); a.initialize(node.binding.slot);
      a.event('initialize pattern binding', node, node.binding.slot, node.type);
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
    // Even a wildcard guard freezes the scrutinee's storage identity. This is
    // shallow: mutating an unrelated descendant remains legal, replacing the
    // selected owner does not. The preceding deep field locks retain ordinary overlap.
    for (const root of prepared.freezeScrutinee ? prepared.places : []) a.loans.push({id: a.loanId(prepared, root), root, mutable: false, reserved: false,
      borrowers: [], borrower: null, parents: [], via: null, callFrame: null, until: expression.span.end,
      span: expression.span, patternGuard: expression, guardShallow: true});
    try { return action(); }
    finally { a.guardBindings = old; a.loans = a.loans.filter(loan => loan.patternGuard !== expression); }
  }
}
