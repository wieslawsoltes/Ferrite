import {Diagnostic} from './Diagnostic.js';

/** Declaration indexing and namespace resolution are independent of expression typing. */
export class SymbolIndex {
  constructor(ast) {
    this.functions = new Map(); this.structs = new Map(); this.enums = new Map();
    this.constants = new Map(); this.traits = new Map(); this.imports = new Map(); this.impls = [];
    this.symbols = []; this.moduleRoots = new Map(); this.moduleVisibility = new Map();
    this.enums.set('Option', {kind: 'enum', name: 'Option', generics: [{name: 'T', bounds: []}],
      variants: [{name: 'Some', fields: ['T']}, {name: 'None', fields: []}], attributes: []});
    this.enums.set('Result', {kind: 'enum', name: 'Result', generics: [{name: 'T', bounds: []}, {name: 'E', bounds: []}],
      variants: [{name: 'Ok', fields: ['T']}, {name: 'Err', fields: ['E']}], attributes: []});
    this.addItems(ast.items, '');
    // Trait methods inherit the trait's visibility, not an absent `pub` on impl methods.
    for (const method of this.functions.values()) if (method.implementedTrait) {
      const trait = this.resolve(this.traits, method.implementedTrait, method.module, method, false);
      method.visibility = trait?.visibility ?? method.visibility;
    }
  }
  addItems(items, module) {
    for (const original of items) {
      const item = {...original, module: original.module ?? module};
      const prefix = item.module ? item.module + '::' : '';
      this.moduleRoots.set(item.module, item.crateRoot ?? this.moduleRoots.get(item.module) ?? '');
      if (item.kind === 'mod') {
        if (item.external) throw new Diagnostic('E0583', `Module '${item.name}' needs a project file`, item.span);
        this.moduleVisibility.set(prefix + item.name, {module: item.module, visibility: item.visibility, span: item.span});
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
          crateRoot: item.crateRoot, dependency: item.dependency, implementedTrait: item.trait, name: `${item.target}::${method.localName}`})), item.module);
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
    const root = this.moduleRoots.get(module) ?? '';
    if (name.startsWith('crate::')) return [[root, name.slice(7)].filter(Boolean).join('::')];
    if (name.startsWith('self::')) return [module ? module + '::' + name.slice(6) : name.slice(6)];
    if (name.startsWith('super::')) return this.candidates(name.slice(7), module.split('::').slice(0, -1).join('::'));
    const parts = name.split('::'), imported = this.imports.get(module)?.get(parts[0]);
    const names = [];
    if (imported) {
      const path = [imported, ...parts.slice(1)].join('::');
      if (path.startsWith('crate::')) names.push([root, path.slice(7)].filter(Boolean).join('::'));
      else if (path.startsWith('self::')) names.push([module, path.slice(6)].filter(Boolean).join('::'));
      else if (path.startsWith('super::')) names.push(...this.candidates(path, module));
      else names.push([root, path].filter(Boolean).join('::'));
    }
    if (module) names.push(module + '::' + name);
    if (root) names.push(root + '::' + name);
    names.push(name);
    return names;
  }
  resolve(map, name, module, node, required = true) {
    for (const candidate of this.candidates(name, module)) if (map.has(candidate)) {
      const item = map.get(candidate);
      if (item.visibility === 'private' && item.module && module !== item.module && !module.startsWith(item.module + '::')) {
        if (required) throw new Diagnostic('E0603', `Item '${candidate}' is private`, node?.span);
        continue;
      }
      return item;
    }
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
