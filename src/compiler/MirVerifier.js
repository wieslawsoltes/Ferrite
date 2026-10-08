import {Diagnostic} from './Diagnostic.js';

/** Verifies edges, registers and definite initialization before either backend runs. */
export class MirVerifier {
  static successors(block) {
    const term = block.terminator;
    if (!term) return [];
    return term.kind === 'goto' ? [term.target] : ['branch', 'rangeSwitch'].includes(term.kind) ? [term.true, term.false] : [];
  }
  static uses(instruction) {
    const result = [];
    const place = p => { if (!p) return; result.push(p.slot); p.path?.forEach(step => { if (step.kind === 'index') result.push(step.register); }); };
    if (instruction.op === 'write') {
      if (instruction.place.path.length) place(instruction.place);
      result.push(instruction.value);
    } else if (instruction.op === 'borrow' || instruction.op === 'read') place(instruction.place);
    else {
      for (const name of ['value', 'left', 'right', 'receiver']) if (Number.isInteger(instruction[name])) result.push(instruction[name]);
      if (instruction.op === 'get' && Number.isInteger(instruction.index)) result.push(instruction.index);
      for (const value of instruction.args ?? instruction.values ?? []) result.push(value);
      place(instruction.receiverPlace);
    }
    return result;
  }
  static definitions(instruction) {
    const result = instruction.dest == null ? [] : [instruction.dest];
    if (instruction.op === 'copy') result.push(instruction.target);
    if (instruction.op === 'write' && !instruction.place.path.length) result.push(instruction.place.slot);
    return result;
  }
  static verify(functions) {
    const names = new Map(functions.map(fn => [fn.instance, fn]));
    if (names.size !== functions.length) throw new Diagnostic('F_MIR', 'Duplicate MIR function identity');
    for (const fn of functions) this.function(fn, names);
    return {functions: functions.length, blocks: functions.reduce((n, f) => n + f.blocks.length, 0), status: 'verified'};
  }
  static function(fn, names) {
    const map = new Map(fn.blocks.map(block => [block.id, block]));
    const fail = (message, span) => { throw new Diagnostic('F_MIR', `${fn.instance}: ${message}`, span ?? fn.span); };
    if (map.size !== fn.blocks.length || !map.has(fn.entry)) fail('Invalid block identities');
    const operations = new Set(['const', 'read', 'borrow', 'write', 'copy', 'binary', 'unary', 'cast', 'aggregate', 'repeat', 'get', 'tag', 'payload', 'builtin', 'call']);
    const terms = new Set(['goto', 'branch', 'rangeSwitch', 'return', 'unreachable']);
    const register = (slot, span) => {
      if (!Number.isInteger(slot) || slot < 0 || slot >= fn.registers.length) fail(`Invalid register ${slot}`, span);
      return fn.registers[slot];
    };
    if (new Set(fn.params).size !== fn.params.length) fail('Duplicate parameter register');
    fn.params.forEach(slot => register(slot));
    for (const block of fn.blocks) {
      if (!terms.has(block.terminator?.kind)) fail(`Unknown terminator ${block.terminator?.kind}`, block.span);
      for (const target of this.successors(block)) if (!map.has(target)) fail(`Edge to absent block ${target}`, block.span);
      for (const instruction of block.instructions) {
        if (!operations.has(instruction.op)) fail(`Unknown operation ${instruction.op}`, instruction.span);
        const stores = instruction.op === 'copy' || instruction.op === 'write';
        if (!stores && instruction.dest == null) fail(`Missing destination for ${instruction.op}`, instruction.span);
        if (instruction.dest != null) {
          const dest = register(instruction.dest, instruction.span);
          if (dest.type !== instruction.type) fail(`Destination type ${dest.type} differs from instruction type ${instruction.type}`, instruction.span);
        }
        for (const slot of this.definitions(instruction)) register(slot, instruction.span);
        for (const slot of this.uses(instruction)) register(slot, instruction.span);
        if (instruction.op === 'call') {
          const target = names.get(instruction.callee);
          if (!target) fail(`Unresolved call ${instruction.callee}`, instruction.span);
          if (instruction.args.length !== target.params.length) fail(`Argument count mismatch for ${instruction.callee}`, instruction.span);
          if (instruction.type !== target.returnType) fail(`Call result type mismatch for ${instruction.callee}`, instruction.span);
        }
      }
      const term = block.terminator;
      if (term.kind === 'return') {
        const result = register(term.value, term.span);
        if (result.type !== fn.returnType && result.type !== '!') fail(`Return type ${result.type} does not match ${fn.returnType}`, term.span);
      }
    }

    const reachable = new Set(), pending = [fn.entry];
    while (pending.length) {
      const id = pending.pop(); if (reachable.has(id)) continue;
      const block = map.get(id); if (!block) fail(`Edge to absent block ${id}`);
      if (!block.terminator) fail(`Unterminated block ${id}`, block.span);
      reachable.add(id); pending.push(...this.successors(block));
    }
    const predecessors = new Map([...reachable].map(id => [id, []]));
    for (const id of reachable) for (const next of this.successors(map.get(id))) predecessors.get(next).push(id);
    const all = new Set(fn.registers.map((_, i) => i)), inputs = new Map(), outputs = new Map();
    for (const id of reachable) { inputs.set(id, id === fn.entry ? new Set(fn.params) : new Set(all)); outputs.set(id, new Set(all)); }
    let changed = true, count = 0;
    while (changed) {
      if (++count > fn.blocks.length * 4 + 20) fail('Initialization analysis did not converge');
      changed = false;
      for (const id of reachable) {
        const incoming = id === fn.entry ? new Set(fn.params) : new Set(all);
        if (id !== fn.entry) for (const pred of predecessors.get(id)) for (const slot of incoming) if (!outputs.get(pred).has(slot)) incoming.delete(slot);
        const outgoing = new Set(incoming);
        for (const instruction of map.get(id).instructions) this.definitions(instruction).forEach(slot => outgoing.add(slot));
        if ([...outgoing].some(x => !outputs.get(id).has(x)) || outgoing.size !== outputs.get(id).size) changed = true;
        inputs.set(id, incoming); outputs.set(id, outgoing);
      }
    }
    for (const id of reachable) {
      const available = new Set(inputs.get(id)), block = map.get(id);
      const validate = (slot, span) => {
        if (!Number.isInteger(slot) || slot < 0 || slot >= fn.registers.length) fail(`Invalid register ${slot}`, span);
        if (!available.has(slot)) fail(`Register %${slot} may be uninitialized`, span);
      };
      for (const instruction of block.instructions) {
        this.uses(instruction).forEach(slot => validate(slot, instruction.span));
        for (const slot of this.definitions(instruction)) {
          if (slot < 0 || slot >= fn.registers.length) fail(`Invalid destination %${slot}`, instruction.span);
          available.add(slot);
        }
        if (instruction.op === 'call' && !names.has(instruction.callee)) fail(`Unresolved call ${instruction.callee}`, instruction.span);
      }
      const term = block.terminator;
      if (term.kind === 'return') validate(term.value, term.span);
      else if (['branch', 'rangeSwitch'].includes(term.kind)) {
        validate(term.condition, term.span);
        if (fn.registers[term.condition].type !== 'bool') fail('Branch condition is not bool', term.span);
      }
    }
  }
}
