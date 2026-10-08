/** Shared checked value semantics for the MIR VM and generated JavaScript. */
export class Runtime {
  constructor({maxSteps = 1000000, maxOutput = 1000000, maxDepth = 256, overflow = 'checked'} = {}) {
    this.maxSteps = maxSteps; this.maxOutput = maxOutput; this.maxDepth = maxDepth; this.overflow = overflow;
    this.steps = 0; this.depth = 0; this.output = ''; this.span = null;
    this.integerBounds = new Map();
  }
  fail(message, code = 'RUNTIME') {
    const error = new Error(message); error.code = code; error.span = this.span; throw error;
  }
  tick(span = null) {
    this.span = span;
    if (++this.steps > this.maxSteps) this.fail('Execution instruction budget exceeded', 'R_BUDGET');
  }
  enter() { if (++this.depth > this.maxDepth) this.fail('Call depth limit exceeded', 'R_STACK'); }
  leave() { this.depth--; }
  integer(type) { return /^(?:[iu](?:8|16|32|64|128)|[iu]size)$/.test(type); }
  bounds(type) {
    const existing = this.integerBounds.get(type);
    if (existing) return existing;
    const bits = type.endsWith('size') ? 32 : Number(type.slice(1)), signed = type[0] === 'i';
    const bounds = Object.freeze({bits, signed, min: signed ? -(1n << BigInt(bits - 1)) : 0n, max: (1n << BigInt(bits - (signed ? 1 : 0))) - 1n});
    this.integerBounds.set(type, bounds); return bounds;
  }
  normalize(value, type, wrapping = false) {
    if (!this.integer(type)) return type === 'f32' ? Math.fround(Number(value)) : value;
    const n = BigInt(value), range = this.bounds(type);
    if (wrapping || this.overflow === 'wrapping') return range.signed ? BigInt.asIntN(range.bits, n) : BigInt.asUintN(range.bits, n);
    if (n < range.min || n > range.max) this.fail(`Integer overflow for ${type}`, 'R_OVERFLOW');
    return n;
  }
  literal(value, type) {
    if (this.integer(type)) return this.normalize(value, type);
    if (type === 'f32' || type === 'f64') return this.normalize(Number(value), type);
    return value;
  }
  binary(op, a, b, type) {
    switch (op) {
      case '==': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '<=': return a <= b;
      case '>': return a > b;
      case '>=': return a >= b;
      case '&&': return a && b;
      case '||': return a || b;
    }
    if (this.integer(type) && ['/', '%'].includes(op) && b === 0n) this.fail('Division by zero', 'R_DIV_ZERO');
    let result;
    switch (op) {
      case '+': result = a + b; break;
      case '-': result = a - b; break;
      case '*': result = a * b; break;
      case '/': result = a / b; break;
      case '%': result = a % b; break;
      case '&': result = a & b; break;
      case '|': result = a | b; break;
      case '^': result = a ^ b; break;
      default: return this.fail(`Unsupported runtime operator ${op}`);
    }
    return this.normalize(result, type);
  }
  unary(op, value, type) {
    if (op === '!') return typeof value === 'boolean' ? !value : this.normalize(~value, type, true);
    if (op === '-') return this.normalize(-value, type);
    return this.fail(`Invalid unary operator ${op}`);
  }
  cast(value, target) {
    if (!this.integer(target)) return target === 'f32' ? Math.fround(Number(value)) : Number(value);
    if (typeof value === 'bigint') return this.normalize(value, target, true);
    const range = this.bounds(target);
    if (Number.isNaN(value)) return 0n;
    if (value <= Number(range.min)) return range.min;
    if (value >= Number(range.max)) return range.max;
    return BigInt(Math.trunc(value));
  }
  clone(value, depth = 0) {
    if (depth > 128) this.fail('Value nesting limit exceeded');
    if (value === null || typeof value !== 'object' || value.__ref === true) return value;
    if (Array.isArray(value)) return value.map(v => this.clone(v, depth + 1));
    const result = Object.create(null);
    for (const key of Object.keys(value)) result[key] = this.clone(value[key], depth + 1);
    return result;
  }
  cells(count) { return Array.from({length: count}, () => ({value: undefined})); }
  reference(cells, slot, path = []) { return {__ref: true, cell: cells[slot], path}; }
  resolve(reference, depth = 0) {
    if (depth > 128 || !reference || reference.__ref !== true) this.fail('Invalid reference', 'R_REFERENCE');
    let holder = reference.cell, key = 'value';
    for (const part of reference.path) {
      const value = holder[key];
      if (part.kind === 'deref') { ({holder, key} = this.resolve(value, depth + 1)); continue; }
      if (value === undefined || value === null) this.fail('Uninitialized place', 'R_UNINITIALIZED');
      if (part.kind === 'index') { holder = value; key = this.index(value, part.value); }
      else {
        if (!Object.hasOwn(value, part.name)) this.fail(`Unknown field ${part.name}`);
        holder = value; key = part.name;
      }
    }
    return {holder, key};
  }
  read(reference, copy = false) {
    const {holder, key} = this.resolve(reference), value = holder[key];
    if (value === undefined) this.fail('Read before initialization', 'R_UNINITIALIZED');
    return copy ? this.clone(value) : value;
  }
  write(reference, value) { const {holder, key} = this.resolve(reference); holder[key] = value; }
  deref(value) { return this.read(value); }
  index(array, index) {
    if (!Array.isArray(array) || (typeof index !== 'bigint' && !Number.isSafeInteger(index))) this.fail('Invalid array index');
    const n = Number(index);
    if (!Number.isSafeInteger(n) || n < 0 || n >= array.length) this.fail(`Index ${index} out of bounds for length ${array.length}`, 'R_BOUNDS');
    return n;
  }
  get(value, field, isIndex = false, deref = false, copy = false) {
    if (deref) value = this.deref(value);
    const key = isIndex ? this.index(value, field) : field;
    if (value == null || !Object.hasOwn(value, key)) this.fail(`Unknown field ${String(field)}`);
    return copy ? this.clone(value[key]) : value[key];
  }
  aggregate(form, values, names = [], tag = null) {
    if (form === 'enum') return {tag, values};
    if (['array', 'tuple', 'vec'].includes(form)) return values;
    const record = Object.create(null);
    names.forEach((name, i) => { record[name] = values[i]; });
    return record;
  }
  debug(value, depth = 0) {
    if (depth > 12) return '…';
    if (typeof value === 'bigint') return value.toString();
    if (typeof value === 'string') return JSON.stringify(value);
    if (value === null) return '()';
    if (value?.__ref) return '&' + this.debug(this.read(value), depth + 1);
    if (Array.isArray(value)) return '[' + value.map(v => this.debug(v, depth + 1)).join(', ') + ']';
    if (value?.tag) return value.tag + (value.values.length ? '(' + value.values.map(v => this.debug(v, depth + 1)).join(', ') + ')' : '');
    if (value && typeof value === 'object') return '{ ' + Object.entries(value).map(([k, v]) => k + ': ' + this.debug(v, depth + 1)).join(', ') + ' }';
    return String(value);
  }
  append(text) {
    if (this.output.length + text.length > this.maxOutput) this.fail('Program output limit exceeded', 'R_OUTPUT');
    this.output += text;
  }
  format(args, format) {
    return format.parts.map(part => part.text ?? (part.debug ? this.debug(args[part.argument + 1]) : String(args[part.argument + 1]))).join('');
  }
  builtin(name, args, {format = null, receiver = null, receiverReference = false, receiverDeref = false} = {}) {
    let value = receiverReference ? this.read(receiver) : receiver;
    if (receiverDeref) value = this.deref(value);
    switch (name) {
      case 'println': this.append((format ? this.format(args, format) : '') + '\n'); return null;
      case 'print': this.append(this.format(args, format)); return null;
      case 'format': return this.format(args, format);
      case 'panic': return this.fail(format ? this.format(args, format) : 'explicit panic', 'R_PANIC');
      case 'assert': if (!args[0]) this.fail('assertion failed', 'R_ASSERT'); return null;
      case 'assert_eq': if (this.debug(args[0]) !== this.debug(args[1])) this.fail(`assertion failed: ${this.debug(args[0])} != ${this.debug(args[1])}`, 'R_ASSERT'); return null;
      case 'dbg': this.append(this.debug(args[0]) + '\n'); return args[0];
      case 'vec': return args;
      case 'Vec::new': return [];
      case 'String::from': return String(args[0]);
      case 'clone': return this.clone(args[0]);
      case 'method::clone': return this.clone(value);
      case 'method::to_string': return String(value);
      case 'method::len': {
        if (Array.isArray(value)) return BigInt(value.length);
        let bytes = 0;
        for (const c of value) { const code = c.codePointAt(0); bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4; }
        return BigInt(bytes);
      }
      case 'method::push': if (value.length >= 100000) this.fail('Vector length limit exceeded'); value.push(args[0]); return null;
      case 'method::pop': return value.length ? {tag: 'Option::Some', values: [value.pop()]} : {tag: 'Option::None', values: []};
      case 'method::push_str': {
        if (receiverDeref) this.write(this.read(receiver), value + args[0]); else this.write(receiver, value + args[0]);
        return null;
      }
      case 'method::unwrap': {
        if (!value?.tag?.match(/::(?:Some|Ok)$/)) this.fail('called unwrap on None or Err', 'R_UNWRAP');
        return value.values[0];
      }
      case 'method::is_some': return value?.tag === 'Option::Some';
      case 'method::is_none': return value?.tag === 'Option::None';
      case 'method::is_ok': return value?.tag === 'Result::Ok';
      case 'method::is_err': return value?.tag === 'Result::Err';
      default: return this.fail(`Missing runtime builtin ${name}`);
    }
  }
}
