import {ExecutionSnapshot} from './ExecutionSnapshot.js';
import {Runtime} from './Runtime.js';

/** Instruction-level execution, with explicit call frames and a bounded trace. */
export class MirVirtualMachine {
  constructor(functions, {entry = 'main<>', args = [], resolveDiscriminant = null, ...options} = {}) {
    this.resolveDiscriminant = resolveDiscriminant;
    this.functions = new Map(functions.map(fn => [fn.instance, fn]));
    this.blockMaps = new Map(functions.map(fn => [fn.instance, new Map(fn.blocks.map(block => [block.id, block]))]));
    this.runtime = new Runtime(options); this.frames = []; this.done = false; this.result = null;
    this.history = null; this.historyWork = 0;
    this.last = null; this.trace = []; this.maxTrace = options.maxTrace ?? 2000;
    if (entry) this.push(entry, args, null); else this.done = true;
    if (options.history) this.enableHistory(options.history === true ? {} : options.history);
  }
  push(name, args, returnTo) {
    const fn = this.functions.get(name);
    if (!fn) this.runtime.fail(`Unknown function ${name}`);
    this.runtime.enter();
    const cells = this.runtime.cells(fn.registers.length);
    fn.params.forEach((slot, i) => { cells[slot].value = args[i]; });
    this.frames.push({fn, cells, blocks: this.blockMaps.get(name), block: fn.entry, ip: 0, returnTo});
  }
  reference(frame, place) {
    return this.runtime.reference(frame.cells, place.slot, place.path.map(part => part.kind === 'index' ? {...part, value: frame.cells[part.register].value} : part));
  }
  evaluate(instruction, frame) {
    const r = this.runtime, cells = frame.cells, value = slot => cells[slot].value;
    switch (instruction.op) {
      case 'function':return r.functionPointer(instruction.callee,instruction.signature);
      case 'const': return r.literal(instruction.value, instruction.type);
      case 'read': return r.read(this.reference(frame, instruction.place), instruction.copy);
      case 'borrow': return this.reference(frame, instruction.place);
      case 'write': r.write(this.reference(frame, instruction.place), value(instruction.value)); return null;
      case 'copy': cells[instruction.target].value = instruction.copy ? r.clone(value(instruction.value)) : value(instruction.value); return null;
      case 'binary': return r.binary(instruction.operator, value(instruction.left), value(instruction.right), instruction.operandType);
      case 'unary': return r.unary(instruction.operator, value(instruction.value), instruction.type);
      case 'discriminant': return instruction.table === null && this.resolveDiscriminant
        ? this.resolveDiscriminant(instruction.enumName, value(instruction.value).tag)
        : r.discriminant(value(instruction.value), instruction.table);
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
  enableHistory({maxSnapshots = 256, maxBytes = 16 * 1024 * 1024, captureExternal = null, restoreExternal = null} = {}) {
    if (!Number.isInteger(maxSnapshots) || maxSnapshots < 1 || maxSnapshots > 4096 || !Number.isInteger(maxBytes) || maxBytes < 1024 || maxBytes > 128 * 1024 * 1024)
      throw Error('Invalid execution history limits');
    if ((captureExternal !== null && typeof captureExternal !== 'function') || (restoreExternal !== null && typeof restoreExternal !== 'function') || !!captureExternal !== !!restoreExternal)
      throw Error('Execution history requires paired external snapshot callbacks');
    this.history = {past: [], bytes: 0, maxSnapshots, maxBytes, captureExternal, restoreExternal, dropped: 0, boundary: 'Start of execution', epoch: 0};
    return this;
  }
  historyInfo() {
    const h = this.history;
    return h ? {available: h.past.length, bytes: h.bytes, dropped: h.dropped, boundary: h.boundary, work: this.historyWork} : null;
  }
  historyBarrier(reason = 'Irreversible host effect') {
    const h = this.history; if (!h) return;
    h.past = []; h.bytes = 0; h.epoch++; h.boundary = String(reason).slice(0, 500);
  }
  captureExecution() {
    const r = this.runtime, h = this.history;
    return new ExecutionSnapshot({frames: this.frames.map(f => ({instance: f.fn.instance, cells: f.cells, block: f.block, ip: f.ip, returnTo: f.returnTo})),
      done: this.done, result: this.result, last: this.last, trace: this.trace,
      runtime: {steps: r.steps, depth: r.depth, output: r.output, span: r.span}, external: h.captureExternal?.()},
      {maxBytes: h.maxBytes});
  }
  stepBack() {
    const h = this.history, point = h?.past.at(-1);
    if (!point) throw Object.assign(Error(h?.boundary ?? 'Execution history is not enabled'), {code: 'R_HISTORY_BOUNDARY'});
    const state = point.restore();
    h.restoreExternal?.(state.external);
    this.frames = state.frames.map(f => ({...f, fn: this.functions.get(f.instance), blocks: this.blockMaps.get(f.instance)}));
    this.done = state.done; this.result = state.result; this.last = state.last; this.trace = state.trace;
    Object.assign(this.runtime, state.runtime); h.past.pop(); h.bytes -= point.bytes;
    return this.snapshot();
  }
  stepBackLine() {
    const initial = this.nextSpan() ?? this.last?.span;
    do { this.stepBack(); }
    while (this.history.past.length && this.nextSpan()?.file === initial?.file && this.nextSpan()?.line === initial?.line);
    return this.snapshot();
  }
  step({capture = true} = {}) {
    const h = this.history;
    if (!h || this.done) return this.executeStep({capture});
    // Work is monotonic: rewinding cannot refund a hostile program's execution budget.
    if (++this.historyWork > this.runtime.maxSteps * 4) this.runtime.fail('Reversible execution work budget exceeded', 'R_BUDGET');
    const epoch = h.epoch, point = this.captureExecution();
    let result;
    try { result = this.executeStep({capture: false}); }
    finally {
      if (epoch === h.epoch) {
        h.past.push(point); h.bytes += point.bytes;
        while (h.past.length > h.maxSnapshots || h.bytes > h.maxBytes) {
          h.bytes -= h.past.shift().bytes; h.dropped++; h.boundary = 'Oldest retained execution snapshot';
        }
      }
    }
    return capture ? this.snapshot() : result;
  }
  executeStep({capture = true} = {}) {
    if (this.done) return this.snapshot();
    const frame = this.frames.at(-1), block = frame.blocks.get(frame.block);
    const instruction = block.instructions[frame.ip++];
    if (instruction) {
      this.runtime.tick(instruction.span);
      this.last = {function: frame.fn.instance, block: frame.block, instruction: instruction.id, operation: instruction.op, span: instruction.span};
      if(instruction.op==='callIndirect')this.push(this.runtime.functionTarget(frame.cells[instruction.value].value,instruction.signature),instruction.args.map(slot=>frame.cells[slot].value),instruction.dest);
      else if (instruction.op === 'call') this.push(instruction.callee, instruction.args.map(slot => frame.cells[slot].value), instruction.dest);
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
    return capture ? this.snapshot() : null;
  }
  run({breakpoints = [], skipFirst = false} = {}) {
    let first = true;
    const initial = this.nextSpan();
    let leavingInitialLine = skipFirst;
    while (!this.done) {
      const frame = this.frames.at(-1), block = frame.blocks.get(frame.block);
      const span = (block.instructions[frame.ip] ?? block.terminator).span;
      if (leavingInitialLine && (!span || span.file !== initial?.file || span.line !== initial?.line)) leavingInitialLine = false;
      if (!leavingInitialLine && (!first || !skipFirst) && span && breakpoints.some(b => b.file === span.file && b.line === span.line)) break;
      first = false; this.step({capture: false});
    }
    return this.snapshot();
  }
  nextSpan() {
    const frame = this.frames.at(-1);
    if (!frame) return null;
    const block = frame.blocks.get(frame.block);
    return (block.instructions[frame.ip] ?? block.terminator).span;
  }
  stepLine() {
    const initial = this.nextSpan(), depth = this.frames.length;
    do { this.step({capture: false}); }
    while (!this.done && this.frames.length >= depth && this.nextSpan()?.file === initial?.file && this.nextSpan()?.line === initial?.line);
    return this.snapshot();
  }
  snapshot() {
    const r = this.runtime;
    return {done: this.done, history: this.historyInfo(), steps: r.steps, output: r.output, last: this.last, next: this.nextSpan(),
      result: this.done ? r.debug(this.result) : null,
      frames: this.frames.map(frame => ({function: frame.fn.instance, block: frame.block,
        locals: frame.fn.registers.map((register, slot) => ({slot, name: register.name, type: register.type,
          value: frame.cells[slot].value === undefined ? '<uninitialized>' : r.debug(frame.cells[slot].value), span: register.span}))}))};
  }
}
