/** Pattern predicates and destructuring lowered entirely to verified MIR operations. */
export class PatternLowerer {
  constructor(lowerer) { this.ir = lowerer; }

  bind(pattern, value, node = pattern) {
    const ir = this.ir;
    if (pattern.binding) ir.emit('write', {place: {slot: pattern.binding.slot, path: []}, value}, node);
    if (pattern.kind === 'orPattern') {
      const choose = index => {
        const alternative = pattern.items[index];
        if (index === pattern.items.length - 1) { this.bind(alternative, value); return ir.unit(pattern); }
        return ir.conditional(this.test(alternative, value), () => {
          this.bind(alternative, value); return ir.unit(pattern);
        }, () => choose(index + 1), pattern, '()');
      };
      choose(0);
    } else if (pattern.kind === 'structPattern') {
      for (const field of pattern.fields) this.bind(field.pattern,
        ir.emit('get', {value, field: field.name, index: null, deref: false, copy: false}, field.pattern, field.pattern.type));
    } else if (pattern.kind === 'tuplePattern') {
      pattern.items.forEach((p, i) => this.bind(p, ir.emit('get', {value, field: String(i), index: null, deref: false, copy: false}, p, p.type)));
    } else if (pattern.kind === 'variantPattern') {
      pattern.items.forEach((p, i) => this.bind(p, ir.emit('payload', {value, index: i}, p, p.type)));
    }
  }

  test(pattern, value) {
    const ir = this.ir;
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
    else if (pattern.kind === 'tuplePattern') projections = pattern.items.map((p, i) => ({pattern: p,
      read: () => ir.emit('get', {value, field: String(i), index: null}, p, p.type)}));
    else {
      const tag = ir.emit('tag', {value}, pattern, '&str');
      result = ir.emit('binary', {operator: '==', left: tag, right: ir.literal(pattern.variant, '&str', pattern), operandType: '&str'}, pattern, 'bool');
      projections = pattern.items.map((p, i) => ({pattern: p, read: () => ir.emit('payload', {value, index: i}, p, p.type)}));
    }
    for (const projection of projections) result = ir.conditional(result,
      () => this.test(projection.pattern, projection.read()), () => ir.literal(false, 'bool', projection.pattern), projection.pattern, 'bool');
    return result;
  }
}
