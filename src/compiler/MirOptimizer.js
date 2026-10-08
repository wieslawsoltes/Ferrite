import {Runtime} from '../runtime/Runtime.js';
import {MirVerifier} from './MirVerifier.js';

/** Local constant folding plus constant-branch and unreachable-block elimination. */
export class MirOptimizer {
  static optimize(input) {
    const functions = structuredClone(input), changes = [], runtime = new Runtime();
    for (const fn of functions) {
      for (const block of fn.blocks) {
        const constants = new Map();
        for (let n = 0; n < block.instructions.length; n++) {
          const i = block.instructions[n]; let folded = false, value;
          if (i.op === 'const') constants.set(i.dest, runtime.literal(i.value, i.type));
          else {
            try {
              if (i.op === 'binary' && constants.has(i.left) && constants.has(i.right)) {
                value = runtime.binary(i.operator, constants.get(i.left), constants.get(i.right), i.operandType); folded = true;
              } else if (i.op === 'unary' && constants.has(i.value)) {
                value = runtime.unary(i.operator, constants.get(i.value), i.type); folded = true;
              } else if (i.op === 'cast' && constants.has(i.value)) { value = runtime.cast(constants.get(i.value), i.targetType); folded = true; }
            } catch { /* Preserve runtime overflow/panic behavior rather than silently removing it. */ }
            if (folded) {
              block.instructions[n] = {id: i.id, op: 'const', dest: i.dest, type: i.type,
                value: typeof value === 'bigint' ? value.toString() : value, span: i.span, sourceId: i.sourceId};
              constants.set(i.dest, value);
              changes.push({kind: 'constant fold', function: fn.instance, block: block.id, span: i.span, detail: `${i.op} → ${String(value)}`});
            } else if (i.op === 'copy') { if (constants.has(i.value)) constants.set(i.target, constants.get(i.value)); else constants.delete(i.target); }
            else if (['write', 'call', 'builtin'].includes(i.op)) constants.clear();
            else if (i.dest != null) constants.delete(i.dest);
          }
        }
        const term = block.terminator;
        if (['branch', 'rangeSwitch'].includes(term.kind) && constants.has(term.condition)) {
          block.terminator = {kind: 'goto', target: constants.get(term.condition) ? term.true : term.false, span: term.span};
          changes.push({kind: 'constant branch', function: fn.instance, block: block.id, span: term.span});
        }
      }
      const map = new Map(fn.blocks.map(b => [b.id, b])), live = new Set(), work = [fn.entry];
      while (work.length) { const id = work.pop(); if (live.has(id)) continue; live.add(id); work.push(...MirVerifier.successors(map.get(id))); }
      const removed = fn.blocks.filter(b => !live.has(b.id));
      removed.forEach(b => changes.push({kind: 'unreachable block', function: fn.instance, block: b.id, span: b.span}));
      fn.blocks = fn.blocks.filter(b => live.has(b.id));
    }
    MirVerifier.verify(functions);
    return {functions, changes};
  }
}
