import {TypeSystem as T} from './TypeSystem.js';
import {Diagnostic} from './Diagnostic.js';

/** Verifies edges, registers and definite initialization before either backend runs. */
export class MirVerifier {
  static argumentType(expected, actual) {
    // A call may reborrow &mut T as &T, but cannot change the function
    // pointer's stored signature or recursively weaken pointee types.
    return expected === actual || actual === '!' ||
      expected.startsWith('&') && !expected.startsWith('&mut ') && actual === '&mut ' + expected.slice(1);
  }
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
  static verify(functions, {allowDeferredDiscriminants = false} = {}) {
    const names = new Map(functions.map(fn => [fn.instance, fn]));
    if (names.size !== functions.length) throw new Diagnostic('F_MIR', 'Duplicate MIR function identity');
    for (const fn of functions) this.function(fn, names, {allowDeferredDiscriminants});
    return {functions: functions.length, blocks: functions.reduce((n, f) => n + f.blocks.length, 0), status: 'verified'};
  }
  static function(fn, names, {allowDeferredDiscriminants = false} = {}) {
    const map = new Map(fn.blocks.map(block => [block.id, block]));
    const fail = (message, span) => { throw new Diagnostic('F_MIR', `${fn.instance}: ${message}`, span ?? fn.span); };
    if (map.size !== fn.blocks.length || !map.has(fn.entry)) fail('Invalid block identities');
    const operations = new Set(['const', 'read', 'borrow', 'write', 'copy', 'binary', 'unary', 'cast', 'aggregate', 'repeat', 'get', 'tag', 'payload', 'discriminant', 'builtin', 'call', 'function', 'callIndirect']);
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
        if (instruction.op === 'function' || instruction.op === 'callIndirect') {
          const signature=T.function(instruction.signature);
          if(!signature)fail('Invalid callable signature',instruction.span);
          if(instruction.op==='function'){
            const target=names.get(instruction.callee);
            if(!target||target.params.length!==signature.params.length||target.returnType!==signature.result||
                target.params.some((slot,i)=>target.registers[slot].type!==signature.params[i])||instruction.type!==instruction.signature)
              fail('Function pointer target/signature mismatch',instruction.span);
          }else{
            if(register(instruction.value,instruction.span).type!==instruction.signature||!Array.isArray(instruction.args)||
                instruction.args.length!==signature.params.length||instruction.type!==signature.result||
                instruction.args.some((slot,i)=>!this.argumentType(signature.params[i],register(slot,instruction.span).type)))
              fail('Indirect call signature mismatch',instruction.span);
          }
        }
        if (instruction.op === 'discriminant') {
          if (!T.integer(instruction.type) || typeof instruction.enumName !== 'string' || !instruction.enumName ||
              T.application(register(instruction.value).type).name !== instruction.enumName) fail('Invalid enum discriminant types', instruction.span);
          const table = instruction.table;
          if (!(table === null && allowDeferredDiscriminants)) {
            if (!table || typeof table !== 'object' || Array.isArray(table)) fail('Unresolved enum discriminants', instruction.span);
            const bits = instruction.type.endsWith('size') ? 32 : Number(instruction.type.slice(1));
            const signed = instruction.type[0] === 'i', min = signed ? -(1n << BigInt(bits - 1)) : 0n, max = (1n << BigInt(bits - Number(signed))) - 1n;
            for (const [tag, value] of Object.entries(table)) {
              if (!tag.startsWith(instruction.enumName + '::') || typeof value !== 'string' || !/^-?\d+$/.test(value) || value.length > 40 ||
                  BigInt(value) < min || BigInt(value) > max) fail('Invalid enum discriminant table', instruction.span);
            }
          }
        }
        if (instruction.op === 'call') {
          const target = names.get(instruction.callee);
          if (!target) fail(`Unresolved call ${instruction.callee}`, instruction.span);
          if (instruction.args.length !== target.params.length) fail(`Argument count mismatch for ${instruction.callee}`, instruction.span);
          if (instruction.args.some((slot, i) => !this.argumentType(target.registers[target.params[i]].type, register(slot, instruction.span).type)))
            fail(`Argument type mismatch for ${instruction.callee}`, instruction.span);
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
    // Definite initialization is a descending must-analysis. Start non-entry
    // outputs at TOP, meet predecessor outputs, then add the block's definitions.
    // A word-packed mask replaces one boxed Set entry per register per block.
    // Only a changed output schedules successors; cycles need no arbitrary cap.
    const words = Math.ceil(fn.registers.length / 32);
    const top = new Uint32Array(words).fill(0xffffffff);
    if (fn.registers.length % 32) top[words - 1] = 2 ** (fn.registers.length % 32) - 1;
    const params = new Uint32Array(words);
    for (const slot of fn.params) params[slot >>> 5] |= 1 << (slot & 31);
    const outputs = new Map(), definitions = new Map();
    for (const id of reachable) {
      outputs.set(id, top.slice());
      const generated = new Uint32Array(words);
      for (const instruction of map.get(id).instructions)
        for (const slot of this.definitions(instruction)) generated[slot >>> 5] |= 1 << (slot & 31);
      definitions.set(id, generated);
    }
    const incoming = new Uint32Array(words);
    const meet = id => {
      incoming.set(id === fn.entry ? params : top);
      if (id !== fn.entry) for (const pred of predecessors.get(id)) {
        const output = outputs.get(pred);
        for (let word = 0; word < words; word++) incoming[word] &= output[word];
      }
    };
    // Reverse the DFS insertion order so the entry is processed first on pop.
    const work = [...reachable].reverse(), queued = new Set(work);
    while (work.length) {
      const id = work.pop(); queued.delete(id); meet(id);
      const output = outputs.get(id), generated = definitions.get(id);
      let changed = false;
      for (let word = 0; word < words; word++) {
        const value = (incoming[word] | generated[word]) >>> 0;
        if (output[word] !== value) { output[word] = value; changed = true; }
      }
      if (changed) for (const next of this.successors(map.get(id))) {
        if (!queued.has(next)) { queued.add(next); work.push(next); }
      }
    }
    for (const id of reachable) {
      meet(id);
      const available = incoming, block = map.get(id);
      const validate = (slot, span) => {
        if (!Number.isInteger(slot) || slot < 0 || slot >= fn.registers.length) fail(`Invalid register ${slot}`, span);
        if (!(available[slot >>> 5] & (1 << (slot & 31)))) fail(`Register %${slot} may be uninitialized`, span);
      };
      for (const instruction of block.instructions) {
        this.uses(instruction).forEach(slot => validate(slot, instruction.span));
        for (const slot of this.definitions(instruction)) {
          if (slot < 0 || slot >= fn.registers.length) fail(`Invalid destination %${slot}`, instruction.span);
          available[slot >>> 5] |= 1 << (slot & 31);
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
