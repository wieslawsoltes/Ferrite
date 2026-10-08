import {Runtime} from './Runtime.js';

/** Instruction-level execution, with explicit call frames and a bounded trace. */
export class MirVirtualMachine {
  constructor(functions, {entry = 'main<>', args = [], ...options} = {}) {
    this.functions = new Map(functions.map(fn => [fn.instance, fn]));
    this.runtime = new Runtime(options); this.frames = []; this.done = false; this.result = null;
    this.last = null; this.trace = []; this.maxTrace = options.maxTrace ?? 2000;
    if (entry) this.push(entry, args, null); else this.done = true;
  }
  push(name, args, returnTo) {
    const fn = this.functions.get(name);
    if (!fn) this.runtime.fail(`Unknown function ${name}`);
    this.runtime.enter();
    const cells = this.runtime.cells(fn.registers.length);
    fn.params.forEach((slot, i) => { cells[slot].value = args[i]; });
    this.frames.push({fn, cells, blocks: new Map(fn.blocks.map(block => [block.id, block])), block: fn.entry, ip: 0, returnTo});
  }
  reference(frame, place) {
    return this.runtime.reference(frame.cells, place.slot, place.path.map(part => part.kind === 'index' ? {...part, value: frame.cells[part.register].value} : part));
  }
  evaluate(instruction, frame) {
    const r = this.runtime, cells = frame.cells, value = slot => cells[slot].value;
    switch (instruction.op) {
      case 'const': return r.literal(instruction.value, instruction.type);
      case 'read': return r.read(this.reference(frame, instruction.place), instruction.copy);
      case 'borrow': return this.reference(frame, instruction.place);
      case 'write': r.write(this.reference(frame, instruction.place), value(instruction.value)); return null;
      case 'copy': cells[instruction.target].value = instruction.copy ? r.clone(value(instruction.value)) : value(instruction.value); return null;
      case 'binary': return r.binary(instruction.operator, value(instruction.left), value(instruction.right), instruction.operandType);
      case 'unary': return r.unary(instruction.operator, value(instruction.value), instruction.type);
      case 'cast': return r.cast(value(instruction.value), instruction.targetType);
      case 'aggregate': return r.aggregate(instruction.form, instruction.values.map(value), instruction.names, instruction.tag);
      case 'repeat': return Array.from({length: instruction.count}, () => r.clone(value(instruction.value)));
      case 'get': return r.get(value(instruction.value), instruction.index == null ? instruction.field : value(instruction.index), instruction.index != null, instruction.deref, instruction.copy);
      case 'tag': return value(instruction.value).tag;
      case 'payload': return value(instruction.value).values[instruction.index];
      case 'builtin': return r.builtin(instruction.name, instruction.args.map(value), {
        format: instruction.format,
        receiver: instruction.receiverPlace ? this.reference(frame, instruction.receiverPlace) : instruction.receiver == null ? null : value(instruction.receiver),
        receiverReference: !!instruction.receiverPlace, receiverDeref: !!instruction.receiverDeref});
      default: return r.fail(`Unknown MIR operation ${instruction.op}`);
    }
  }
  step() {
    if (this.done) return this.snapshot();
    const frame = this.frames.at(-1), block = frame.blocks.get(frame.block);
    const instruction = block.instructions[frame.ip++];
    if (instruction) {
      this.runtime.tick(instruction.span);
      this.last = {function: frame.fn.instance, block: frame.block, instruction: instruction.id, operation: instruction.op, span: instruction.span};
      if (instruction.op === 'call') this.push(instruction.callee, instruction.args.map(slot => frame.cells[slot].value), instruction.dest);
      else {
        const result = this.evaluate(instruction, frame);
        if (instruction.dest != null) frame.cells[instruction.dest].value = result;
      }
    } else {
      const term = block.terminator; this.runtime.tick(term.span);
      this.last = {function: frame.fn.instance, block: frame.block, operation: term.kind, span: term.span};
      if (term.kind === 'return') {
        const value = frame.cells[term.value].value, destination = frame.returnTo;
        this.frames.pop(); this.runtime.leave();
        if (!this.frames.length) { this.done = true; this.result = value; }
        else this.frames.at(-1).cells[destination].value = value;
      } else if (term.kind === 'unreachable') this.runtime.fail('Entered an unreachable block');
      else {
        frame.block = term.kind === 'goto' ? term.target : frame.cells[term.condition].value ? term.true : term.false;
        frame.ip = 0;
      }
    }
    if (this.trace.length < this.maxTrace) this.trace.push(this.last);
    return this.snapshot();
  }
  run({breakpoints = [], skipFirst = false} = {}) {
    let first = true;
    while (!this.done) {
      const frame = this.frames.at(-1), block = frame.blocks.get(frame.block);
      const span = (block.instructions[frame.ip] ?? block.terminator).span;
      if ((!first || !skipFirst) && span && breakpoints.some(b => b.file === span.file && b.line === span.line)) break;
      first = false; this.step();
    }
    return this.snapshot();
  }
  snapshot() {
    const r = this.runtime;
    return {done: this.done, steps: r.steps, output: r.output, last: this.last,
      result: this.done ? r.debug(this.result) : null,
      frames: this.frames.map(frame => ({function: frame.fn.instance, block: frame.block,
        locals: frame.fn.registers.map((register, slot) => ({slot, name: register.name, type: register.type,
          value: frame.cells[slot].value === undefined ? '<uninitialized>' : r.debug(frame.cells[slot].value), span: register.span}))}))};
  }
}
