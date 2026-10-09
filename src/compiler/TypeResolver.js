import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Transparent aliases are expanded structurally in their declaration namespace.
 * The cache belongs to one declaration index; no type result crosses revisions. */
export class TypeResolver {
  constructor(index, {limit = 4096, maxDepth = 64} = {}) {
    this.index = index; this.limit = limit; this.maxDepth = maxDepth; this.cache = new Map();
    this.expansions = new Map(); this.hits = 0; this.misses = 0; this.characters = 0; this.maxCharacters = 4000000;
  }
  resolve(type, module = '', self = null, parameters = new Set(), stack = [], node = null) {
    if (typeof type !== 'string') throw new Diagnostic('F_TYPE', 'A type must have a structural name', node?.span);
    const key = JSON.stringify([module, self, [...parameters].sort(), type]);
    if (this.cache.has(key)) { this.hits++; return this.cache.get(key); }
    if (stack.length > this.maxDepth) throw new Diagnostic('E0391', 'Type alias expansion exceeded the recursion budget', node?.span);
    this.misses++;
    const next = value => this.resolve(value, module, self, parameters, stack, node);
    let result;
    if (type.startsWith('impl ')) result = 'impl ' + next(type.slice(5));
    else if (T.reference(type)) result = (type.startsWith('&mut ') ? '&mut ' : '&') + next(T.target(type));
    else if (T.function(type)) {const fn=T.function(type);result=T.functionName(fn.params.map(next),next(fn.result));}
    else if (T.tuple(type)) result = T.tupleName(T.tuple(type).map(next));
    else if (T.array(type)) { const {element, length} = T.array(type); const size = this.index.constantEvaluator?.length(length, module, node, parameters) ?? length; result = `[${next(element)};${size}]`; }
    else {
      const prefix=/^(Fn|FnMut|FnOnce)(?=\()/.exec(type), callable=prefix?T.function('fn'+type.slice(prefix[1].length)):null;
      if (callable) result = `${prefix[1]}(${callable.params.map(next).join(',')})->${next(callable.result)}`;
      else {
        const {name, args} = T.application(type), arguments_ = args.map(next);
        const alias = parameters.has(name) ? null : this.find(this.index.aliases, name, module, node);
        if (alias) {
          if (alias.generics.length !== args.length) throw new Diagnostic('E0107', `Alias ${alias.name} expects ${alias.generics.length} type argument(s), got ${args.length}`, node?.span ?? alias.span);
          if (stack.includes(alias.name)) throw new Diagnostic('E0391', `Recursive type alias: ${[...stack, alias.name].join(' → ')}`, node?.span ?? alias.span);
          const declared = new Set(alias.generics.map(g => g.name));
          const target = this.resolve(alias.target, alias.module, self, declared, [...stack, alias.name], alias);
          result = this.substitute(target, new Map(alias.generics.map((g, i) => [g.name, arguments_[i]])), alias);
          const usage = {alias: alias.name, arguments: arguments_, expanded: result, span: alias.span};
          if (this.expansions.size < 512 && result.length < 8192) this.expansions.set(JSON.stringify([alias.name, arguments_]), usage);
        } else {
          const canonical = parameters.has(name) ? name : name === 'Self' && self ? self :
            this.find(this.index.structs, name, module, node)?.name ?? this.find(this.index.enums, name, module, node)?.name ?? name;
          result = canonical + (args.length ? `<${arguments_.join(',')}>` : '');
        }
      }
    }
    if (result.length > 1000000) throw new Diagnostic('F_TYPE_SIZE', 'Expanded type exceeds the size budget', node?.span);
    const cost = key.length + result.length;
    if (cost <= this.maxCharacters) {
      while (this.cache.size && (this.cache.size >= this.limit || this.characters + cost > this.maxCharacters)) {
        const first = this.cache.keys().next().value; this.characters -= first.length + this.cache.get(first).length; this.cache.delete(first);
      }
      this.cache.set(key, result); this.characters += cost;
    }
    return result;
  }
  substitute(type, arguments_, node) {
    const result = T.substitute(type, arguments_);
    if (result.length > 1000000) throw new Diagnostic('F_TYPE_SIZE', 'Expanded alias exceeds the size budget', node.span);
    return result;
  }
  find(map, name, module, node) {
    for (const candidate of this.index.candidates(name, module)) if (map.has(candidate))
      return this.index.resolve(map, name, module, node, true);
    return null;
  }
  validateKnown(type, parameters, node) {
    const next = value => this.validateKnown(value, parameters, node);
    if (type.startsWith('impl ')) return next(type.slice(5));
    if (T.reference(type)) return next(T.target(type));
    const fn=T.function(type);if(fn){fn.params.forEach(next);next(fn.result);return;}
    const tuple = T.tuple(type); if (tuple) { tuple.forEach(next); return; }
    const array = T.array(type); if (array) return next(array.element);
    const prefix=/^(Fn|FnMut|FnOnce)(?=\()/.exec(type), callable=prefix?T.function('fn'+type.slice(prefix[1].length)):null;
    if (callable) { callable.params.forEach(next); next(callable.result); return; }
    const {name, args} = T.application(type);
    if (!parameters.has(name) && !T.numeric(name) && !['bool', 'char', 'str', 'String', 'Vec', '!', '_'].includes(name) && !this.index.structs.has(name) && !this.index.enums.has(name))
      throw new Diagnostic('E0412', `Unknown type '${name}' in declaration ${node.name}`, node.span);
    const shape = this.index.structs.get(name) ?? this.index.enums.get(name);
    const arity = shape?.generics?.length ?? (name === 'Vec' ? 1 : 0);
    if (!parameters.has(name) && args.length !== arity) throw new Diagnostic('E0107', `${name} expects ${arity} type argument(s)`, node.span);
    args.forEach(next);
  }
  validate() {
    for (const alias of this.index.aliases.values()) {
      const parameters = new Set(alias.generics.map(g => g.name));
      if (parameters.size !== alias.generics.length) throw new Diagnostic('E0403', `Duplicate generic parameter in ${alias.name}`, alias.span);
      const result = this.resolve(alias.target, alias.module, null, parameters, [alias.name], alias);
      this.validateKnown(result, parameters, alias);
    }
    this.validateNominals();
  }
  /** Check stored field declarations even when no function constructs their type. */
  validateNominals() {
    const used = (type, parameters, found) => {
      if (T.reference(type)) return used(T.target(type), parameters, found);
      const fn=T.function(type);if(fn){[...fn.params,fn.result].forEach(t=>used(t,parameters,found));return;}
      const tuple = T.tuple(type); if (tuple) { tuple.forEach(t => used(t, parameters, found)); return; }
      const array = T.array(type); if (array) return used(array.element, parameters, found);
      const prefix=/^(Fn|FnMut|FnOnce)(?=\()/.exec(type), callable=prefix?T.function('fn'+type.slice(prefix[1].length)):null;
      if (callable) { [...callable.params, callable.result].forEach(t => used(t, parameters, found)); return; }
      const app = T.application(type);
      if (parameters.has(app.name)) found.add(app.name);
      app.args.forEach(t => used(t, parameters, found));
    };
    for (const shape of [...this.index.structs.values(), ...this.index.enums.values()]) {
      const parameters = new Set(shape.generics.map(g => g.name));
      if (parameters.size !== shape.generics.length)
        throw new Diagnostic('E0403', `Duplicate generic parameter in ${shape.name}`, shape.span);
      const names = new Set(), entries = shape.fields ?? shape.variants;
      for (const entry of entries) {
        if (names.has(entry.name)) throw new Diagnostic(shape.fields ? 'E0124' : 'E0428', `Duplicate member ${entry.name} in ${shape.name}`, entry.span ?? shape.span);
        names.add(entry.name);
      }
      if (shape.variants) for (const variant of shape.variants) {
        const fields = new Set();
        for (const member of variant.members ?? []) {
          if (fields.has(member.name)) throw new Diagnostic('E0124', `Duplicate field ${member.name} in ${shape.name}::${variant.name}`, member.span);
          fields.add(member.name);
        }
      }
      const fields = shape.fields?.map(field => ({type:field.type,node:field})) ??
        shape.variants.flatMap(variant => variant.fields.map((type, i) => ({type,node:variant.members?.[i] ?? variant})));
      const found = new Set();
      for (const field of fields) {
        if (/\b_\b/.test(field.type)) throw new Diagnostic('E0121', 'Inferred placeholder types are not allowed in stored field declarations', field.node.span ?? shape.span);
        if (/\bimpl\s/.test(field.type)) throw new Diagnostic('E0562', 'impl Trait is not allowed in stored field declarations', field.node.span ?? shape.span);
        const type = this.resolve(field.type, shape.module, shape.name, parameters, [], field.node);
        this.validateKnown(type, parameters, {...shape,span:field.node.span ?? shape.span});
        used(type, parameters, found);
      }
      for (const name of parameters) if (!found.has(name) && shape.builtin !== 'phantom')
        throw new Diagnostic('E0392', `Type parameter ${name} is never used in ${shape.name}`, shape.span);
    }
  }
  snapshot() { return {hits: this.hits, misses: this.misses, entries: this.cache.size, characters: this.characters, aliases: [...this.expansions.values()]}; }
}
