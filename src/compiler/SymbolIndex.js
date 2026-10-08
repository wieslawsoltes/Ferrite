import {Diagnostic} from './Diagnostic.js';

/** Declaration indexing and namespace resolution are independent of expression typing. */
export class SymbolIndex {
  constructor(ast) {
    this.functions = new Map(); this.structs = new Map(); this.enums = new Map();
    this.constants = new Map(); this.traits = new Map(); this.imports = new Map(); this.impls = [];
    this.symbols = [];
    this.enums.set('Option', {kind: 'enum', name: 'Option', generics: [{name: 'T', bounds: []}],
      variants: [{name: 'Some', fields: ['T']}, {name: 'None', fields: []}], attributes: []});
    this.enums.set('Result', {kind: 'enum', name: 'Result', generics: [{name: 'T', bounds: []}, {name: 'E', bounds: []}],
      variants: [{name: 'Ok', fields: ['T']}, {name: 'Err', fields: ['E']}], attributes: []});
    this.addItems(ast.items, '');
  }
  addItems(items, module) {
    for (const original of items) {
      const item = {...original, module: original.module ?? module};
      const prefix = item.module ? item.module + '::' : '';
      if (item.kind === 'mod') {
        if (item.external) throw new Diagnostic('E0583', `Module '${item.name}' needs a project file`, item.span);
        this.addItems(item.items, prefix + item.name); continue;
      }
      if (item.kind === 'use') {
        const imports = this.imports.get(item.module) ?? new Map();
        for (const entry of item.imports) imports.set(entry.alias, entry.path);
        this.imports.set(item.module, imports); continue;
      }
      if (item.kind === 'impl') {
        this.impls.push(item);
        this.addItems(item.methods.map(method => ({...method, owner: prefix + item.target,
          name: `${item.target}::${method.localName}`})), item.module);
        continue;
      }
      item.name = prefix + item.name;
      const target = {fn: this.functions, struct: this.structs, enum: this.enums, trait: this.traits, const: this.constants}[item.kind];
      if (!target) throw new Diagnostic('F0200', `Unindexed declaration ${item.kind}`, item.span);
      if (target.has(item.name)) throw new Diagnostic('E0428', `Duplicate declaration ${item.name}`, item.span);
      target.set(item.name, item);
      this.symbols.push({id: item.id, name: item.name, kind: item.kind, span: item.span, loc: item.loc, line: item.span?.line});
    }
  }
  candidates(name, module = '') {
    if (name.startsWith('crate::')) return [name.slice(7)];
    if (name.startsWith('self::')) return [module ? module + '::' + name.slice(6) : name.slice(6)];
    if (name.startsWith('super::')) return this.candidates(name.slice(7), module.split('::').slice(0, -1).join('::'));
    const parts = name.split('::'), imported = this.imports.get(module)?.get(parts[0]);
    const names = [];
    if (imported) names.push(...this.candidates([imported, ...parts.slice(1)].join('::'), ''));
    if (module) names.push(module + '::' + name);
    names.push(name);
    return names;
  }
  resolve(map, name, module, node, required = true) {
    for (const candidate of this.candidates(name, module)) if (map.has(candidate)) return map.get(candidate);
    if (required) throw new Diagnostic('E0425', `Unresolved name '${name}'`, node?.span);
    return null;
  }
  constructorFor(name, module) {
    const aliases = {Some: 'Option::Some', None: 'Option::None', Ok: 'Result::Ok', Err: 'Result::Err'};
    for (const candidate of this.candidates(aliases[name] ?? name, module)) {
      const parts = candidate.split('::'), variantName = parts.pop(), owner = this.enums.get(parts.join('::'));
      const variant = owner?.variants.find(v => v.name === variantName);
      if (variant) return {owner, variant, tag: `${owner.name}::${variant.name}`};
    }
    return null;
  }
  type(type, module, self = null) {
    return type.replace(/(?:[A-Za-z_]\w*::)*[A-Za-z_]\w*/g, token => {
      if (token === 'Self' && self) return self;
      return this.resolve(this.structs, token, module, null, false)?.name ??
        this.resolve(this.enums, token, module, null, false)?.name ?? token;
    });
  }
}
