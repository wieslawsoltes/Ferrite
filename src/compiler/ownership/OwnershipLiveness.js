import {Diagnostic} from '../Diagnostic.js';

/** A control-flow graph of typed-HIR evaluation points. It is deliberately
 * separate from the forward ownership state: backward liveness must converge
 * before a loan can be killed. Source offsets are locations, never lifetimes.
 * Bitsets and predecessor-driven worklists bound memory and charge actual work.
 * This computes local-use liveness, not universal lifetime/region constraints. */
export class OwnershipLiveness {
  static MAX_NODES = 65_536;
  static MAX_WORDS = 8_388_608;
  static MAX_WORK = 16_777_216;
  static MAX_DEPTH = 256;
  constructor(instance) {
    this.instance = instance;
    this.words = Math.ceil(instance.locals.length / 32);
    this.nodes = []; this.entries = new WeakMap(); this.continuations = new WeakMap(); this.controls = new Map();
    this.work = 0; this.iterations = 0; this.depth = 0;
    this.exit = this.vertex([], [], []);
    this.entry = this.expression(instance.fn.body, this.exit);
    this.solve();
  }
  limit(message) { throw new Diagnostic('F_OWNERSHIP_LIMIT', message, this.instance.fn.span); }
  charge(amount) {
    this.work += amount;
    if (this.work > OwnershipLiveness.MAX_WORK) this.limit('Ownership liveness exceeds its work budget');
  }
  vertex(next, uses = [], defs = []) {
    if (this.nodes.length >= OwnershipLiveness.MAX_NODES ||
        (this.nodes.length + 1) * this.words > OwnershipLiveness.MAX_WORDS)
      this.limit('Ownership liveness graph exceeds its memory budget');
    const id = this.nodes.length;
    this.nodes.push({next: [...new Set(next)], uses, defs, live: new Uint32Array(this.words), previous: []});
    return id;
  }
  bindings(pattern) {
    if (!pattern) return [];
    if (pattern.kind === 'orPattern') return this.bindings(pattern.items[0]);
    return [...(pattern.binding ? [pattern.binding.slot] : []),
      ...this.bindings(pattern.binder), ...this.bindings(pattern.pattern),
      ...(pattern.items ?? []).flatMap(p => this.bindings(p)),
      ...(pattern.fields ?? []).flatMap(f => this.bindings(f.pattern)),
      ...this.bindings(pattern.restBinding?.binder)];
  }
  sequence(nodes, next) {
    for (let i = nodes.length - 1; i >= 0; i--) next = this.expression(nodes[i], next);
    return next;
  }
  place(node, next, read = false) {
    if (!node) return next;
    if (node.kind === 'variable') {
      const id = this.vertex([next], read && node.binding ? [node.binding.slot] : []);
      this.entries.set(node, id); return id;
    }
    if (node.kind === 'field' || node.kind === 'index') {
      next = this.expression(node.index, next);
      const id = node.autoDeref ? this.expression(node.object, next) : this.place(node.object, next, read);
      this.entries.set(node, id); return id;
    }
    if (node.kind === 'unary' && node.op === '*') {
      const id = this.expression(node.value, next); this.entries.set(node, id); return id;
    }
    return this.expression(node, next);
  }
  expression(node, next) {
    if (!node) return next;
    if (++this.depth > OwnershipLiveness.MAX_DEPTH) this.limit('Ownership liveness exceeds its nesting budget');
    try {
      const id = this.build(node, next);
      this.entries.set(node, id); this.continuations.set(node, next);
      return id;
    } finally { this.depth--; }
  }
  build(node, next) {
    const expr = value => this.expression(value, next);
    switch (node.kind) {
      case 'variable': return this.vertex([next], node.binding ? [node.binding.slot] : []);
      case 'literal': case 'functionItem': case 'constantReference': return this.vertex([next]);
      case 'block': return this.sequence(node.body, this.expression(node.tail, next));
      case 'let': {
        const defined = this.vertex([next], [], this.bindings(node.pattern));
        const branch = node.otherwise ? this.vertex([defined, this.expression(node.otherwise, this.exit)]) : defined;
        return this.expression(node.value, branch);
      }
      case 'assign': {
        if (node.destructuring) {
          const targets = [];
          const visit = target => {
            if (target.assignee === 'place') targets.push(target);
            else (target.assignee === 'struct' ? target.fields.map(f => f.value) : target.items ?? []).forEach(visit);
          };
          visit(node.target);
          for (let i = targets.length - 1; i >= 0; i--) {
            const target = targets[i];
            const write = this.vertex([next], [], target.kind === 'variable' ? [target.binding.slot] : []);
            next = this.place(target, write);
          }
        } else {
          const write = this.vertex([next], [], node.target.kind === 'variable' ? [node.target.binding.slot] : []);
          next = this.place(node.target, write, node.op !== '=');
        }
        return this.expression(node.value, next);
      }
      case 'return': return this.expression(node.value, this.exit);
      case 'break': return this.expression(node.value, this.controls.get(node.controlTarget)?.done ?? this.exit);
      case 'continue': return this.controls.get(node.controlTarget)?.header ?? this.exit;
      case 'ifExpr': case 'ifLet': {
        let yes = this.expression(node.then, next), no = this.expression(node.otherwise, next);
        if (node.pattern) yes = this.vertex([yes], [], this.bindings(node.pattern));
        return this.expression(node.condition ?? node.value, this.vertex([yes, no]));
      }
      case 'ifChain': return this.chain(node, this.expression(node.then, next), this.expression(node.otherwise, next));
      case 'match': {
        let alternative = next;
        for (let i = node.arms.length - 1; i >= 0; i--) {
          const arm = node.arms[i], body = this.expression(arm.body, next);
          const accepted = arm.guard ? this.expression(arm.guard, this.vertex([body, alternative])) : body;
          const bound = this.vertex([accepted], [], this.bindings(arm.pattern));
          // Pattern failure skips this arm; guard failure continues with all
          // effects/uses of that guard, rather than going straight to match exit.
          alternative = this.vertex([bound, alternative]);
        }
        return this.expression(node.value, alternative);
      }
      case 'loopExpr': case 'while': case 'whileLet': case 'whileChain': case 'for': case 'labelBlock': {
        const header = this.vertex([]);
        this.controls.set(node.id, {header, done: next});
        let body = this.expression(node.then, node.kind === 'labelBlock' ? next : header);
        if (node.pattern) body = this.vertex([body], [], this.bindings(node.pattern));
        let condition = body;
        if (node.kind === 'whileChain') condition = this.chain(node, body, next);
        else if (node.kind === 'while' || node.kind === 'whileLet')
          condition = this.expression(node.condition ?? node.value, this.vertex([body, next]));
        else if (node.kind === 'for') condition = this.vertex([body, next]);
        this.nodes[header].next = [condition];
        this.controls.delete(node.id);
        return this.sequence([node.from, node.to], header);
      }
      case 'binary': {
        const right = this.expression(node.right, next);
        return this.expression(node.left, ['&&', '||'].includes(node.op) ? this.vertex([right, next]) : right);
      }
      case 'unary': return node.op === '&' ? this.place(node.value, next, true) : expr(node.value);
      case 'closure': case 'structLiteral': return this.sequence(node.fields.map(field => field.value), next);
      case 'field': case 'index': return this.sequence([node.object, node.index], next);
      case 'call': case 'intrinsic': {
        // A call's arguments are evaluated before it can diverge.
        const end = this.vertex([node.type === '!' ? this.exit : next]);
        return this.sequence([node.calleeValue, node.temporaryCallee?.value, node.receiver, ...(node.args ?? [])], end);
      }
      default: return this.sequence([node.left, node.right, node.value, ...(node.items ?? [])], next);
    }
  }
  chain(node, yes, no) {
    for (let i = node.conditions.length - 1; i >= 0; i--) {
      const term = node.conditions[i];
      const accepted = term.pattern ? this.vertex([yes], [], this.bindings(term.pattern)) : yes;
      yes = this.expression(term.pattern ? term.value : term, this.vertex([accepted, no]));
      this.entries.set(term, yes);
    }
    return yes;
  }
  solve() {
    for (let id = 0; id < this.nodes.length; id++)
      for (const next of this.nodes[id].next) this.nodes[next].previous.push(id);
    const queue = this.nodes.map((_, id) => id), queued = new Uint8Array(this.nodes.length).fill(1);
    const scratch = new Uint32Array(this.words);
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const id = queue[cursor], node = this.nodes[id]; queued[id] = 0; this.iterations++;
      this.charge(1 + this.words * (node.next.length + 2) + node.uses.length + node.defs.length);
      scratch.fill(0);
      for (const next of node.next) for (let word = 0; word < this.words; word++) scratch[word] |= this.nodes[next].live[word];
      for (const slot of node.defs) scratch[slot >>> 5] &= ~(1 << (slot & 31));
      for (const slot of node.uses) scratch[slot >>> 5] |= 1 << (slot & 31);
      let changed = false;
      for (let word = 0; word < this.words; word++) if (scratch[word] !== node.live[word]) { changed = true; break; }
      if (!changed) continue;
      node.live.set(scratch);
      for (const before of node.previous) if (!queued[before]) { queued[before] = 1; queue.push(before); }
    }
  }
  after(node) { const id = this.continuations.get(node); return id == null ? null : this.nodes[id].live; }
  before(node) { const id = this.entries.get(node); return id == null ? null : this.nodes[id].live; }
  has(live, slot) { return !!(live[slot >>> 5] & (1 << (slot & 31))); }
  snapshot() { return {nodes: this.nodes.length, edges: this.nodes.reduce((n, v) => n + v.next.length, 0),
    bitsetWords: this.nodes.length * this.words, iterations: this.iterations, work: this.work}; }
}
