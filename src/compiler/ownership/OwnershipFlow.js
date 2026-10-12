import {ConditionOwnership} from '../conditions/ConditionOwnership.js';
import {Diagnostic} from '../Diagnostic.js';

/** Structured forward dataflow over the same finite place/loan state used by
 * let chains. Every alternative starts from its own snapshot; terminated paths
 * never contaminate a join. Backedges include explicit continue edges. */
export class OwnershipFlow extends ConditionOwnership {
  conditional() {
    const a = this.a, node = this.node;
    const prepared = node.kind === 'ifLet' ? a.patterns.prepare(node.value) : null;
    if (prepared) a.patterns.inspect(node.pattern, prepared);
    else a.value(node.condition);
    const before = this.save(), outputs = [], roots = [], ids = [], slots = this.localSlots();
    for (const branch of [node.then, node.otherwise]) {
      this.load(before);
      if (prepared && branch === node.then) a.patterns.bind(node.pattern, prepared);
      const result = a.value(branch);
      if (branch?.type !== '!') {
        roots.push(...result); ids.push(...a.resultLoans(branch));
        outputs.push(this.leave(this.save(), slots, result));
      }
    }
    this.load(this.join(outputs)); a.provenance.set(node, [...new Set(ids)]);
    return [...new Set(roots)];
  }
  shortCircuit() {
    const a = this.a, node = this.node;
    a.value(node.left);
    const before = this.save(); a.value(node.right);
    this.load(this.join(node.right.type === '!' ? [before] : [before, this.save()]));
    return [];
  }
  match() {
    const a = this.a, node = this.node;
    const prepared = a.patterns.prepare(node.value);
    const outputs = [], roots = [], ids = [], slots = this.localSlots();
    let remaining = this.save();
    for (const arm of node.arms) {
      this.load(remaining); a.patterns.inspect(arm.pattern, prepared);
      if (arm.guard) {
        a.patterns.bind(arm.pattern, prepared, false);
        a.patterns.guard(arm.pattern, prepared, arm.guard, () => a.value(arm.guard));
      }
      // A false guard can mutate/move outer state before the next pattern is
      // attempted. Pattern failure instead preserves the prior state.
      const guarded = this.save();
      if (arm.guard?.type !== '!') {
        a.patterns.bind(arm.pattern, prepared);
        const result = a.value(arm.body);
        if (arm.body.type !== '!') {
          outputs.push(this.leave(this.save(), slots, result)); roots.push(...result); ids.push(...a.resultLoans(arm.body));
        }
      }
      remaining = arm.guard && arm.guard.type !== '!' ? this.join([remaining, this.leave(guarded, slots)]) : remaining;
    }
    this.load(this.join(outputs)); a.provenance.set(node, [...new Set(ids)]);
    return [...new Set(roots)];
  }
  loop() {
    const a = this.a, node = this.node;
    a.value(node.from); a.value(node.to);
    const initial = this.save(), events = a.events.length, slots = this.localSlots();
    const enclosing = a.controls.map(frame => [frame, frame.roots.length, frame.breaks?.length, frame.continues?.length]);
    let header = initial;
    for (let iteration = 0; iteration < ConditionOwnership.MAX_ITERATIONS; iteration++) {
      a.conditionIterations = (a.conditionIterations ?? 0) + 1;
      this.load(header); this.charge(); a.events.length = events;
      for (const [frame, roots, breaks, continues] of enclosing) {
        frame.roots.length = roots;
        if (frame.breaks) frame.breaks.length = breaks;
        if (frame.continues) frame.continues.length = continues;
      }
      const frame = {id: node.id, roots: [], resultLoans: [], breaks: [], continues: [], flow: this};
      a.controls.push(frame);
      let tail = [], fallthrough, failures = [];
      try {
        const prepared = node.kind === 'whileLet' ? a.patterns.prepare(node.value) : null;
        if (prepared) a.patterns.inspect(node.pattern, prepared);
        else if (node.condition) a.value(node.condition);
        if (['for', 'while', 'whileLet'].includes(node.kind)) failures.push(this.save());
        if (prepared) a.patterns.bind(node.pattern, prepared);
        tail = a.block(node.then);
        if (node.then.type !== '!') {
          if (node.kind === 'labelBlock') fallthrough = this.save();
          else frame.continues.push(this.save());
        }
      } finally { a.controls.pop(); }
      const next = this.join([initial, ...frame.continues.map(state => this.leave(state, slots))]);
      if (node.kind === 'labelBlock' || this.key(next) === this.key(header)) {
        const roots = [...new Set([...frame.roots, ...(fallthrough ? tail : [])])];
        const states = [...failures, ...frame.breaks, ...(fallthrough ? [fallthrough] : [])];
        this.load(this.join(states.map(state => this.leave(state, slots, roots))));
        a.provenance.set(node, [...new Set([...frame.resultLoans, ...(fallthrough ? a.resultLoans(node.then) : [])])]);
        return roots;
      }
      header = next;
    }
    throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Loop ownership did not converge within its iteration budget', node.span);
  }
  static analyze(analyzer, node) {
    if ((analyzer.conditionDepth = (analyzer.conditionDepth ?? 0) + 1) > ConditionOwnership.MAX_DEPTH) {
      analyzer.conditionDepth--; throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Ownership control flow exceeds its nesting budget', node.span);
    }
    try {
      const flow = new this(analyzer, node);
      if (['ifExpr', 'ifLet'].includes(node.kind)) return flow.conditional();
      if (node.kind === 'binary') return flow.shortCircuit();
      return node.kind === 'match' ? flow.match() : flow.loop();
    } finally { analyzer.conditionDepth--; }
  }
}
