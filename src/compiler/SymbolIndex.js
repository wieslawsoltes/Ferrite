import {TypeSystem as T} from './TypeSystem.js';
import {TypeResolver} from './TypeResolver.js';
import {Diagnostic} from './Diagnostic.js';

/** Declaration indexing and namespace resolution are independent of expression typing. */
export class SymbolIndex {
  constructor(ast, {validate = true} = {}) {
    this.functions = new Map(); this.structs = new Map(); this.enums = new Map();
    this.aliases = new Map(); this.constants = new Map(); this.traits = new Map(); this.imports = new Map(); this.impls = [];
    this.symbols = []; this.moduleRoots = new Map(); this.moduleVisibility = new Map();
    // Side tables are declaration-index-local, never attached to reusable AST/HIR.
    this.fieldIndexes = new WeakMap(); this.variantIndexes = new WeakMap(); this.structConstructors = new WeakMap();
    this.enums.set('Option', {kind: 'enum', name: 'Option', generics: [{name: 'T', bounds: []}],
      variants: [{name: 'Some', fields: ['T']}, {name: 'None', fields: []}], attributes: []});
    this.enums.set('Result', {kind: 'enum', name: 'Result', generics: [{name: 'T', bounds: []}, {name: 'E', bounds: []}],
      variants: [{name: 'Ok', fields: ['T']}, {name: 'Err', fields: ['E']}], attributes: []});
    this.addItems(ast.items, '');
    this.typeResolver = new TypeResolver(this); if (validate) this.typeResolver.validate();
    // Tuple/unit constructors occupy the value namespace; record types do not.
    for (const shape of this.structs.values()) if (shape.form === 'tuple' || shape.form === 'unit') {
      if (this.functions.has(shape.name) || this.constants.has(shape.name))
        throw new Diagnostic('E0428', `Duplicate value declaration ${shape.name}`, shape.span);
    }
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
      const target = {fn: this.functions, struct: this.structs, enum: this.enums, trait: this.traits, const: this.constants, typeAlias: this.aliases}[item.kind];
      if (!target) throw new Diagnostic('F0200', `Unindexed declaration ${item.kind}`, item.span);
      if (['struct', 'enum', 'typeAlias', 'trait'].includes(item.kind) && [this.structs, this.enums, this.aliases, this.traits].some(map => map.has(item.name))) throw new Diagnostic('E0428', `Duplicate type declaration ${item.name}`, item.span);
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
  constructorFor(name, module, node = null) {
    const aliases = {Some: 'Option::Some', None: 'Option::None', Ok: 'Result::Ok', Err: 'Result::Err'};
    const candidates = this.candidates(name, module);
    if (aliases[name]) candidates.push(aliases[name]);
    for (const candidate of candidates) {
      const structure = this.structs.get(candidate);
      if (structure && ['tuple', 'unit'].includes(structure.form)) {
        this.visible(structure, module, node);
        let descriptor = this.structConstructors.get(structure);
        if (!descriptor) {
          descriptor = Object.freeze({owner: structure, form: structure.form, kind: 'struct', tag: structure.name,
            variant: Object.freeze({name: structure.name, fields: Object.freeze(structure.fields.map(field => field.type))})});
          this.structConstructors.set(structure, descriptor);
        }
        return descriptor;
      }
      const parts = candidate.split('::'), variantName = parts.pop(), typeName = parts.join('::');
      const alias = this.aliases.has(typeName) ? this.type(typeName, module) : null;
      const application = alias ? T.application(alias) : null;
      const owner = this.enums.get(application?.name ?? typeName);
      const variant = this.variant(owner, variantName);
      if (variant) {
        this.visible(owner, module, node);
        return {owner, variant, form: variant.form ?? (variant.fields.length ? 'tuple' : 'unit'),
          kind: 'enum', typeArguments: application?.args, tag: `${owner.name}::${variant.name}`};
      }
    }
    return null;
  }
  /** Resolve a member once in O(width), then in expected O(1) per use. Retain
   * first-match semantics even for a malformed declaration awaiting diagnostics. */
  member(table, owner, entries, name) {
    if (!owner) return undefined;
    let members = table.get(owner);
    if (!members) {
      members = new Map();
      for (const entry of entries) if (!members.has(entry.name)) members.set(entry.name, entry);
      table.set(owner, members);
    }
    return members.get(name);
  }
  field(shape, name) { return this.member(this.fieldIndexes, shape, shape?.fields, name); }
  variant(shape, name) { return this.member(this.variantIndexes, shape, shape?.variants, name); }

  visible(item, module = '', node = null) {
    if (item.visibility === 'private' && item.module && module !== item.module && !module.startsWith(item.module + '::'))
      throw new Diagnostic('E0603', `Item '${item.name}' is private`, node?.span ?? item.span);
  }
  fieldVisible(shape, field, module = '', node = null) {
    if (field.visibility === 'private' && module !== shape.module && !module.startsWith((shape.module ? shape.module + '::' : '')))
      throw new Diagnostic('E0616', `Field '${shape.name}.${field.name}' is private`, node?.span ?? field.span);
  }
  type(type, module, self = null, parameters = new Set(), node = null) {
    return this.typeResolver.resolve(type, module, self, parameters, [], node);
  }
}
