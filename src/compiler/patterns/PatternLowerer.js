/** Pattern predicates and destructuring lowered entirely to verified MIR operations. */
export class PatternLowerer {
  constructor(lowerer) { this.ir = lowerer; this.sources = new Map(); }

  /** Capture an address once, before testing or binding. Borrowing a register
   * containing a copied payload would silently disconnect writes from its owner. */
  prepare(source) {
    const ir = this.ir;
    if (!source.patternBorrowed) return ir.expr(source);
    let place;
    if (source.patternStorage) {
      const value = ir.expr(source);
      place = {slot: source.patternStorage.slot, path: []};
      ir.emit('write', {place, value}, source);
    } else place = ir.place(source);
    const value = ir.emit('read', {place, copy: false}, source, source.type);
    this.sources.set(value, place);
    return value;
  }
  project(place, part) { return place ? {slot: place.slot, path: [...place.path, part]} : null; }

  bind(pattern, value, node = pattern, place = this.sources.get(value)) {
    const ir = this.ir;
    if (pattern.binding) {
      if (pattern.byRef) value = ir.emit('borrow', {place, mutable: !!pattern.mutable}, pattern, pattern.binding.type);
      else if (pattern.copy) { const cloned = ir.register(pattern.type, pattern); ir.move(cloned, value, pattern, true); value = cloned; }
      ir.emit('write', {place: {slot: pattern.binding.slot, path: []}, value}, node);
    }
    if (pattern.kind === 'atPattern') { this.bind(pattern.binder, value, pattern.binder, place); this.bind(pattern.pattern, value, pattern.pattern, place); return; }
    if (pattern.restBinding) {
      const {binder, start, length} = pattern.restBinding;
      const values = Array.from({length}, (_, i) => ir.emit('get', {value, field: String(start + i), index: null, deref: false, copy: false}, binder, pattern.items[start + i].type));
      this.bind(binder, ir.emit('aggregate', {form: 'array', values}, binder, binder.type));
    }
    if (pattern.kind === 'orPattern') {
      const choose = index => {
        const alternative = pattern.items[index];
        if (index === pattern.items.length - 1) { this.bind(alternative, value, alternative, place); return ir.unit(pattern); }
        return ir.conditional(this.test(alternative, value), () => {
          this.bind(alternative, value, alternative, place); return ir.unit(pattern);
        }, () => choose(index + 1), pattern, '()');
      };
      choose(0);
    } else if (pattern.kind === 'structPattern') {
      for (const field of pattern.fields) this.bind(field.pattern,
        ir.emit('get', {value, field: field.name, index: null, deref: false, copy: false}, field.pattern, field.pattern.type), field.pattern, this.project(place, {kind: 'field', name: field.name}));
    } else if (['tuplePattern', 'arrayPattern'].includes(pattern.kind)) {
      pattern.items.forEach((p, i) => { if (p.kind !== 'wildcard') this.bind(p, ir.emit('get', {value, field: String(i), index: null, deref: false, copy: false}, p, p.type), p, this.project(place, {kind: 'field', name: String(i)})); });
    } else if (pattern.kind === 'variantPattern') {
      pattern.items.forEach((p, i) => { if (p.kind !== 'wildcard') this.bind(p, ir.emit('payload', {value, index: i}, p, p.type), p, this.project(place, {kind: 'payload', variant: pattern.variant, index: i})); });
    }
  }

  test(pattern, value) {
    const ir = this.ir;
    if (pattern.kind === 'atPattern') return this.test(pattern.pattern, value);
    if (['wildcard', 'bindingPattern'].includes(pattern.kind)) return ir.literal(true, 'bool', pattern);
    if (pattern.kind === 'literal') return ir.emit('binary', {operator: '==', left: value,
      right: ir.literal(pattern.value, pattern.type, pattern), operandType: pattern.type}, pattern, 'bool');
    if (pattern.kind === 'rangePattern') {
      const lower = ir.emit('binary', {operator: '>=', left: value, right: ir.literal(pattern.from.value, pattern.type, pattern.from), operandType: pattern.type}, pattern, 'bool');
      return ir.conditional(lower, () => ir.emit('binary', {operator: pattern.inclusive ? '<=' : '<', left: value,
        right: ir.literal(pattern.to.value, pattern.type, pattern.to), operandType: pattern.type}, pattern, 'bool'), () => ir.literal(false, 'bool', pattern), pattern, 'bool');
    }
    if (pattern.kind === 'orPattern') {
      let result = this.test(pattern.items[0], value);
      for (const alternative of pattern.items.slice(1)) result = ir.conditional(result,
        () => ir.literal(true, 'bool', alternative), () => this.test(alternative, value), alternative, 'bool');
      return result;
    }
    let result = ir.literal(true, 'bool', pattern), projections;
    if (pattern.kind === 'structPattern') projections = pattern.fields.map(field => ({pattern: field.pattern,
      read: () => ir.emit('get', {value, field: field.name, index: null}, field.pattern, field.pattern.type)}));
    else if (['tuplePattern', 'arrayPattern'].includes(pattern.kind)) projections = pattern.items.map((p, i) => ({pattern: p,
      read: () => ir.emit('get', {value, field: String(i), index: null}, p, p.type)}));
    else {
      const tag = ir.emit('tag', {value}, pattern, '&str');
      result = ir.emit('binary', {operator: '==', left: tag, right: ir.literal(pattern.variant, '&str', pattern), operandType: '&str'}, pattern, 'bool');
      projections = pattern.items.map((p, i) => ({pattern: p, read: () => ir.emit('payload', {value, index: i}, p, p.type)}));
    }
    for (const projection of projections.filter(p => !['wildcard', 'bindingPattern'].includes(p.pattern.kind))) result = ir.conditional(result,
      () => this.test(projection.pattern, projection.read()), () => ir.literal(false, 'bool', projection.pattern), projection.pattern, 'bool');
    return result;
  }
}
