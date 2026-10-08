import {AgentError} from './AgentError.js';

/** Validator for the deliberately small JSON-Schema vocabulary used by Ferrite tools. */
export class JsonSchema {
  static validate(value, schema, path = '$', depth = 0) {
    const fail = message => { throw new AgentError('INVALID_ARGUMENTS', `${path}: ${message}`); };
    if (depth > 32) fail('maximum nesting exceeded');
    if (schema.enum && !schema.enum.some(item => JSON.stringify(item) === JSON.stringify(value))) fail('not an allowed value');
    const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
    const matches = type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) :
      type === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) :
      type === 'integer' ? Number.isSafeInteger(value) : type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
    if (types.length && !types.some(matches)) fail(`expected ${types.join(' or ')}`);
    if (value === null) return value;
    if (typeof value === 'string') {
      if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? 1_048_576)) fail('string length out of range');
      if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) fail('invalid format');
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity)) fail('number out of range');
    } else if (Array.isArray(value)) {
      if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? 1000)) fail('array length out of range');
      for (let i = 0; i < value.length; i++) this.validate(value[i], schema.items ?? {}, `${path}[${i}]`, depth + 1);
    } else if (typeof value === 'object') {
      if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) fail('plain JSON object required');
      const properties = schema.properties ?? {};
      for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) fail(`missing ${key}`);
      for (const [key, item] of Object.entries(value)) {
        if (['__proto__', 'constructor', 'prototype'].includes(key)) fail('unsafe key');
        if (Object.hasOwn(properties, key)) this.validate(item, properties[key], `${path}.${key}`, depth + 1);
        else if (schema.additionalProperties === false) fail(`unknown property ${key}`);
        else this.validate(item, typeof schema.additionalProperties === 'object' ? schema.additionalProperties : {}, `${path}.${key}`, depth + 1);
      }
    } else if (!['boolean', 'string', 'number'].includes(typeof value)) fail('not JSON');
    return value;
  }
  static object(properties = {}, required = Object.keys(properties)) { return {type: 'object', properties, required, additionalProperties: false}; }
}
