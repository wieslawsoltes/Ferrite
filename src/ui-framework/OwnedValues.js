/**
 * Bounded, schema-driven owned values across the Rust/UI boundary. Every read is
 * a clone, never an alias into hook storage. JSON uses decimal strings for Rust
 * integers (including i128/u128). This class is also embedded in offline exports.
 */
export class OwnedValues {
  constructor(schemas = {}, {maxNodes = 50000, maxDepth = 128, maxString = 1000000} = {}) {
    this.schemas = schemas; this.maxNodes = maxNodes; this.maxDepth = maxDepth; this.maxString = maxString;
  }
  transfer(type, value, mode = 'clone') {
    let visits = 0, characters = 0; const active = new Set();
    const fail = message => { throw Object.assign(Error(`Invalid owned ${type} value: ${message}`), {code: 'R_UI_VALUE'}); };
    const object = value => {
      if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected a plain record');
      for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) if (descriptor.get || descriptor.set) fail('accessors are not owned data');
    };
    const walk = (type, input, depth) => {
      if (++visits > this.maxNodes || depth > this.maxDepth) fail('value budget exceeded');
      const schema = this.schemas[type]; if (!schema) fail(`missing schema for ${type}`);
      if (schema.kind === 'integer') {
        let value = input;
        if (mode === 'decode' && typeof value === 'string' && /^-?(?:0|[1-9]\d*)n?$/.test(value) && value.length < 42) value = BigInt(value.replace(/n$/, ''));
        if (typeof value !== 'bigint') fail(`${type} requires a BigInt (or decimal JSON string)`);
        const bits = BigInt(schema.bits), min = schema.signed ? -(1n << (bits - 1n)) : 0n;
        const max = (1n << (bits - (schema.signed ? 1n : 0n))) - 1n;
        if (value < min || value > max) fail(`${type} is out of bounds`);
        return mode === 'encode' ? String(value) : value;
      }
      if (schema.kind === 'float') {
        if (typeof input !== 'number' || !Number.isFinite(input)) fail('a finite number is required');
        const value = schema.bits === 32 ? Math.fround(input) : input;
        if (!Number.isFinite(value)) fail('float overflow'); return value;
      }
      if (schema.kind === 'bool') { if (typeof input !== 'boolean') fail('expected boolean'); return input; }
      if (schema.kind === 'unit') { if (input !== null) fail('expected unit/null'); return null; }
      if (schema.kind === 'string' || schema.kind === 'char') {
        if (typeof input !== 'string' || (characters += input.length) > this.maxString) fail('string budget exceeded or non-string value');
        if (schema.kind === 'char' && ([...input].length !== 1 || /[\uD800-\uDFFF]/u.test(input))) fail('expected one Unicode scalar');
        return input;
      }
      if (!input || typeof input !== 'object' || active.has(input)) fail('expected an acyclic aggregate');
      active.add(input);
      try {
        if (schema.kind === 'sequence' || schema.kind === 'tuple') {
          if (!Array.isArray(input) || input.length > this.maxNodes || schema.length != null && input.length !== schema.length) fail('invalid sequence length');
          for (const d of Object.values(Object.getOwnPropertyDescriptors(input))) if (d.get || d.set) fail('accessors are not owned data');
          return Array.from(input, (item, i) => walk(schema.kind === 'tuple' ? schema.items[i] : schema.item, item, depth + 1));
        }
        if (schema.kind === 'record') {
          object(input);
          if (Object.keys(input).length !== schema.fields.length || schema.fields.some(field => !Object.hasOwn(input, field.name))) fail('record fields do not match');
          return Object.fromEntries(schema.fields.map(field => [field.name, walk(field.type, input[field.name], depth + 1)]));
        }
        if (schema.kind === 'enum') {
          object(input);
          if (Object.keys(input).length !== 2 || !Object.hasOwn(input, 'tag') || !Object.hasOwn(input, 'values')) fail('expected {tag, values}');
          const variant = schema.variants.find(variant => variant.tag === input.tag);
          if (!variant || !Array.isArray(input.values) || input.values.length !== variant.fields.length) fail('invalid enum variant');
          for (const d of Object.values(Object.getOwnPropertyDescriptors(input.values))) if (d.get || d.set) fail('accessors are not owned data');
          return {tag: variant.tag, values: variant.fields.map((field, i) => walk(field, input.values[i], depth + 1))};
        }
        fail(`unsupported schema ${schema.kind}`);
      } finally { active.delete(input); }
    };
    return walk(type, value, 0);
  }
  clone(type, value) { return this.transfer(type, value); }
  encode(type, value) { return this.transfer(type, value, 'encode'); }
  decode(type, value) { return this.transfer(type, value, 'decode'); }
  key(type, value) { return JSON.stringify(this.encode(type, value)); }
}
