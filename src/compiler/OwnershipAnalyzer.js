import {BorrowContract} from './ownership/BorrowContract.js';
import {Diagnostic} from './Diagnostic.js';
import {ConditionOwnership} from './conditions/ConditionOwnership.js';
import {OwnershipLiveness} from './ownership/OwnershipLiveness.js';
import {OwnershipFlow} from './ownership/OwnershipFlow.js';
import {PlaceTable} from './ownership/PlaceTable.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Projection-sensitive moves and loans with explicit reference authority.
 * Region syntax, interprocedural lifetimes and drop checking remain separate. */
export class OwnershipAnalyzer {
  constructor(instance) {
    this.instance = instance; this.places = new PlaceTable(instance);
    this.provenance = new WeakMap(); this.valueOrigins = new WeakMap(); this.authorities = new Map(); this.loanSites = new WeakMap(); this.nextLoan = 0;
    this.lastUse = new Map(); this.moved = new Set(); this.loans = []; this.references = new Map(); this.events = [];
    this.controls = []; this.callFrame = null;
    this.scan(instance.fn.body);
    this.liveness = new OwnershipLiveness(instance); this.pendingDestinations = []; this.activeCalls = []; this.constructing = new Set();
  }
  static analyze(semantic) {
    return semantic.instances.map(instance => {
      const analyzer = new OwnershipAnalyzer(instance);
      analyzer.block(instance.fn.body);
      BorrowContract.validate(instance.referenceContract, instance.fn);
      return {instance: instance.key, span: instance.fn.span, events: analyzer.events,
        ...(analyzer.conditionWork ? {conditions: {work: analyzer.conditionWork, loopIterations: analyzer.conditionIterations ?? 0}} : {}),
        places: analyzer.places.snapshot(), placeWork: analyzer.places.work, liveness: analyzer.liveness.snapshot(),
        referenceContract: instance.referenceContract ?? null,
        model: 'Projection-sensitive moves, CFG local liveness and reborrow authority (not full rustc NLL)'};
    });
  }
  scan(node) {
    const pending = [node], seen = new WeakSet(); let work = 0;
    while (pending.length) {
      const value = pending.pop();
      if (!value || typeof value !== 'object' || seen.has(value)) continue;
      seen.add(value);
      if (++work > OwnershipLiveness.MAX_NODES * 16)
        throw new Diagnostic('F_OWNERSHIP_LIMIT', 'Ownership input exceeds its traversal budget', this.instance.fn.span);
      if (value.kind === 'variable' && value.binding)
        this.lastUse.set(value.binding.slot, Math.max(this.lastUse.get(value.binding.slot) ?? 0, value.span.end));
      if (Array.isArray(value)) pending.push(...value);
      else for (const [key, child] of Object.entries(value))
        if (!['span', 'loc', 'binding', 'constant'].includes(key)) pending.push(child);
    }
  }
  event(kind, node, place, detail = '') {
    const slot = this.places.local(place);
    this.events.push({kind, slot, place, name: this.instance.locals[slot]?.name, detail, span: node.span});
  }
  expire(node, after = false) {
    const live = after ? this.liveness.after(node) : this.liveness.before(node);
    const retained = new Set(), pending = [], byId = new Map(), storageOrigins = new Map();
    const keep = loan => { if (!retained.has(loan)) { retained.add(loan); pending.push(loan); } };
    for (const loan of this.loans) {
      const same = byId.get(loan.id) ?? []; same.push(loan); byId.set(loan.id, same);
      if (loan.callFrame && this.activeCalls.includes(loan.callFrame) ||
          this.activeCalls.some(frame => frame.protected.has(loan.id)) ||
          loan.borrowers.some(slot => this.pendingDestinations.includes(slot)) ||
          (!loan.borrowers.length ? loan.until >= node.span.start : live
            ? loan.borrowers.some(slot => this.liveness.has(live, slot)) : loan.until >= node.span.start)) keep(loan);
    }
    // Index reference storage by allocation root. Unrelated locals must not
    // incur a loan-by-every-local cross product while tracing dependencies.
    for (const [storage, ids] of this.authorities) {
      this.places.charge();
      const root = this.places.get(storage).root, origins = storageOrigins.get(root) ?? [];
      origins.push([storage, ids]); storageOrigins.set(root, origins);
    }
    // A borrowed reference cell may not itself have a future named use. Its
    // pointee nevertheless outlives every reachable read through that cell.
    // Trace dependencies to a fixed point before discarding any loan; filtering
    // in insertion order would lose nested &&T origins and shared copies.
    for (let cursor = 0; cursor < pending.length; cursor++) {
      const loan = pending[cursor]; this.places.charge();
      for (const [storage, ids] of storageOrigins.get(this.places.get(loan.root).root) ?? []) if (this.places.contains(loan.root, storage))
        for (const id of ids) { this.places.charge(); for (const dependency of byId.get(id) ?? []) keep(dependency); }
      for (const id of loan.parents) { this.places.charge(); for (const parent of byId.get(id) ?? []) keep(parent); }
    }
    this.loans = this.loans.filter(loan => retained.has(loan));
  }
  roots(node) {
    if (!node) return [];
    if (node.kind === 'variable' && node.binding) return [node.binding.slot];
    if (node.kind === 'field' || node.kind === 'index') {
      const parents = node.autoDeref ? this.referenceRoots(node.object) : this.roots(node.object);
      return parents.map(id => this.places.project(id, node.kind === 'field' ? String(node.field) : null, node));
    }
    if (node.kind === 'unary' && node.op === '*') return this.referenceRoots(node.value);
    return [];
  }
  referenceRoots(node) {
    if (!node) return [];
    if (node.binding) return this.references.get(node.binding.slot) ??
      (T.reference(node.type) && node.binding.parameter ? [this.places.parameter(node.binding.slot, node)] : []);
    if (T.reference(node.type) && ['field', 'index'].includes(node.kind)) {
      return this.roots(node).flatMap(id => this.references.get(id) ??
        (this.places.get(id).external ? [this.places.pointee(id, node)] : []));
    }
    return this.valueOrigins.get(node) ?? [];
  }
  authority(slot) { return Array.isArray(slot) ? slot : this.authorities.get(slot) ?? []; }
  permitted(loan, via) { return via != null && this.authority(via).includes(loan.id); }
  loanId(node, root) {
    let sites = this.loanSites.get(node);
    if (!sites) this.loanSites.set(node, sites = new Map());
    if (!sites.has(root)) sites.set(root, this.nextLoan++);
    return sites.get(root);
  }
  resultLoans(node) { return node ? this.provenance.get(node) ?? [] : []; }
  attach(destination, roots, node, source = null, result = null) {
    if (destination == null || !roots.length) return;
    this.references.set(destination, [...roots]);
    const ids = result ?? (source == null ? this.resultLoans(node) : this.authority(source));
    for (const loan of this.loans) if (!this.constructing.has(destination) && !ids.includes(loan.id)) {
      loan.borrowers = loan.borrowers.filter(slot => slot !== destination);
      if (loan.borrower != null && !loan.borrowers.length && !loan.callFrame) loan.until = -Infinity;
    }
    this.authorities.set(destination, [...new Set(ids.flatMap(id => {
      const loan = this.loans.find(loan => loan.id === id);
      return [id, ...(loan?.parents ?? [])];
    }))]);
    for (const loan of this.loans) if (ids.includes(loan.id)) {
      loan.until = Math.max(loan.until, this.lastUse.get(destination) ?? node.span.end);
      loan.borrowers = [...new Set([...(loan.borrowers ?? []), destination])];
      if (loan.borrower == null) loan.borrower = destination;
    }
  }
  /** Computing an address is not a read of its entire base aggregate. Only
   * pointer operands and index expressions are values. This distinction is what
   * permits accessing or initializing a sibling of a moved/borrowed field. */
  evaluatePlace(node) {
    if (!node) return;
    if (node.kind === 'variable') return;
    if (node.kind === 'field' || node.kind === 'index') {
      if (node.autoDeref) this.pointer(node.object);
      else if (this.roots(node.object).length) this.evaluatePlace(node.object);
      else this.value(node.object, false);
      if (node.index) this.value(node.index);
    } else if (node.kind === 'unary' && node.op === '*') this.pointer(node.value);
  }
  pointer(node) {
    if (node.kind === 'variable') this.access(node, 'read');
    else this.value(node, false);
  }
  indirect(node) {
    if (!node) return false;
    if (node.kind === 'unary' && node.op === '*' || node.autoDeref) return true;
    return ['field', 'index'].includes(node.kind) && this.indirect(node.object);
  }
  indexed(node) { return node?.kind === 'index' || node?.kind === 'field' && this.indexed(node.object); }
  initialize(place) { for (const moved of this.moved) if (this.places.contains(place, moved)) this.moved.delete(moved); }
  conflicts(loan, mode) {
    if (mode === 'read') return loan.mutable && !loan.reserved;
    if (mode === 'reserve mutably') return loan.mutable;
    return true;
  }
  referenceAccess(node, mode = 'read') {
    this.expire(node);
    for (const root of this.referenceRoots(node)) {
      const conflict = this.loans.find(loan => this.places.overlaps(loan.root, root) && !this.permitted(loan, node.binding ? node.binding.slot : this.resultLoans(node)) &&
        this.conflicts(loan, mode));
      if (conflict) throw new Diagnostic('E0502', `Cannot ${mode} through a reference while its referent is borrowed`, node.span,
        [{message:'Conflicting loan starts here', span:conflict.span}]);
    }
  }
  referenceBase(node) {
    if (node.kind === 'unary' && node.op === '*') return node.value.binding?.slot ?? this.resultLoans(node.value);
    if (node.kind === 'field' || node.kind === 'index') return node.autoDeref ? node.object.binding?.slot ?? this.resultLoans(node.object) : this.referenceBase(node.object);
    return null;
  }
  access(node, mode = 'read', via = null) {
    this.expire(node);
    for (const root of this.roots(node)) {
      if ([...this.moved].some(moved => this.places.overlaps(root, moved)))
        throw new Diagnostic('E0382', `Use of moved or partially moved value '${this.places.name(root)}'`, node.span);
      const conflict = this.loans.find(loan => this.places.overlaps(loan.root, root) && !this.permitted(loan, via) && this.conflicts(loan, mode));
      if (conflict) throw new Diagnostic(mode === 'read' ? 'E0503' : 'E0502', `Cannot ${mode} '${this.places.name(root)}' while it is borrowed`, node.span,
        [{message: 'Loan starts here', span: conflict.span}]);
      if (mode === 'move') { this.moved.add(root); this.event('move', node, root); }
    }
  }
  value(node, consume = true, destination = null) {
    if (destination != null) this.pendingDestinations.push(destination);
    try {
      const roots = this.evaluateValue(node, consume, destination);
      if (node) this.valueOrigins.set(node, roots);
      if (destination != null && roots.length) this.attach(destination, roots, node);
      return roots;
    } finally { if (destination != null) this.pendingDestinations.pop(); }
  }
  evaluateValue(node, consume = true, destination = null) {
    if (!node) return [];
    this.expire(node);
    if (node.kind === 'literal' || node.kind === 'constValue' || node.kind === 'functionItem') return [];
    if (node.kind === 'closure') {
      const roots = [], ids = [];
      const alreadyConstructing = this.constructing.has(destination);
      if (destination != null) this.constructing.add(destination);
      try {
        for (const field of node.fields) {
          roots.push(...this.value(field.value, true, destination)); ids.push(...this.resultLoans(field.value));
        }
      } finally { if (!alreadyConstructing) this.constructing.delete(destination); }
      this.provenance.set(node, [...new Set(ids)]);
      return [...new Set(roots)];
    }
    if (node.kind === 'variable') {
      if (node.constant || node.variant) return [];
      this.access(node, consume && !node.copy ? 'move' : 'read');
      const roots = this.referenceRoots(node);
      if (T.reference(node.type)) this.referenceAccess(node, consume && !node.copy ? 'move' : 'read');
      this.provenance.set(node, [...this.authority(node.binding?.slot)]);
      return roots;
    }
    if (node.kind === 'unary' && node.op === '&') {
      this.evaluatePlace(node.value);
      const roots = this.roots(node.value), via = this.referenceBase(node.value);
      if (this.indirect(node.value) && !roots.length) throw new Diagnostic('F_REBORROW_REFERENCE',
        'A reborrow requires a tracked local or parameter reference origin', node.span);
      const reserved = !!(node.implicitReceiverBorrow || node.implicitReceiverReborrow || node.implicitArgumentReborrow) && node.mutable;
      const mode = reserved ? 'reserve mutably' : node.mutable ? 'borrow mutably' : 'read';
      this.access(node.value, mode, via);
      const parents = [...this.authority(via)];
      for (const root of roots) {
        const id = this.loanId(node, root);
        this.loans.push({id, root, mutable: node.mutable, reserved, borrower: destination,
          borrowers: destination == null ? [] : [destination], parents, via,
          callFrame: destination == null ? this.callFrame : null,
          until: destination == null ? this.callFrame?.end ?? node.span.end : this.lastUse.get(destination) ?? node.span.end,
          span: node.span});
        this.event(node.implicitArgumentReborrow ? reserved ? 'reserve mutable argument' : 'shared argument reborrow' : node.implicitReceiverReborrow ? reserved ? 'reserve mutable reborrow' : 'shared reborrow' :
          reserved ? 'reserve mutable loan' : node.mutable ? 'mutable loan' : 'shared loan', node, root);
      }
      this.provenance.set(node, [...new Set([...parents, ...roots.map(root => this.loanId(node, root))])]);
      return roots;
    }
    if (node.kind === 'unary' && node.op === '*') {
      this.evaluatePlace(node);
      if (consume && !node.copy) throw new Diagnostic('E0507', 'Moving a non-Copy value out of a reference is not allowed', node.span);
      this.access(node, 'read', this.referenceBase(node));
      if (BorrowContract.reference(node.type)) {
        // Reading a Copy reference from pointer storage transfers its own
        // referent/lineage, not the temporary borrow of that storage.
        const storage = this.roots(node);
        const roots = storage.flatMap(id => this.references.get(id) ??
          (this.places.get(id).external ? [this.places.pointee(id, node)] : []));
        this.provenance.set(node, [...new Set(storage.flatMap(id => this.authority(id)))]);
        return [...new Set(roots)];
      }
      return [];
    }
    // Rust comparison operators borrow both operands, including owned strings.
    if (node.kind === 'binary' && ['==', '!=', '<', '>', '<=', '>='].includes(node.op)) {
      this.value(node.left, false); this.value(node.right, false); return [];
    }
    if (node.kind === 'field' || node.kind === 'index') {
      this.evaluatePlace(node);
      const mode = consume && !node.copy ? 'move' : 'read';
      if (mode === 'move') {
        if (this.indirect(node)) throw new Diagnostic('E0507', 'Cannot move a field out of a borrowed value', node.span);
        if (this.indexed(node)) throw new Diagnostic('E0508', 'Cannot move a non-Copy value out of an indexed collection', node.span);
      }
      this.access(node, mode, this.referenceBase(node));
      return [];
    }
    if (node.kind === 'block') return this.block(node);
    if (node.kind === 'assign') { this.assignment(node); return []; }
    if (node.kind === 'return') { this.returnValue(node.value, node); return []; }
    if (node.kind === 'break') {
      const roots = this.value(node.value);
      const frame = this.controls.findLast(frame => frame.id === node.controlTarget);
      frame?.roots.push(...roots); frame?.resultLoans?.push(...this.resultLoans(node.value));
      if (frame?.flow) frame.breaks.push(frame.flow.save());
      return [];
    }
    if (node.kind === 'continue') {
      const frame = this.controls.findLast(frame => frame.id === node.controlTarget);
      if (frame?.flow) frame.continues.push(frame.flow.save());
      return [];
    }
    if (node.kind === 'ifChain' || node.kind === 'whileChain') return ConditionOwnership.analyze(this, node);
    if (['ifExpr', 'ifLet', 'match', 'loopExpr', 'labelBlock', 'while', 'whileLet', 'for'].includes(node.kind) ||
        node.kind === 'binary' && ['&&', '||'].includes(node.op)) return OwnershipFlow.analyze(this, node);
    if (node.kind === 'intrinsic' || node.kind === 'call') return this.callValue(node);
    if (node.kind === 'structLiteral') { node.fields.forEach(f => this.value(f.value)); return []; }
    if (node.items) { node.items.forEach(item => this.value(item)); return []; }
    if (node.left) this.value(node.left);
    if (node.right) this.value(node.right);
    if (node.value) return this.value(node.value, consume, destination);
    return [];
  }
  callValue(node) {
    // Call-scoped reborrows cover argument evaluation and invocation. Only the
    // signature's returned-reference dependencies survive the call. Nested
    // calls cannot release an enclosing reservation; compiler-inserted receiver
    // and argument reborrows reserve/activate, while explicit &mut is immediate.
    const previous = this.callFrame, frame = {end:node.span.end, protected: new Set()}, argumentsOrigins = [], argumentsLoans = [], retained = new Set();
    this.activeCalls.push(frame);
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
        const resultLoans = this.resultLoans(arg);
        argumentsOrigins.push(roots); argumentsLoans.push(resultLoans);
        for (const loan of this.loans)
          if (roots.some(root => this.places.overlaps(root, loan.root)) &&
              (resultLoans.includes(loan.id) || loan.borrower == null))
            { loan.until = Math.max(loan.until, frame.end); frame.protected.add(loan.id); }
      }
      this.expire(node, true);
      for (const loan of this.loans) if (loan.callFrame === frame && loan.reserved) {
        const conflict = this.loans.find(other => other !== loan && this.places.overlaps(other.root, loan.root) &&
          !loan.parents.includes(other.id));
        if (conflict) throw new Diagnostic('E0502', 'Cannot activate an implicit mutable borrow while its referent is borrowed', node.span,
          [{message:'Conflicting loan starts here', span:conflict.span}]);
        loan.reserved = false;
        this.event(node.receiverBorrow || node.receiverReborrow ? 'activate mutable receiver' : 'activate mutable argument', node, loan.root);
      }
      if (BorrowContract.reference(node.type)) {
        const contract = node.referenceContract ?? (name === 'dbg' ? {sources: [0]} : null);
        if (!contract) throw new Diagnostic('F_BORROW_CONTRACT', 'A reference-returning call needs a checked signature contract', node.span);
        BorrowContract.validate(contract, node);
        const roots = [...new Set(contract.sources.flatMap(i => argumentsOrigins[i] ?? []))];
        if (!roots.length) throw new Diagnostic('F_BORROW_ORIGIN', 'Cannot retain a returned reference without tracked argument origins', node.span);
        for (const i of contract.sources) for (const id of argumentsLoans[i] ?? []) retained.add(id);
        this.provenance.set(node, [...retained]);
        for (const root of roots) this.event('retain returned reference', node, root);
        return roots;
      }
      return [];
    } finally {
      this.loans = this.loans.flatMap(loan => loan.callFrame !== frame ? [loan] : retained.has(loan.id)
        ? [{...loan, callFrame: previous, until: previous?.end ?? node.span.end}] : []);
      this.callFrame = previous; this.activeCalls.pop();
    }
  }
  block(block) {
    for (const node of block.body) {
      this.expire(node);
      if (node.kind === 'let') {
        if (node.otherwise) {
          // Evaluate the initializer once before the pattern test. The else
          // branch diverges and must not erase loans on the successful edge.
          const flow = new OwnershipFlow(this, node);
          this.value(node.value, false, node.binding?.slot);
          const success = flow.save(); this.block(node.otherwise); flow.load(success);
          if (!node.value.copy) {
            if (this.indirect(node.value)) throw new Diagnostic('E0507', 'Cannot move a non-Copy binding out of a reference', node.value.span);
            if (this.indexed(node.value)) throw new Diagnostic('E0508', 'Cannot move a non-Copy indexed binding', node.value.span);
            this.access(node.value, 'move');
            if (T.reference(node.value.type) && node.value.binding) this.referenceAccess(node.value, 'move');
          }
        } else this.value(node.value, true, node.binding?.slot);
        if (node.binding) { this.initialize(node.binding.slot); this.event('initialize', node, node.binding.slot, node.binding.type); }
      } else if (node.kind === 'assign') this.assignment(node);
      else if (['return', 'break', 'continue', 'while', 'whileLet', 'whileChain', 'for'].includes(node.kind)) this.value(node);
      else if (node.value) this.value(node.value);
      if (node.type === '!') return [];
    }
    const roots = this.value(block.tail);
    this.provenance.set(block, [...this.resultLoans(block.tail)]);
    if (block === this.instance.fn.body) this.checkReturn(block.tail, roots, block.tail ?? block);
    else {
      const locals = new Set(this.instance.locals.filter(local => local.span &&
        local.span.start >= block.span.start && local.span.end <= block.span.end).map(local => local.slot));
      const expires = root => !this.places.get(root).external && locals.has(this.places.local(root));
      if (roots.some(expires)) throw new Diagnostic('E0597', 'A block-local referent does not outlive the block result', block.span);
      const after = this.liveness.after(block);
      for (const [slot, targets] of this.references) if (!locals.has(slot) && targets.some(expires) &&
          after && this.liveness.has(after, slot))
        throw new Diagnostic('E0597', 'A block-local referent escapes through an outer reference', block.span);
    }
    return roots;
  }
  checkReturn(value, roots, origin) {
    if ((T.reference(value?.type) && value?.type !== '&str' || value?.borrowCarrier) && roots.some(root => value?.borrowCarrier || !this.places.get(root).external))
      throw new Diagnostic('E0515', 'Cannot return a reference to a local value', origin.span);
    if (BorrowContract.reference(value?.type)) {
      const contract = this.instance.referenceContract;
      BorrowContract.validate(contract, origin);
      if (!contract || !roots.length) throw new Diagnostic('F_BORROW_ORIGIN', 'A returned reference needs a tracked input origin', origin.span);
      const allowed = new Set(contract.sources.map(i => this.instance.fn.params[i].binding.slot));
      if (roots.some(root => !allowed.has(this.places.local(root))))
        throw new Diagnostic('E0623', 'Returned reference is not derived from the input lifetime required by this signature', origin.span);
    }
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
    // The destination definition occurs after address evaluation. Its newly
    // attached loan must survive the pre-definition liveness point of the write.
    if (destination != null) this.pendingDestinations.push(destination);
    try { this.value(node.value, true, destination); this.writePlace(node.target, node); }
    finally { if (destination != null) this.pendingDestinations.pop(); }
  }
  writePlace(target, assignment) {
    const node = {target, op: assignment.op, span: target.span};
    this.evaluatePlace(target);
    const roots = this.roots(target), previouslyMoved = new Set(this.moved);
    if (node.op === '=') for (const root of roots) this.initialize(root);
    try { this.access(target, 'mutate', this.referenceBase(target)); }
    catch (error) { this.moved = previouslyMoved; throw error; }
    roots.forEach(root => this.event('assign', node, root));
  }

}
