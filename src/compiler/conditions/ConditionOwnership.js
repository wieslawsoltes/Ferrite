import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';
import {ConditionChain} from './ConditionChain.js';

/** Structured flow for condition chains, on the shared projection-sensitive ownership
 * domain. Failure edges retain effects already performed, never effects of a
 * skipped operand. Loop headers reach a bounded fixed point over backedges.
 * Local liveness comes from the backward CFG solver; this is not full rustc NLL. */
export class ConditionOwnership {
  static MAX_WORK = 1_048_576;
  static MAX_DEPTH = 64;
  static MAX_ITERATIONS = 128;

  constructor(analyzer, node) { this.a = analyzer; this.node = node; }
  charge(amount = 1) {
    this.a.conditionWork = (this.a.conditionWork ?? 0) + amount;
    if (this.a.conditionWork > ConditionOwnership.MAX_WORK)
      throw new Diagnostic('F_CONDITION_LIMIT', 'Condition ownership analysis exceeds its work budget', this.node.span);
  }
  size(state) {
    return 1 + state.moved.size + [...state.references.values()].reduce((n, roots) => n + 1 + roots.length, 0) +
      [...state.authorities.values()].reduce((n, ids) => n + 1 + ids.length, 0) +
      state.loans.reduce((n, loan) => n + 1 + loan.parents.length + loan.borrowers.length, 0);
  }
  save() {
    const a = this.a;
    this.charge(this.size(a));
    return {moved: new Set(a.moved), loans: a.loans.map(loan => ({...loan, borrowers: [...loan.borrowers], parents: [...loan.parents]})),
      references: new Map([...a.references].map(([slot, roots]) => [slot, [...roots]])),
      authorities: new Map([...a.authorities].map(([slot, ids]) => [slot, [...ids]]))};
  }
  load(state) {
    this.a.moved = new Set(state.moved);
    this.a.loans = state.loans.map(loan => ({...loan}));
    this.a.references = new Map([...state.references].map(([slot, roots]) => [slot, [...roots]]));
    this.a.authorities = new Map([...state.authorities].map(([slot, ids]) => [slot, [...ids]]));
  }
  loanKey(loan) {
    return JSON.stringify([loan.root, loan.borrower, loan.mutable, loan.reserved, loan.via,
      loan.callFrame?.end, loan.span?.start, loan.span?.end, loan.id, loan.parents]);
  }
  join(states) {
    const merged = {moved: new Set(), loans: [], references: new Map(), authorities: new Map()}, loans = new Map();
    for (const state of states) {
      this.charge(this.size(state));
      for (const slot of state.moved) merged.moved.add(slot);
      for (const [slot, roots] of state.references)
        merged.references.set(slot, [...new Set([...(merged.references.get(slot) ?? []), ...roots])]);
      for (const [slot, ids] of state.authorities)
        merged.authorities.set(slot, [...new Set([...(merged.authorities.get(slot) ?? []), ...ids])]);
      for (const loan of state.loans) {
        const key = this.loanKey(loan), old = loans.get(key);
        if (!old) loans.set(key, {...loan});
        else { old.until = Math.max(old.until, loan.until); old.borrowers = [...new Set([...old.borrowers, ...loan.borrowers])]; }
      }
    }
    merged.loans = [...loans.values()];
    return merged;
  }
  key(state) {
    return JSON.stringify([[...state.moved].sort((a, b) => a - b),
      state.loans.map(loan => [this.loanKey(loan), loan.until, [...loan.borrowers].sort((a,b)=>a-b)]).sort(),
      [...state.references].map(([slot, roots]) => [slot, [...roots].sort((a, b) => a - b)]).sort((a, b) => a[0] - b[0]),
      [...state.authorities].map(([slot, ids]) => [slot, [...ids].sort((a,b)=>a-b)]).sort((a,b)=>a[0]-b[0])]);
  }
  localSlots() {
    return new Set(this.a.instance.locals.filter(local => local.span &&
      local.span.start >= this.node.span.start && local.span.end <= this.node.span.end).map(local => local.slot));
  }
  leave(state, slots, roots = []) {
    if (roots.some(root => slots.has(this.a.places.local(root)) && !this.a.places.get(root).external)) {
      // Tail loop/block results retain the function-return diagnostic; let
      // chains retain their existing, more specific condition-scope diagnostic.
      if (['labelBlock', 'loopExpr'].includes(this.node.kind) && this.node === this.a.instance.fn.body.tail)
        this.a.checkReturn(this.node, roots, this.node);
      throw new Diagnostic('E0597', 'A scope-local value does not outlive its control-flow result', this.node.span);
    }
    const after = this.a.liveness.after(this.node);
    for (const [slot, targets] of state.references) {
      if (slots.has(slot)) { state.references.delete(slot); state.authorities.delete(slot); continue; }
      if (targets.some(root => slots.has(this.a.places.local(root)) && !this.a.places.get(root).external) &&
          (after ? this.a.liveness.has(after, slot) : (this.a.lastUse.get(slot) ?? 0) > this.node.span.end))
        throw new Diagnostic('E0597', 'A reference to a scope-local value escapes its control-flow scope', this.node.span);
    }
    state.moved = new Set([...state.moved].filter(slot => !slots.has(this.a.places.local(slot))));
    state.loans = state.loans.flatMap(loan => {
      const borrowers = loan.borrowers.filter(slot => !slots.has(slot));
      if (borrowers.length) return [{...loan, borrowers, borrower: borrowers[0]}];
      if (!loan.borrowers.length) return [loan];
      // Preserve an outer copy of a scoped reference. With no named borrower,
      // the enclosing result/assignment takes responsibility for its lineage.
      return roots.includes(loan.root) ? [{...loan, borrowers: [], borrower: null, until: this.node.span.end}] : [];
    });
    return state;
  }
  bind(term, prepared) {
    const a = this.a, value = term.value, roots = prepared.origins;
    if (term.binding && (T.reference(value.type) && value.type !== '&str' || value.borrowCarrier)) {
      if (!roots.length) throw new Diagnostic('F_CONDITION_REFERENCE',
        'A reference condition binding requires a tracked local or parameter origin', value.span);
      if (roots.some(root => {
        const span = a.places.get(root).external ? null : a.instance.locals[a.places.local(root)]?.span;
        return span && span.start >= value.span.start && span.end <= value.span.end;
      })) throw new Diagnostic('E0597', 'A scrutinee-local value does not outlive its condition binding', value.span);
    }
    a.patterns.bind(term.pattern, prepared);
  }
  terms(failures) {
    for (const term of ConditionChain.terms(this.node)) {
      this.charge();
      const pattern = term.kind === 'letCondition' ? term.pattern : null;
      const value = pattern ? term.value : term;
      const prepared = pattern ? this.a.patterns.prepare(value) : null;
      if (pattern) this.a.patterns.inspect(pattern, prepared);
      else this.a.value(value);
      if (value.type === '!') return false;
      if (!pattern || !term.irrefutable) failures.push(this.save());
      if (pattern) {
        this.bind(term, prepared);
        // rustc still checks an if-chain's alternative continuation when a
        // pattern is irrefutable, with the successful binding's move effects.
        if (term.irrefutable) failures.push(this.save());
      }
    }
    return true;
  }
  result(value, roots) {
    if ((T.reference(value?.type) && value.type !== '&str' || value?.borrowCarrier) && !roots.length)
      throw new Diagnostic('F_CONDITION_REFERENCE',
        'A reference-valued condition branch requires a tracked local or parameter origin', value.span);
  }
  conditional() {
    const a = this.a, failures = [], slots = this.localSlots(), outputs = [], roots = [], ids = [];
    if (this.terms(failures)) {
      const yes = a.block(this.node.then);
      if (this.node.then.type !== '!') {
        this.result(this.node.then, yes);
        roots.push(...yes); ids.push(...a.resultLoans(this.node.then)); outputs.push(this.leave(this.save(), slots, yes));
      }
    }
    if (failures.length) {
      this.load(this.join(failures.map(state => this.leave(state, slots))));
      const no = a.value(this.node.otherwise);
      if (this.node.otherwise?.type !== '!') {
        this.result(this.node.otherwise, no);
        roots.push(...no); ids.push(...a.resultLoans(this.node.otherwise)); outputs.push(this.leave(this.save(), slots, no));
      }
    }
    this.load(this.join(outputs));
    a.provenance.set(this.node, [...new Set(ids)]);
    return [...new Set(roots)];
  }
  loop() {
    const a = this.a, initial = this.save(), slots = this.localSlots();
    let header = initial;
    const eventsStart = a.events.length;
    // Replaying a header must not append duplicate exits to an enclosing loop.
    const enclosing = a.controls.map(frame => [frame, frame.roots.length, frame.breaks?.length, frame.continues?.length]);
    for (let iteration = 0; iteration < ConditionOwnership.MAX_ITERATIONS; iteration++) {
      a.conditionIterations = (a.conditionIterations ?? 0) + 1;
      this.charge(); this.load(header); a.events.length = eventsStart;
      for (const [frame, roots, breaks, continues] of enclosing) {
        frame.roots.length = roots;
        if (frame.breaks) frame.breaks.length = breaks;
        if (frame.continues) frame.continues.length = continues;
      }
      const failures = [], frame = {id: this.node.id, roots: [], breaks: [], continues: [], flow: this};
      a.controls.push(frame);
      try {
        if (this.terms(failures)) {
          a.block(this.node.then);
          if (this.node.then.type !== '!') frame.continues.push(this.save());
        }
      } finally { a.controls.pop(); }
      const next = this.join([initial, ...frame.continues.map(state => this.leave(state, slots))]);
      if (this.key(next) === this.key(header)) {
        this.load(this.join([...failures, ...frame.breaks].map(state => this.leave(state, slots))));
        return [];
      }
      header = next;
    }
    throw new Diagnostic('F_CONDITION_LIMIT', 'Condition loop ownership did not converge within its iteration budget', this.node.span);
  }
  static analyze(analyzer, node) {
    if ((analyzer.conditionDepth = (analyzer.conditionDepth ?? 0) + 1) > this.MAX_DEPTH) {
      analyzer.conditionDepth--;
      throw new Diagnostic('F_CONDITION_LIMIT', 'Nested condition ownership exceeds its depth budget', node.span);
    }
    try {
      const flow = new this(analyzer, node);
      return node.kind === 'ifChain' ? flow.conditional() : flow.loop();
    } finally { analyzer.conditionDepth--; }
  }
}
