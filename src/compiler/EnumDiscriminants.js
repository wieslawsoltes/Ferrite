import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Logical discriminants, independent of runtime tags and native memory layout.
 * Direct unit-variant casts are type-system constants; materialized enum values
 * additionally depend on all discriminants required for their layout. These are
 * separate dependency edges. Final emitted MIR has no external resolver.
 */
export class EnumDiscriminants {
  constructor(analyzer) {
    this.analyzer = analyzer; this.index = analyzer.index;
    this.states = new WeakMap(); this.active = new Set();
  }

  representation(owner) { return this.state(owner).type; }

  state(owner) {
    let state = this.states.get(owner);
    if (state) return state;
    let integer = null, explicitRust = false, c = false;
    for (const attribute of owner.attributes ?? []) if (attribute.name === 'repr') {
      if (!attribute.args.length) throw new Diagnostic('E0552', 'An enum representation requires an argument', attribute.span);
      for (const argument of attribute.args) {
        if (typeof argument !== 'string') throw new Diagnostic('F_ENUM_REPR', 'This enum representation hint is not supported', attribute.span);
        if (T.integer(argument)) {
          if (integer && integer !== argument) throw new Diagnostic('E0566', 'Conflicting enum integer representations', attribute.span);
          integer = argument;
        } else if (argument === 'Rust') explicitRust = true;
        else if (argument === 'C') c = true;
        else throw new Diagnostic('F_ENUM_REPR', `Unsupported enum representation ${argument}`, attribute.span);
      }
    }
    if (explicitRust && (integer || c)) throw new Diagnostic('E0566', 'Conflicting enum representations', owner.span);
    if (!owner.variants.length && (integer || c)) throw new Diagnostic('E0084', 'A zero-variant enum cannot have this representation', owner.span);
    if (!integer && owner.variants.some(v => (v.form ?? (v.fields.length ? 'tuple' : 'unit')) !== 'unit') && owner.variants.some(v => v.discriminant))
      throw new Diagnostic('E0732', 'Explicit discriminants in a non-unit-only enum require an integer repr', owner.span);
    const type = integer ?? 'isize', bits = type.endsWith('size') ? 32 : Number(type.slice(1)), signed = type[0] === 'i';
    state = {type, values: new Map(), positions: new Map(owner.variants.map((v, i) => [v.name, i])), table: null,
      min: signed ? -(1n << BigInt(bits - 1)) : 0n, max: (1n << BigInt(bits - Number(signed))) - 1n};
    this.states.set(owner, state); return state;
  }

  resolveTag(name, tag) {
    const owner = this.index.enums.get(name), prefix = name + '::';
    if (!owner || typeof tag !== 'string' || !tag.startsWith(prefix)) throw new Diagnostic('F_ENUM', 'Unresolved enum discriminant');
    return this.value(owner, tag.slice(prefix.length));
  }

  value(owner, name) {
    const state = this.state(owner);
    if (state.values.has(name)) return state.values.get(name);
    const position = state.positions.get(name), variant = owner.variants[position];
    if (!variant) throw new Diagnostic('F_ENUM', `Unknown discriminant ${owner.name}::${name}`, owner.span);
    const key = `${owner.name}::${name}`;
    if (this.active.has(key)) throw new Diagnostic('E0391', `Cycle computing discriminant ${key}`, variant.span,
      [{message: [...this.active, key].join(' → '), span: owner.span}]);
    if (this.active.size >= 128) throw new Diagnostic('F_CONST_BUDGET', 'Enum discriminant dependency depth exceeded', variant.span);
    this.active.add(key);
    try {
      let value;
      if (variant.discriminant) {
        try {
          const result = this.analyzer.constants.evaluate(variant.discriminant, owner.module ?? '', state.type,
            variant, `discriminant:${key}`, variant, owner.name);
          value = BigInt(result.expression.value);
        } catch (error) {
          if (error.code === 'E_LITERAL') throw new Diagnostic('E0080', error.message, error.span);
          throw error;
        }
      } else {
        // Resolve a long implicit run iteratively, avoiding an O(width) JS call stack.
        let previous = position - 1;
        while (previous >= 0 && !state.values.has(owner.variants[previous].name) && !owner.variants[previous].discriminant) previous--;
        value = previous < 0 ? -1n : this.value(owner, owner.variants[previous].name);
        for (let i = previous + 1; i <= position; i++) {
          value++;
          if (value > state.max) throw new Diagnostic('E0370', `Enum discriminant overflows ${state.type}`, owner.variants[i].span);
          state.values.set(owner.variants[i].name, value);
        }
      }
      if (value < state.min || value > state.max) throw new Diagnostic('E0080', `Enum discriminant is outside ${state.type}`, variant.span);
      state.values.set(name, value); return value;
    } finally { this.active.delete(key); }
  }

  requireLayouts(functions) {
    const seen = new Set();
    const visit = (type, span, depth = 0) => {
      if (seen.has(type) || T.reference(type)) return;
      if (depth > 128) throw new Diagnostic('F_CONST_BUDGET', 'Constant layout dependency depth exceeded', span);
      seen.add(type);
      const array = T.array(type), tuple = T.tuple(type);
      if (array) { visit(array.element, span, depth + 1); return; }
      if (tuple) { tuple.forEach(t => visit(t, span, depth + 1)); return; }
      const {name, args} = T.application(type), owner = this.index.enums.get(name) ?? this.index.structs.get(name);
      if (!owner) return;
      // A by-value enum local, argument or temporary requires its layout even
      // if a particular variant's number is never read during CTFE. This is
      // why indirect self-enum casts are cyclic while direct forward casts work.
      if (owner.variants) for (const variant of owner.variants) this.value(owner, variant.name);
      const substitution = new Map(owner.generics.map((g, i) => [g.name, args[i]]));
      const fields = owner.variants ? owner.variants.flatMap(v => v.fields) : owner.fields.map(f => f.type);
      for (const field of fields) visit(this.index.type(T.substitute(field, substitution), owner.module, owner.name), span, depth + 1);
    };
    for (const fn of functions) for (const register of fn.registers) visit(register.type, register.span ?? fn.span);
  }

  checkCast(owner, node) {
    this.state(owner);
    if (owner.variants.some(v => v.fields.length || v.discriminant && v.form !== 'unit'))
      throw new Diagnostic('E0605', 'Only eligible fieldless enums can be cast to an integer', node.span);
    if (this.index.impls.some(impl => impl.trait?.split('::').at(-1) === 'Drop' && this.index.type(impl.target, impl.module) === owner.name))
      throw new Diagnostic('E0509', 'Cannot cast an enum implementing Drop to an integer', node.span);
  }

  validate() {
    for (const owner of this.index.enums.values()) {
      const seen = new Map(); this.state(owner);
      for (const variant of owner.variants) {
        const value = this.value(owner, variant.name), prior = seen.get(value);
        if (prior) throw new Diagnostic('E0081', `Discriminant ${value} is assigned more than once`, variant.span,
          [{message: `First assigned to ${prior.name}`, span: prior.span}]);
        seen.set(value, variant);
      }
    }
  }

  table(owner) {
    const state = this.state(owner);
    if (!state.table) {
      const table = Object.create(null);
      for (const variant of owner.variants) table[`${owner.name}::${variant.name}`] = String(this.value(owner, variant.name));
      state.table = Object.freeze(table);
    }
    return state.table;
  }

  annotate(instances) {
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach(visit); return; }
      if (node.discriminantEnum) node.discriminantTable = this.table(this.index.enums.get(node.discriminantEnum));
      for (const [key, value] of Object.entries(node)) if (!['span', 'loc', 'binding', 'discriminantTable'].includes(key)) visit(value);
    };
    for (const instance of instances) visit(instance.fn.body);
  }

  snapshot() {
    return [...this.index.enums.values()].map(owner => ({name: owner.name, type: this.representation(owner), values: this.table(owner), span: owner.span}));
  }
}
