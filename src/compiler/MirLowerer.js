/** Typed register MIR with explicit control flow; this IR is executed, not illustrative AST JSON. */
export class MirLowerer {
  constructor(instance) {
    this.instance = instance;
    this.registers = instance.locals.map(local => ({type: local.type, name: local.name, span: local.span}));
    this.blocks = []; this.loops = []; this.sequence = 0;
    this.current = this.newBlock('entry', instance.fn);
  }
  static lower(semantic) { return semantic.instances.map(instance => new MirLowerer(instance).lower()); }
  newBlock(label, node) {
    const block = {id: `bb${this.blocks.length}`, label, span: node?.span, instructions: [], terminator: null};
    this.blocks.push(block); return block;
  }
  register(type = '()', node = null) {
    const slot = this.registers.length; this.registers.push({type, name: `%${slot}`, span: node?.span}); return slot;
  }
  emit(op, data, node, type = null) {
    const dest = type === null ? null : this.register(type, node);
    if (this.current) this.current.instructions.push({id: `${this.instance.key}:i${this.sequence++}`, op, dest, type,
      ...data, span: node?.span, sourceId: node?.id});
    return dest;
  }
  literal(value, type, node) { return this.emit('const', {value}, node, type); }
  unit(node) { return this.literal(null, '()', node); }
  terminate(kind, data, node) {
    if (this.current) this.current.terminator = {kind, ...data, span: node?.span};
    this.current = null;
  }
  goto(block, node) { this.terminate('goto', {target: block.id}, node); }
  move(dest, value, node, copy = false) { this.emit('copy', {target: dest, value, copy}, node); }
  place(node) {
    if (node.kind === 'variable') return {slot: node.binding.slot, path: []};
    if (node.kind === 'unary' && node.op === '*') return {slot: this.expr(node.value, true), path: [{kind: 'deref'}]};
    if (node.kind === 'field' || node.kind === 'index') {
      const base = node.autoDeref ? {slot: this.expr(node.object, true), path: [{kind: 'deref'}]} : this.place(node.object);
      base.path.push(node.kind === 'field' ? {kind: 'field', name: node.field} : {kind: 'index', register: this.expr(node.index)});
      return base;
    }
    throw new Error(`Cannot lower place ${node.kind}`);
  }
  branch(condition, yes, no, node, kind = 'branch') {
    this.terminate(kind, {condition, true: yes.id, false: no.id}, node);
  }
  conditional(condition, whenTrue, whenFalse, node, type = node.type) {
    const yes = this.newBlock('then', node), no = this.newBlock('else', node), done = this.newBlock('merge', node);
    const result = this.register(type, node);
    this.branch(condition, yes, no, node);
    this.current = yes; const a = whenTrue(); const yesOpen = !!this.current;
    if (this.current) { this.move(result, a, node); this.goto(done, node); }
    this.current = no; const b = whenFalse(); const noOpen = !!this.current;
    if (this.current) { this.move(result, b, node); this.goto(done, node); }
    if (yesOpen || noOpen) this.current = done;
    else { done.terminator = {kind: 'unreachable', span: node.span}; this.current = null; }
    return result;
  }
  bind(pattern, value, node = pattern) {
    if (pattern.binding) this.emit('write', {place: {slot: pattern.binding.slot, path: []}, value}, node);
    if (pattern.kind === 'tuplePattern') pattern.items.forEach((p, i) => this.bind(p,
      this.emit('get', {value, field: String(i), index: null, deref: false, copy: false}, p, p.type)));
    if (pattern.kind === 'variantPattern') pattern.items.forEach((p, i) => this.bind(p,
      this.emit('payload', {value, index: i}, p, p.type)));
  }
  patternTest(pattern, value) {
    if (pattern.kind === 'wildcard' || pattern.kind === 'bindingPattern') return this.literal(true, 'bool', pattern);
    if (pattern.kind === 'literal') {
      const literal = this.literal(pattern.value, pattern.type, pattern);
      return this.emit('binary', {operator: '==', left: value, right: literal, operandType: pattern.type}, pattern, 'bool');
    }
    if (pattern.kind === 'tuplePattern') {
      let result = this.literal(true, 'bool', pattern);
      pattern.items.forEach((p, i) => {
        result = this.conditional(result, () => this.patternTest(p, this.emit('get', {value, field: String(i), index: null}, p, p.type)),
          () => this.literal(false, 'bool', p), p, 'bool');
      });
      return result;
    }
    const tag = this.emit('tag', {value}, pattern, '&str'), expected = this.literal(pattern.variant, '&str', pattern);
    let result = this.emit('binary', {operator: '==', left: tag, right: expected, operandType: '&str'}, pattern, 'bool');
    for (let i = 0; i < pattern.items.length; i++) {
      const p = pattern.items[i];
      result = this.conditional(result, () => this.patternTest(p, this.emit('payload', {value, index: i}, p, p.type)),
        () => this.literal(false, 'bool', p), p, 'bool');
    }
    return result;
  }
  expr(node, borrowed = false) {
    if (!node) return this.unit(node);
    if (node.variant) {
      return this.emit('aggregate', {form: 'enum', values: (node.args ?? []).map(n => this.expr(n)), tag: node.variant}, node, node.type);
    }
    switch (node.kind) {
      case 'literal': return this.literal(node.value, node.type, node);
      case 'variable': return node.constant ? this.expr(node.constant) : this.emit('read', {place: this.place(node), copy: !borrowed && node.copy}, node, node.type);
      case 'tuple': case 'array': return this.emit('aggregate', {form: node.kind, values: node.items.map(n => this.expr(n))}, node, node.type);
      case 'repeatArray': return this.emit('repeat', {value: this.expr(node.value), count: node.length}, node, node.type);
      case 'structLiteral': return this.emit('aggregate', {form: 'struct', values: node.fields.map(f => this.expr(f.value)), names: node.fields.map(f => f.name)}, node, node.type);
      case 'field': case 'index': return this.emit('get', {value: this.expr(node.object, true), field: node.field,
        index: node.index ? this.expr(node.index) : null, deref: !!node.autoDeref, copy: !borrowed && node.copy}, node, node.type);
      case 'unary': {
        if (node.op === '&') return this.emit('borrow', {place: this.place(node.value), mutable: node.mutable}, node, node.type);
        if (node.op === '*') return this.emit('read', {place: this.place(node), copy: !borrowed && node.copy}, node, node.type);
        return this.emit('unary', {operator: node.op, value: this.expr(node.value)}, node, node.type);
      }
      case 'binary': {
        const left = this.expr(node.left);
        if (node.op === '&&') return this.conditional(left, () => this.expr(node.right), () => this.literal(false, 'bool', node), node);
        if (node.op === '||') return this.conditional(left, () => this.literal(true, 'bool', node), () => this.expr(node.right), node);
        return this.emit('binary', {operator: node.op, left, right: this.expr(node.right), operandType: node.operandType}, node, node.type);
      }
      case 'cast': return this.emit('cast', {value: this.expr(node.value), targetType: node.target}, node, node.type);
      case 'block': return this.block(node);
      case 'ifLet': {
        const value = this.expr(node.value), condition = this.patternTest(node.pattern, value);
        return this.conditional(condition, () => { this.bind(node.pattern, value); return this.block(node.then); },
          () => node.otherwise ? this.expr(node.otherwise) : this.unit(node), node);
      }
      case 'ifExpr': return this.conditional(this.expr(node.condition), () => this.block(node.then),
        () => node.otherwise ? this.expr(node.otherwise) : this.unit(node), node);
      case 'loopExpr': return this.loopExpression(node);
      case 'match': return this.matchExpression(node);
      case 'try': {
        const value = this.expr(node.value), tag = this.emit('tag', {value}, node, '&str');
        const expected = this.literal(node.family + (node.family === 'Option' ? '::Some' : '::Ok'), '&str', node);
        const condition = this.emit('binary', {operator: '==', left: tag, right: expected, operandType: '&str'}, node, 'bool');
        return this.conditional(condition, () => this.emit('payload', {value, index: 0}, node, node.type), () => {
          this.terminate('return', {value}, node); return value;
        }, node);
      }
      case 'closure': return this.emit('aggregate',{form:'struct',names:node.fields.map(f=>f.name),values:node.fields.map(f=>this.expr(f.value))},node,node.type);
      case 'intrinsic': case 'call': {
        if(node.temporaryCallee){const temporary=node.temporaryCallee;this.emit('write',{place:{slot:temporary.binding.slot,path:[]},value:this.expr(temporary.value)},node);}
        const mutates = ['method::push', 'method::pop', 'method::push_str'].includes(node.builtin);
        const receiverPlace = mutates ? this.place(node.receiver) : null;
        const receiver = node.receiver && !mutates ? this.expr(node.receiver, true) : null;
        const args = node.args.map(arg => this.expr(arg, ['println', 'print', 'format', 'clone', 'assert_eq'].includes(node.builtin)));
        if (node.resolved) return this.emit('call', {callee: node.resolved, args}, node, node.type);
        return this.emit('builtin', {name: node.builtin ?? node.name, args, receiver, receiverPlace,
          receiverDeref: !!node.receiverDeref, format: node.format}, node, node.type);
      }
      default: throw new Error(`Missing MIR lowering for ${node.kind}`);
    }
  }
  matchExpression(node) {
    const value = this.expr(node.value), result = this.register(node.type, node), done = this.newBlock('match merge', node);
    let reaches = false;
    for (const arm of node.arms) {
      const body = this.newBlock('match arm', arm), next = this.newBlock('next pattern', arm);
      const condition = this.patternTest(arm.pattern, value);
      this.branch(condition, body, next, arm); this.current = body; this.bind(arm.pattern, value);
      if (arm.guard) {
        const guarded = this.newBlock('guard satisfied', arm);
        this.branch(this.expr(arm.guard), guarded, next, arm); this.current = guarded;
      }
      const selected = this.expr(arm.body);
      if (this.current) { this.move(result, selected, arm); this.goto(done, arm); reaches = true; }
      this.current = next;
    }
    this.terminate('unreachable', {}, node);
    if (reaches) this.current = done; else done.terminator = {kind: 'unreachable', span: node.span};
    return result;
  }
  whileLet(node) {
    const test = this.newBlock('while-let test', node), body = this.newBlock('pattern matched', node), done = this.newBlock('while-let exit', node);
    this.goto(test, node); this.current = test;
    const value = this.expr(node.value), condition = this.patternTest(node.pattern, value);
    this.branch(condition, body, done, node); this.current = body;
    this.bind(node.pattern, value);
    this.loops.push({break: done, continue: test, result: null, hasBreak: false});
    this.block(node.then); this.loops.pop();
    if (this.current) this.goto(test, node); this.current = done;
  }
  loopExpression(node) {
    const body = this.newBlock('loop', node), done = this.newBlock('loop exit', node), result = this.register(node.type, node);
    this.goto(body, node); this.current = body;
    const frame = {break: done, continue: body, result, hasBreak: false}; this.loops.push(frame);
    this.block(node.then); this.goto(body, node); this.loops.pop();
    if (frame.hasBreak) this.current = done; else done.terminator = {kind: 'unreachable', span: node.span};
    return result;
  }
  whileLoop(node) {
    const test = this.newBlock('while test', node), body = this.newBlock('while body', node), done = this.newBlock('while exit', node);
    this.goto(test, node); this.current = test; this.branch(this.expr(node.condition), body, done, node);
    this.current = body; this.loops.push({break: done, continue: test, result: null});
    this.block(node.then); this.goto(test, node); this.loops.pop(); this.current = done;
  }
  forLoop(node) {
    const from = this.expr(node.from), to = node.to ? this.expr(node.to) : this.emit('builtin', {name: 'method::len', args: [], receiver: from}, node, 'usize');
    const counterType = node.to ? node.from.type : 'usize';
    const counter = this.register(counterType, node);
    this.move(counter, node.to ? from : this.literal('0', 'usize', node), node);
    const test = this.newBlock('range test', node), body = this.newBlock('range body', node), step = this.newBlock('range next', node), done = this.newBlock('range exit', node);
    this.goto(test, node); this.current = test;
    const condition = this.emit('binary', {operator: node.inclusive ? '<=' : '<', left: counter, right: to, operandType: counterType}, node, 'bool');
    this.branch(condition, body, done, node, 'rangeSwitch'); this.current = body;
    const value = node.to ? counter : this.emit('get', {value: from, index: counter, field: null}, node, node.pattern.type);
    this.bind(node.pattern, value); this.loops.push({break: done, continue: step, result: null});
    this.block(node.then); this.goto(step, node); this.loops.pop(); this.current = step;
    if (node.inclusive) {
      const increment = this.newBlock('inclusive increment', node);
      const final = this.emit('binary', {operator: '==', left: counter, right: to, operandType: counterType}, node, 'bool');
      this.branch(final, done, increment, node); this.current = increment;
    }
    const one = this.literal('1', counterType, node);
    const next = this.emit('binary', {operator: '+', left: counter, right: one, operandType: counterType}, node, counterType);
    this.move(counter, next, node); this.goto(test, node); this.current = done;
  }
  statement(node) {
    switch (node.kind) {
      case 'let': this.bind(node.pattern, this.expr(node.value), node); break;
      case 'assign': {
        const place = this.place(node.target);
        let value;
        if (node.op === '=') value = this.expr(node.value);
        else {
          const original = this.emit('read', {place, copy: false}, node.target, node.target.type);
          value = this.emit('binary', {operator: node.op.slice(0, -1), left: original, right: this.expr(node.value), operandType: node.target.type}, node, node.target.type);
        }
        this.emit('write', {place, value}, node); break;
      }
      case 'expression': this.expr(node.value); break;
      case 'return': this.terminate('return', {value: this.expr(node.value)}, node); break;
      case 'break': {
        const frame = this.loops.at(-1); frame.hasBreak = true;
        if (frame.result !== null) this.move(frame.result, this.expr(node.value), node);
        this.goto(frame.break, node); break;
      }
      case 'continue': this.goto(this.loops.at(-1).continue, node); break;
      case 'whileLet': this.whileLet(node); break;
      case 'while': this.whileLoop(node); break;
      case 'for': this.forLoop(node); break;
      default: throw new Error(`Missing statement lowering for ${node.kind}`);
    }
  }
  block(block) {
    for (const statement of block.body) { if (!this.current) break; this.statement(statement); }
    return this.current ? this.expr(block.tail) : null;
  }
  lower() {
    const value = this.block(this.instance.fn.body);
    if (this.current) this.terminate('return', {value}, this.instance.fn.body);
    return {instance: this.instance.key, name: this.instance.name, span: this.instance.fn.span, returnType: this.instance.returnType,
      params: this.instance.fn.params.map(p => p.binding.slot), registers: this.registers,
      entry: 'bb0', blocks: this.blocks};
  }
}
