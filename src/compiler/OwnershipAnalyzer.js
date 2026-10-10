import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Conservative, whole-local moves and last-use loans. Not a replacement for rustc NLL. */
export class OwnershipAnalyzer {
  constructor(instance) {
    this.instance = instance;
    this.lastUse = new Map(); this.moved = new Set(); this.loans = []; this.references = new Map(); this.events = [];
    this.controls = []; this.callFrame = null;
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
    if (node.kind === 'field' || node.kind === 'index') return node.autoDeref ? this.referenceRoots(node.object) : this.roots(node.object);
    if (node.kind === 'unary' && node.op === '*') return this.referenceRoots(node.value);
    return [];
  }
  referenceRoots(node) {
    return this.references.get(node.binding?.slot) ??
      (T.reference(node.type) && node.binding?.parameter ? [node.binding.slot] : []);
  }
  conflicts(loan, mode) {
    if (mode === 'read') return loan.mutable && !loan.reserved;
    if (mode === 'reserve mutably') return loan.mutable;
    return true;
  }
  referenceAccess(node, mode = 'read') {
    this.expire(node);
    for (const root of this.referenceRoots(node)) {
      const conflict = this.loans.find(loan => loan.root === root && loan.borrower !== node.binding?.slot &&
        this.conflicts(loan, mode));
      if (conflict) throw new Diagnostic('E0502', `Cannot ${mode} through a reference while its referent is borrowed`, node.span,
        [{message:'Conflicting loan starts here', span:conflict.span}]);
    }
  }
  referenceBase(node) {
    if (node.kind === 'unary' && node.op === '*') return node.value.binding?.slot ?? null;
    if (node.kind === 'field' || node.kind === 'index') return node.autoDeref ? node.object.binding?.slot ?? null : this.referenceBase(node.object);
    return null;
  }
  access(node, mode = 'read', via = null) {
    this.expire(node);
    for (const root of this.roots(node)) {
      if (this.moved.has(root)) throw new Diagnostic('E0382', `Use of moved value '${this.instance.locals[root]?.name}'`, node.span);
      const conflict = this.loans.find(loan => loan.root === root && (via == null || loan.borrower !== via) && this.conflicts(loan, mode));
      if (conflict) throw new Diagnostic(mode === 'read' ? 'E0503' : 'E0502', `Cannot ${mode} '${this.instance.locals[root]?.name}' while it is borrowed`, node.span,
        [{message: 'Loan starts here', span: conflict.span}]);
      if (mode === 'move') { this.moved.add(root); this.event('move', node, root); }
    }
  }
  value(node, consume = true, destination = null) {
    const roots = this.evaluateValue(node, consume, destination);
    if (destination != null && roots.length) {
      this.references.set(destination, roots);
      for (const loan of this.loans) if (roots.includes(loan.root)) {
        loan.borrower = destination;
        loan.until = Math.max(loan.until, this.lastUse.get(destination) ?? node.span.end);
      }
    }
    return roots;
  }
  evaluateValue(node, consume = true, destination = null) {
    if (!node) return [];
    this.expire(node);
    if (node.kind === 'literal' || node.kind === 'constValue' || node.kind === 'functionItem') return [];
    if (node.kind === 'closure') {
      const roots=node.fields.flatMap(field=>this.value(field.value,true,destination));
      if(destination!=null&&roots.length)this.references.set(destination,roots);
      return roots;
    }
    if (node.kind === 'variable') {
      if (node.constant || node.variant) return [];
      this.access(node, consume && !node.copy ? 'move' : 'read');
      const roots = this.referenceRoots(node);
      if (T.reference(node.type)) this.referenceAccess(node, consume && !node.copy ? 'move' : 'read');
      if (destination != null && roots.length) {
        this.references.set(destination, roots);
        for (const loan of this.loans) if (loan.borrower === node.binding.slot)
          loan.until = Math.max(loan.until, this.lastUse.get(destination) ?? node.span.end);
      }
      return roots;
    }
    if (node.kind === 'unary' && node.op === '&') {
      if (node.implicitReceiverReborrow) {
        const pointer = node.value.value;
        this.value(pointer, false);
        const roots = this.referenceRoots(pointer);
        if (!roots.length || !this.callFrame) throw new Diagnostic('F_REBORROW_REFERENCE',
          'Method receiver references must have a tracked local or parameter origin', node.span);
        this.referenceAccess(pointer, node.mutable ? 'reserve mutably' : 'read');
        for (const root of roots) {
          this.loans.push({root, mutable:node.mutable, reserved:node.mutable, via:pointer.binding?.slot, borrower:null, callFrame:this.callFrame,
            until:this.callFrame.end, span:node.span});
          this.event(node.mutable ? 'reserve mutable reborrow' : 'shared reborrow', node, root);
        }
        return roots;
      }
      const roots = this.roots(node.value);
      const reserved = !!node.implicitReceiverBorrow && node.mutable;
      const mode = reserved ? 'reserve mutably' : node.mutable ? 'borrow mutably' : 'read';
      this.access(node.value, mode);
      for (const root of roots) {
        const conflict = this.loans.find(loan => loan.root === root && this.conflicts(loan, mode));
        if (conflict) throw new Diagnostic('E0499', 'Conflicting borrows of the same local', node.span);
        this.loans.push({root, mutable: node.mutable, reserved, borrower: destination,
          callFrame:destination == null ? this.callFrame : null,
          until: destination == null ? this.callFrame?.end ?? node.span.end : this.lastUse.get(destination) ?? node.span.end, span: node.span});
        this.event(reserved ? 'reserve mutable loan' : node.mutable ? 'mutable loan' : 'shared loan', node, root);
      }
      if (destination != null) this.references.set(destination, roots);
      return roots;
    }
    if (node.kind === 'unary' && node.op === '*') {
      this.value(node.value, false);
      if (consume && !node.copy) throw new Diagnostic('E0507', 'Moving a non-Copy value out of a reference is not allowed', node.span);
      return [];
    }
    // Rust comparison operators borrow both operands, including owned strings.
    if (node.kind === 'binary' && ['==', '!=', '<', '>', '<=', '>='].includes(node.op)) {
      this.value(node.left, false); this.value(node.right, false); return [];
    }
    if (node.kind === 'field' || node.kind === 'index') {
      this.value(node.object, false); if (node.index) this.value(node.index);
      if (consume && !node.copy) {
        if (node.autoDeref) throw new Diagnostic('E0507', 'Cannot move a field out of a borrowed value', node.span);
        this.access(node, 'move');
      }
      return [];
    }
    if (node.kind === 'block') return this.block(node);
    if (node.kind === 'assign') { this.assignment(node); return []; }
    if (node.kind === 'return') { this.returnValue(node.value, node); return []; }
    if (node.kind === 'break') {
      const roots = this.value(node.value);
      this.controls.findLast(frame => frame.id === node.controlTarget)?.roots.push(...roots);
      return [];
    }
    if (node.kind === 'continue') return [];
    if (node.kind === 'ifExpr' || node.kind === 'ifLet') {
      this.value(node.kind === 'ifLet' ? node.value : node.condition);
      const before = new Set(this.moved), yesRoots = this.block(node.then), yes = new Set(this.moved);
      this.moved = new Set(before); const noRoots = this.value(node.otherwise);
      this.moved = new Set([...(node.then.type === '!' ? [] : yes), ...(node.otherwise?.type === '!' ? [] : this.moved)]); return [...new Set([...yesRoots, ...noRoots])];
    }
    if (node.kind === 'match') {
      this.value(node.value);
      const before = new Set(this.moved), merged = new Set(before), roots = [];
      for (const arm of node.arms) {
        this.moved = new Set(before); this.value(arm.guard); roots.push(...this.value(arm.body));
        if(arm.body.type !== '!')this.moved.forEach(slot => merged.add(slot));
      }
      this.moved = merged; return [...new Set(roots)];
    }
    if (['loopExpr', 'labelBlock', 'while', 'whileLet', 'for'].includes(node.kind)) return this.controlValue(node);
    if (node.kind === 'intrinsic' || node.kind === 'call') return this.callValue(node);
    if (node.kind === 'structLiteral') { node.fields.forEach(f => this.value(f.value)); return []; }
    if (node.items) { node.items.forEach(item => this.value(item)); return []; }
    if (node.left) this.value(node.left);
    if (node.right) this.value(node.right);
    if (node.value) return this.value(node.value, consume, destination);
    return [];
  }
  callValue(node) {
    // Receiver reborrows cover argument evaluation and this call, not the next
    // statement. Nested calls release only their own loans, never the outer
    // receiver's loan. Only compiler-inserted method receivers reserve then
    // activate; explicit source &mut borrows are active immediately.
    const previous = this.callFrame, frame = {end:node.span.end};
    this.callFrame = frame;
    try {
      if(node.calleeValue)this.value(node.calleeValue,false);
      if(node.temporaryCallee)this.value(node.temporaryCallee.value,true,node.temporaryCallee.binding.slot);
      const name = node.builtin ?? node.name;
      if (node.receiver) {
        const consumes = ['method::unwrap','method::into_bytes'].includes(name);
        const mutates = ['method::push', 'method::pop', 'method::push_str', 'method::remove'].includes(name);
        this.value(node.receiver, consumes);
        if (mutates) {
          if (node.receiverDeref) this.referenceAccess(node.receiver, 'mutate');
          else this.access(node.receiver, 'mutate');
        }
      }
      const borrows = ['println', 'print', 'format', 'assert_eq', 'clone', 'method::clone'].includes(name);
      for (const arg of node.args ?? []) {
        const roots = this.value(arg, !borrows);
        if (T.reference(arg.type)) for (const loan of this.loans)
          if (roots.includes(loan.root) && loan.borrower === (arg.binding?.slot ?? null))
            loan.until = Math.max(loan.until, frame.end);
      }
      this.expire({span:{start:frame.end}});
      for (const loan of this.loans) if (loan.callFrame === frame && loan.reserved) {
        const conflict = this.loans.find(other => other !== loan && other.root === loan.root &&
          (loan.via == null || other.borrower !== loan.via));
        if (conflict) throw new Diagnostic('E0502', 'Cannot activate a mutable method receiver while its referent is borrowed', node.span,
          [{message:'Conflicting loan starts here', span:conflict.span}]);
        loan.reserved = false;
        this.event('activate mutable receiver', node, loan.root);
      }
      return [];
    } finally {
      this.loans = this.loans.filter(loan => loan.callFrame !== frame);
      this.callFrame = previous;
    }
  }
  block(block) {
    for (const node of block.body) {
      this.expire(node);
      if (node.kind === 'let') {
        if (node.otherwise) { const moved = new Set(this.moved); this.block(node.otherwise); this.moved = moved; }
        this.value(node.value, true, node.binding?.slot);
        if (node.binding) { this.moved.delete(node.binding.slot); this.event('initialize', node, node.binding.slot, node.binding.type); }
      } else if (node.kind === 'assign') this.assignment(node);
      else if (['return', 'break', 'continue', 'while', 'whileLet', 'for'].includes(node.kind)) this.value(node);
      else if (node.value) this.value(node.value);
    }
    const roots = this.value(block.tail);
    if (block === this.instance.fn.body) this.checkReturn(block.tail, roots, block.tail ?? block);
    return roots;
  }
  checkReturn(value, roots, origin) {
    if ((T.reference(value?.type) && value?.type !== '&str' || value?.borrowCarrier) && roots.some(root => value?.borrowCarrier || !this.instance.locals[root]?.parameter || !T.reference(this.instance.locals[root]?.type)))
      throw new Diagnostic('E0515', 'Cannot return a reference to a local value', origin.span);
  }
  returnValue(value, origin) { this.checkReturn(value, this.value(value), origin); }
  assignment(node) {
    if (node.destructuring) {
      this.value(node.value, node.assignmentMoves);
      if (node.assignmentRhsDiverges) return;
      const visit = target => {
        if (target.assignee === 'place') { this.writePlace(target, node); return; }
        for (const child of target.assignee === 'struct' ? target.fields.map(field => field.value) : target.items ?? []) visit(child);
      };
      visit(node.target); return;
    }
    const destination = node.target.kind === 'variable' ? node.target.binding?.slot : null;
    this.value(node.value, true, destination);
    this.writePlace(node.target, node);
  }
  writePlace(target, assignment) {
    const node = {target, op: assignment.op, span: target.span};
    const destination = target.kind === 'variable' ? target.binding?.slot : null;
    // Index/deref operands are evaluated once, after the RHS. Only a plain
    // whole-local assignment may reinitialize a previously moved local.
    const evaluatePlace = target => {
      if (target.kind === 'index' || target.kind === 'field') {
        this.value(target.object, false);
        if (target.index) this.value(target.index);
      } else if (target.kind === 'unary' && target.op === '*') this.value(target.value, false);
    };
    evaluatePlace(node.target);
    const roots = this.roots(node.target), previouslyMoved = new Set(this.moved);
    if (node.op === '=' && destination != null) this.moved.delete(destination);
    this.access(node.target, 'mutate', this.referenceBase(node.target));
    this.moved = previouslyMoved;
    roots.forEach(root => { this.moved.delete(root); this.event('assign', node, root); });
  }
  controlValue(node) {
    if (node.kind === 'whileLet') this.value(node.value);
    if (node.condition) this.value(node.condition);
    if (node.from) this.value(node.from);
    if (node.to) this.value(node.to);
    const before = new Set(this.moved), frame = {id: node.id, roots: []};
    this.controls.push(frame);
    const tailRoots = this.block(node.then); this.controls.pop();
    if (node.kind !== 'labelBlock' && node.then.type !== '!') for (const root of this.moved)
      if (!before.has(root) && this.instance.locals[root].span.start < node.span.start)
        throw new Diagnostic('E0382', 'A non-Copy outer value may be moved on an earlier loop iteration', node.span);
    return [...new Set([...frame.roots, ...(node.kind === 'labelBlock' ? tailRoots : [])])];
  }
}
