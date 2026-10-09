import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';

/**
 * Constructor-specialization coverage for Ferrite's supported pattern language.
 * Numeric domains are partitioned at pattern boundaries, never enumerated.
 * A failed proof is a diagnostic rather than an assertion of exhaustiveness.
 */
export class PatternCoverage {
  constructor(index, {maxStates = 8192, maxDepth = 64} = {}) {
    this.index = index;
    this.maxStates = maxStates;
    this.maxDepth = maxDepth;
  }

  analyze(patterns, type, node) {
    this.states = 0; this.witnessCache = new Map(); this.fieldIndexes = new WeakMap();
    this.node = node;
    const witness = this.uncovered(patterns.map(pattern => [pattern]), [type]);
    return {exhaustive: witness === null, witness: witness?.[0] ?? null, states: this.states};
  }

  wild(pattern) {
    if (pattern?.kind === 'atPattern') return this.wild(pattern.pattern);
    return !pattern || pattern.kind === 'wildcard' || pattern.kind === 'bindingPattern';
  }

  alternatives(pattern) {
    if (pattern?.kind === 'atPattern') return this.alternatives(pattern.pattern);
    return pattern?.kind === 'orPattern' ? pattern.items.flatMap(p => this.alternatives(p)) : [pattern];
  }

  scalar(pattern, type) {
    const value = pattern.value;
    if (type === 'char') return BigInt(value.codePointAt(0));
    return T.integer(type) ? BigInt(value) : value;
  }

  constructors(type, patterns) {
    if (type === 'bool') return [false, true].map(value => ({kind: 'literal', key: value, types: []}));
    if (T.integer(type) || type === 'char') {
      const bits = type.endsWith('size') ? 32 : Number(type.slice(1));
      const signed = type[0] === 'i';
      const min = type === 'char' ? 0n : signed ? -(1n << BigInt(bits - 1)) : 0n;
      const max = type === 'char' ? 0x10ffffn : (1n << BigInt(bits - (signed ? 1 : 0))) - 1n;
      const boundaries = new Set([min, max + 1n]);
      // Unicode scalar values exclude the surrogate interval.
      if (type === 'char') { boundaries.add(0xd800n); boundaries.add(0xe000n); }
      for (const pattern of patterns) {
        if (pattern?.kind === 'literal') {
          const value = this.scalar(pattern, type); boundaries.add(value); boundaries.add(value + 1n);
        } else if (pattern?.kind === 'rangePattern') {
          boundaries.add(this.scalar(pattern.from, type));
          boundaries.add(this.scalar(pattern.to, type) + (pattern.inclusive ? 1n : 0n));
        }
      }
      const points = [...boundaries].filter(x => x >= min && x <= max + 1n).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      return points.slice(0, -1).filter(x => type !== 'char' || x < 0xd800n || x >= 0xe000n)
        .map((lo, i) => ({kind: 'interval', lo, types: [], type}));
    }
    const app = T.application(type);
    const enumeration = this.index.enums.get(app.name);
    if (enumeration) {
      const substitution = new Map(enumeration.generics.map((g, i) => [g.name, app.args[i]]));
      return enumeration.variants.map(variant => ({kind: 'variant', key: `${enumeration.name}::${variant.name}`,
        types: variant.fields.map(t => this.index.type(T.substitute(t, substitution), enumeration.module))}));
    }
    const array = T.array(type);
    if (array) {
      const length = Number(array.length);
      if (!Number.isSafeInteger(length) || length < 0 || length > 100000) throw new Diagnostic('F_PATTERN_BUDGET', 'Array pattern exceeds the compiler element budget', this.node?.span);
      return [{kind: 'array', types: Array(length).fill(array.element)}];
    }
    if (type.startsWith('(')) return [{kind: 'tuple', types: T.split(type.slice(1, -1))}];
    const structure = this.index.structs.get(app.name);
    if (structure) {
      const substitution = new Map(structure.generics.map((g, i) => [g.name, app.args[i]]));
      return [{kind: 'struct', key: structure.name, fields: structure.fields.map(f => f.name),
        types: structure.fields.map(f => this.index.type(T.substitute(f.type, substitution), structure.module))}];
    }
    const keys = new Set(patterns.filter(p => p?.kind === 'literal').map(p => p.value));
    return [...keys].map(key => ({kind: 'literal', key, types: []})).concat({kind: 'other', key: type, types: []});
  }

  specialize(pattern, constructor) {
    if (pattern?.kind === 'atPattern') return this.specialize(pattern.pattern, constructor);
    if (this.wild(pattern)) return constructor.types.map(() => null);
    if (constructor.kind === 'literal') return pattern.kind === 'literal' && pattern.value === constructor.key ? [] : null;
    if (constructor.kind === 'interval') {
      if (pattern.kind === 'literal') return this.scalar(pattern, constructor.type) === constructor.lo ? [] : null;
      if (pattern.kind === 'rangePattern') {
        const from = this.scalar(pattern.from, constructor.type), to = this.scalar(pattern.to, constructor.type);
        return from <= constructor.lo && (pattern.inclusive ? constructor.lo <= to : constructor.lo < to) ? [] : null;
      }
      return null;
    }
    if (constructor.kind === 'variant') return pattern.kind === 'variantPattern' && pattern.variant === constructor.key ? pattern.items : null;
    if (constructor.kind === 'array') return pattern.kind === 'arrayPattern' ? pattern.items : null;
    if (constructor.kind === 'tuple') return pattern.kind === 'tuplePattern' ? pattern.items : null;
    if (constructor.kind === 'struct' && pattern.kind === 'structPattern' && pattern.name === constructor.key) {
      let fields = this.fieldIndexes.get(pattern);
      if (!fields) {
        fields = new Map(pattern.fields.map(field => [field.name, field.pattern]));
        this.fieldIndexes.set(pattern, fields);
      }
      return constructor.fields.map(name => fields.get(name) ?? null);
    }
    return null;
  }

  describe(constructor, fields) {
    if (constructor.kind === 'variant') return constructor.key + (fields.length ? `(${fields.join(', ')})` : '');
    if (constructor.kind === 'array') return `[${fields.slice(0, 32).join(', ')}${fields.length > 32 ? ', ..' : ''}]`;
    if (constructor.kind === 'tuple') return `(${fields.join(', ')}${fields.length === 1 ? ',' : ''})`;
    if (constructor.kind === 'struct') return `${constructor.key} { ${constructor.fields.map((name, i) => `${name}: ${fields[i]}`).join(', ')} }`;
    if (constructor.kind === 'interval') return constructor.type === 'char' ? JSON.stringify(String.fromCodePoint(Number(constructor.lo))) : String(constructor.lo);
    if (constructor.kind === 'literal') return JSON.stringify(constructor.key);
    return '_';
  }

  defaultWitness(type, active = new Set()) {
    if (this.witnessCache.has(type)) return this.witnessCache.get(type);
    // Recursive by-value constructors cannot create their own inhabitants.
    if (active.has(type)) return null;
    if (++this.states > this.maxStates || active.size > this.maxDepth) throw new Diagnostic('F_PATTERN_BUDGET', 'Pattern witness exceeds the configured budget', this.node?.span);
    active.add(type);
    try {
      for (const constructor of this.constructors(type, [])) {
        const fields = constructor.types.map(t => this.defaultWitness(t, active));
        if (fields.some(f => f === null)) continue;
        const witness = this.describe(constructor, fields);
        this.witnessCache.set(type, witness);
        return witness;
      }
      return null;
    } finally { active.delete(type); }
  }

  uncovered(matrix, types, depth = 0) {
    if (++this.states > this.maxStates || depth > this.maxDepth) {
      throw new Diagnostic('F_PATTERN_BUDGET', 'Pattern coverage proof exceeds the configured budget; simplify the patterns', this.node?.span);
    }
    if (!types.length) return matrix.length ? null : [];
    if (!matrix.length) {
      const witness = types.map(type => this.defaultWitness(type));
      return witness.some(w => w === null) ? null : witness;
    }
    if (matrix.some(row => row.every(p => this.wild(p)))) return null;
    // Unconstrained columns cannot distinguish rows. Skip them in a single pass,
    // rather than branching through every scalar of a large rest pattern.
    let skipped = 0;
    while (skipped < types.length && matrix.length && matrix.every(row => this.wild(row[skipped]))) skipped++;
    if (skipped) {
      const witness = this.uncovered(matrix.map(row => row.slice(skipped)), types.slice(skipped), depth);
      return witness === null ? null : [...Array(skipped).fill('_'), ...witness];
    }
    const rows = matrix.flatMap(row => this.alternatives(row[0]).map(first => [first, ...row.slice(1)]));
    for (const constructor of this.constructors(types[0], rows.map(row => row[0]))) {
      const specialized = [];
      for (const row of rows) {
        const head = this.specialize(row[0], constructor);
        if (head !== null) specialized.push([...head, ...row.slice(1)]);
      }
      const witness = this.uncovered(specialized, [...constructor.types, ...types.slice(1)], depth + 1);
      if (witness !== null) return [this.describe(constructor, witness.slice(0, constructor.types.length)), ...witness.slice(constructor.types.length)];
    }
    return null;
  }
}
