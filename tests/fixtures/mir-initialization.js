/** Independent Set-based must-analysis oracle used only by regression tests. */
export function referenceInitialization(fn) {
  const blocks = new Map(fn.blocks.map(block => [block.id, block]));
  const next = b => b.terminator.kind === 'goto' ? [b.terminator.target]
    : b.terminator.kind === 'branch' ? [b.terminator.true, b.terminator.false] : [];
  const seen = new Set(), work = [fn.entry];
  while (work.length) { const id = work.pop(); if (!seen.has(id)) { seen.add(id); work.push(...next(blocks.get(id))); } }
  const preds = new Map([...seen].map(id => [id, []]));
  for (const id of seen) for (const target of next(blocks.get(id))) preds.get(target).push(id);
  const universe = fn.registers.map((_, index) => index);
  const outputs = new Map([...seen].map(id => [id, new Set(universe)]));
  const meet = id => id === fn.entry ? new Set(fn.params)
    : new Set(universe.filter(slot => preds.get(id).every(pred => outputs.get(pred).has(slot))));
  for (;;) {
    let changed = false;
    for (const id of seen) {
      const out = meet(id);
      for (const i of blocks.get(id).instructions) out.add(i.op === 'copy' ? i.target : i.dest);
      if (out.size !== outputs.get(id).size || [...out].some(slot => !outputs.get(id).has(slot))) changed = true;
      outputs.set(id, out);
    }
    if (!changed) break;
  }
  for (const id of seen) {
    const available = meet(id), block = blocks.get(id);
    for (const i of block.instructions) {
      if (i.op === 'copy' && !available.has(i.value)) return i.value;
      available.add(i.op === 'copy' ? i.target : i.dest);
    }
    const t = block.terminator;
    const used = t.kind === 'return' ? t.value : t.kind === 'branch' ? t.condition : null;
    if (used !== null && !available.has(used)) return used;
  }
  return null;
}

/** Seeded graph generator: deterministic edges include irreducible/back edges. */
export function initializationGraph(seed, registerCount = 65, blockCount = 16, reads = true) {
  let state = seed >>> 0;
  const random = max => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % max; };
  const registers = Array.from({length:registerCount}, (_, id) => ({id, type:id===0?'bool':id===1?'()':'i32'}));
  const slot = () => 2 + random(registerCount - 2);
  const blocks = Array.from({length:blockCount}, (_, id) => {
    const dest = slot();
    const instructions = reads && random(3) === 0
      ? [{op:'copy', target:dest, value:slot()}]
      : [{op:'const', dest, type:'i32', value:String(random(100))}];
    const terminator = id === blockCount-1 ? {kind:'return', value:1}
      : {kind:'branch', condition:0, true:id+1, false:random(blockCount)};
    return {id, instructions, terminator};
  });
  return {instance:'initialization', entry:0, params:[0,1], returnType:'()', registers, blocks};
}
