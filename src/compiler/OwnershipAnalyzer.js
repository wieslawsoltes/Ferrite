import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Conservative, whole-local moves and last-use loans. Not a replacement for rustc NLL. */
export class OwnershipAnalyzer {
  constructor(instance) {
    this.instance = instance;
    this.lastUse = new Map(); this.moved = new Set(); this.loans = []; this.references = new Map(); this.events = [];
    this.scan(instance.fn.body);
  }
  static analyze(semantic) {
    return semantic.instances.map(instance => {
      const analyzer = new OwnershipAnalyzer(instance);
      analyzer.block(instance.fn.body);
      return {instance: instance.key, span: instance.fn.span, events: analyzer.events,
        model: 'Conservative whole-local moves and last-use loans (not rustc NLL)'};
    });
  }
  scan(node) {
    if (!node || typeof node !== 'object') return;
    if (node.kind === 'variable' && node.binding) this.lastUse.set(node.binding.slot, Math.max(this.lastUse.get(node.binding.slot) ?? 0, node.span.end));
    if (Array.isArray(node)) { node.forEach(n => this.scan(n)); return; }
    for (const [key, value] of Object.entries(node)) if (!['span', 'loc', 'binding', 'constant'].includes(key)) this.scan(value);
  }
  event(kind, node, slot, detail = '') { this.events.push({kind, slot, name: this.instance.locals[slot]?.name, detail, span: node.span}); }
  expire(node) { this.loans = this.loans.filter(loan => loan.until >= node.span.start); }
  roots(node) {
    if (node.kind === 'variable' && node.binding) return [node.binding.slot];
    if (node.kind === 'field' || node.kind === 'index') return this.roots(node.object);
    if (node.kind === 'unary' && node.op === '*') return this.references.get(node.value.binding?.slot) ?? [];
    return [];
  }
  access(node, mode = 'read', via = null) {
    this.expire(node);
    for (const root of this.roots(node)) {
      if (this.moved.has(root)) throw new Diagnostic('E0382', `Use of moved value '${this.instance.locals[root]?.name}'`, node.span);
      const conflict = this.loans.find(loan => loan.root === root && loan.borrower !== via && (mode !== 'read' || loan.mutable));
      if (conflict) throw new Diagnostic(mode === 'read' ? 'E0503' : 'E0502', `Cannot ${mode} '${this.instance.locals[root]?.name}' while it is borrowed`, node.span,
        [{message: 'Loan starts here', span: conflict.span}]);
      if (mode === 'move') { this.moved.add(root); this.event('move', node, root); }
    }
  }
  value(node, consume = true, destination = null) {
    if (!node) return [];
    this.expire(node);
    if (node.kind === 'literal') return [];
    if (node.kind === 'variable') {
      if (node.constant || node.variant) return [];
      this.access(node, consume && !node.copy ? 'move' : 'read');
      const roots = this.references.get(node.binding?.slot) ?? (T.reference(node.type) && node.binding?.parameter ? [node.binding.slot] : []);
      if (destination != null && roots.length) {
        this.references.set(destination, roots);
        for (const loan of this.loans) if (loan.borrower === node.binding.slot)
          loan.until = Math.max(loan.until, this.lastUse.get(destination) ?? node.span.end);
      }
      return roots;
    }
    if (node.kind === 'unary' && node.op === '&') {
      const roots = this.roots(node.value);
      this.access(node.value, node.mutable ? 'borrow mutably' : 'read');
      for (const root of roots) {
        const conflict = this.loans.find(loan => loan.root === root && (node.mutable || loan.mutable));
        if (conflict) throw new Diagnostic('E0499', 'Conflicting borrows of the same local', node.span);
        this.loans.push({root, mutable: node.mutable, borrower: destination,
          until: destination == null ? node.span.end : this.lastUse.get(destination) ?? node.span.end, span: node.span});
        this.event(node.mutable ? 'mutable loan' : 'shared loan', node, root);
      }
      if (destination != null) this.references.set(destination, roots);
      return roots;
    }
    if (node.kind === 'unary' && node.op === '*') {
      this.value(node.value, false);
      if (consume && !node.copy) throw new Diagnostic('E0507', 'Moving a non-Copy value out of a reference is not allowed', node.span);
      return [];
    }
    if (node.kind === 'field' || node.kind === 'index') {
      this.value(node.object, false); if (node.index) this.value(node.index);
      if (consume && !node.copy) {
        if (node.autoDeref) throw new Diagnostic('E0507', 'Cannot move a field out of a borrowed value', node.span);
        this.access(node, 'move');
      }
      return [];
    }
    if (node.kind === 'block') { this.block(node); return []; }
    if (node.kind === 'ifExpr' || node.kind === 'ifLet') {
      this.value(node.kind === 'ifLet' ? node.value : node.condition);
      const before = new Set(this.moved); this.block(node.then); const yes = new Set(this.moved);
      this.moved = new Set(before); if (node.otherwise) this.value(node.otherwise);
      this.moved = new Set([...yes, ...this.moved]); return [];
    }
    if (node.kind === 'match') {
      this.value(node.value);
      const before = new Set(this.moved), merged = new Set(before);
      for (const arm of node.arms) {
        this.moved = new Set(before); this.value(arm.guard); this.value(arm.body);
        this.moved.forEach(slot => merged.add(slot));
      }
      this.moved = merged; return [];
    }
    if (node.kind === 'loopExpr') { this.block(node.then); return []; }
    if (node.kind === 'intrinsic' || node.kind === 'call') {
      const name = node.builtin ?? node.name;
      if (node.receiver) {
        const consumes = name === 'method::unwrap';
        const mutates = ['method::push', 'method::pop', 'method::push_str'].includes(name);
        this.value(node.receiver, consumes);
        if (mutates && !node.receiverDeref) this.access(node.receiver, 'mutate');
      }
      const borrows = ['println', 'print', 'format', 'assert_eq', 'clone', 'method::clone'].includes(name);
      for (const arg of node.args ?? []) this.value(arg, !borrows);
      return [];
    }
    if (node.kind === 'structLiteral') { node.fields.forEach(f => this.value(f.value)); return []; }
    if (node.items) { node.items.forEach(item => this.value(item)); return []; }
    if (node.left) this.value(node.left);
    if (node.right) this.value(node.right);
    if (node.value) return this.value(node.value, consume, destination);
    return [];
  }
  block(block) {
    for (const node of block.body) {
      this.expire(node);
      if (node.kind === 'let') {
        this.value(node.value, true, node.binding?.slot);
        if (node.binding) { this.moved.delete(node.binding.slot); this.event('initialize', node, node.binding.slot, node.binding.type); }
      } else if (node.kind === 'assign') {
        if (node.target.kind === 'unary' && node.target.op === '*') this.value(node.target.value, false);
        else {
          const roots = this.roots(node.target);
          const previouslyMoved = new Set(this.moved); roots.forEach(root => this.moved.delete(root));
          this.access(node.target, 'mutate'); this.moved = previouslyMoved;
        }
        this.value(node.value);
        this.roots(node.target).forEach(root => { this.moved.delete(root); this.event('assign', node, root); });
      } else if (node.kind === 'return') {
        const roots = this.value(node.value);
        if (T.reference(node.value?.type) && node.value?.type !== '&str' && roots.some(root => !this.instance.locals[root]?.parameter))
          throw new Diagnostic('E0515', 'Cannot return a reference to a local value', node.span);
      } else if (['while', 'whileLet', 'for'].includes(node.kind)) {
        if (node.kind === 'whileLet') this.value(node.value);
        if (node.condition) this.value(node.condition);
        if (node.from) this.value(node.from);
        if (node.to) this.value(node.to);
        const before = new Set(this.moved); this.block(node.then);
        for (const root of this.moved) if (!before.has(root) && this.instance.locals[root].span.start < node.span.start)
          throw new Diagnostic('E0382', 'A non-Copy outer value may be moved on an earlier loop iteration', node.span);
      } else if (node.value) this.value(node.value);
    }
    if (block.tail) {
      const roots = this.value(block.tail);
      if (block === this.instance.fn.body && T.reference(block.tail.type) && block.tail.type !== '&str' && roots.some(root => !this.instance.locals[root]?.parameter))
        throw new Diagnostic('E0515', 'Cannot return a reference to a local value', block.tail.span);
    }
  }
}
