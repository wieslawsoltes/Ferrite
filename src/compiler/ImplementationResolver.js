import {ImplTypePattern} from './ImplTypePattern.js';
import {TraitImplementationResolver} from './TraitImplementationResolver.js';
import {ImplObligations} from './ImplObligations.js';
import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

export {ImplTypePattern};

/** Per-analysis impl-head/member index. Lookup never mutates an AST, HIR or
 * cached declaration; monomorphizations still use the production call pipeline. */
export class ImplementationResolver {
  constructor(analyzer) {
    this.a = analyzer; this.index = analyzer.index; this.byOwner = new Map(); this.entries = [];
    this.lookups = 0; this.candidatesExamined = 0;
    for (const [id, impl] of this.index.impls.entries()) {
      const parameters = new Set((impl.generics ?? []).map(g => g.name));
      const root = this.root(impl.target, impl.module, parameters);
      const entry = {id, impl, parameters, root, target: null, pattern: null, resolving: false, methods: new Map()};
      this.entries.push(entry);
      if (!this.byOwner.has(root)) this.byOwner.set(root, new Map());
    }
    for (const fn of this.index.functions.values()) if (fn.implIndex !== undefined) {
      const entry = this.entries[fn.implIndex], bucket = this.byOwner.get(entry.root);
      if (entry.methods.has(fn.localName)) throw new Diagnostic('E0592', `Duplicate method ${fn.localName}`, fn.span);
      entry.methods.set(fn.localName, fn);
      if (!bucket.has(fn.localName)) bucket.set(fn.localName, []);
      bucket.get(fn.localName).push(entry);
    }
    this.traits=new TraitImplementationResolver(this);this.traits.prepare();
  }
  root(type, module, parameters, seen = new Set()) {
    const app = T.application(type);
    if (parameters.has(app.name)) return '*';
    if(T.reference(type)||T.tuple(type)||T.array(type)||T.function(type))return this.head(type);
    const shape = this.index.typeResolver.find(this.index.structs, app.name, module, null) ??
      this.index.typeResolver.find(this.index.enums, app.name, module, null);
    if (shape) return shape.name;
    const alias = this.index.typeResolver.find(this.index.aliases, app.name, module, null);
    if (!alias) return app.name;
    if (seen.has(alias.name) || seen.size > 64) throw new Diagnostic('E0391', 'Cycle in implementation target aliases', alias.span);
    seen.add(alias.name);
    return this.root(T.substitute(alias.target, new Map(alias.generics.map((g,i) => [g.name, app.args[i]]))), alias.module, parameters, seen);
  }
  head(type) {
    const pattern=ImplTypePattern.parse(type);
    return pattern.kind==='nominal'?pattern.name:`${pattern.kind}:${pattern.name}:${pattern.args.length}`;
  }
  prepare(entry) {
    if (entry.pattern) return;
    if (entry.resolving) throw new Diagnostic('E0391', 'Implementation target depends on its own constant evaluation', entry.impl.span);
    entry.resolving = true;
    try {
      entry.target = this.index.type(entry.impl.target, entry.impl.module, null, entry.parameters, entry.impl);
      entry.pattern = ImplTypePattern.parse(entry.target, entry.parameters, `impl${entry.id}:`);
    } finally { entry.resolving = false; }
  }
  validate() {
    this.traits.validateDeclarations();
    for (const entry of this.entries) {
      this.prepare(entry);
      const {impl, parameters, target} = entry;
      if (parameters.size !== (impl.generics ?? []).length) throw new Diagnostic('E0403', 'Duplicate implementation type parameter', impl.span);

      if (/\b_\b/.test(target)) throw new Diagnostic('E0121', 'Implementation targets cannot contain inferred placeholders', impl.span);
      this.index.typeResolver.validateKnown(target, parameters, {...impl, name: target});
      const root = T.application(target).name, shape = this.index.structs.get(root) ?? this.index.enums.get(root);
      if (!impl.trait && (!shape || ['Option', 'Result'].includes(root) || (shape.crateRoot ?? '') !== (impl.crateRoot ?? '')))
        throw new Diagnostic('E0116', 'Inherent implementations require a nominal type defined in this crate', impl.span);
      const used = new Set(), queue = [entry.pattern,...(entry.trait?[ImplTypePattern.parse(entry.traitRef,parameters,`impl${entry.id}:`)]:[])];
      while (queue.length) { const term = queue.pop(); if (term.variable) used.add(term.variable); else queue.push(...term.args); }
      for (const name of parameters) if (!used.has(`impl${entry.id}:` + name))
        throw new Diagnostic('E0207', `Implementation parameter ${name} is not constrained by its self type`, impl.span);
      if(impl.trait)this.traits.validate(entry);
      new ImplObligations(this.a,entry).validate(target,impl);
      for (const fn of entry.methods.values()) {
        const obligations = new ImplObligations(this.a,entry,fn);
        const all = new Set(fn.generics.map(g => g.name));
        if (fn.params[0]?.name === 'self') {
          let receiver = this.index.type(fn.params[0].type, fn.module, target, all, fn);
          while (T.reference(receiver)) receiver = T.target(receiver);
          if (receiver !== target) throw new Diagnostic('E0307', 'The self receiver must refer to the implementing type', fn.params[0].span);
        }
        for (const raw of [...fn.params.map(p => p.type), fn.returnType]) {
          if (/\b_\b/.test(raw)) throw new Diagnostic('E0121', 'Placeholder types are not allowed in method signatures', fn.span);
          if (raw.startsWith('impl ')) continue; // Existing opaque-return analysis owns this case.
          const type = this.index.type(raw, fn.module, target, all, fn);
          this.index.typeResolver.validateKnown(type, all, fn);
          obligations.validateCanonical(type,fn);
        }
      }
    }
    this.traits.coherence();
    // Only compare declarations sharing both nominal owner and member name.
    for (const methods of this.byOwner.values()) for (const [name, entries] of methods) {
      for (let i = 0; i < entries.length; i++) for (let j = i + 1; j < entries.length; j++) {
        const a = entries[i], b = entries[j];
        if (!a.impl.trait && !b.impl.trait && ImplTypePattern.unify(a.pattern, b.pattern))
          throw new Diagnostic('E0592', `Overlapping inherent definitions of ${name}`, b.methods.get(name).span,
            [{message: 'Other definition is here', span: a.methods.get(name).span}]);
      }
    }
  }
  match(entry, type, query = null) {
    this.prepare(entry);
    const bindings = ImplTypePattern.unify(entry.pattern, query ?? ImplTypePattern.parse(type, new Set(), 'query:'));
    if (!bindings) return null;
    return new Map([...entry.parameters].map(name => [name, ImplTypePattern.render({variable: `impl${entry.id}:` + name}, bindings)]));
  }
  applicable(entry, mapping, prove=(type,bound)=>this.a.hasBound(type,bound)) {
    if ([...mapping.values()].some(type => type === null)) return true;
    const normalize = type => this.index.type(T.substitute(type, mapping), entry.impl.module, T.substitute(entry.target, mapping));
    for (const parameter of entry.impl.generics ?? [])
      if (!prove(mapping.get(parameter.name), 'core::marker::Sized')) return false;
    for (const parameter of entry.impl.generics ?? []) for (const bound of parameter.bounds)
      if (!prove(mapping.get(parameter.name), this.traits.hierarchy.canonical(normalize(bound), entry.impl.module, entry.impl))) return false;
    for (const predicate of entry.impl.predicates ?? []) for (const bound of predicate.bounds)
      if (!prove(normalize(predicate.type), this.traits.hierarchy.canonical(normalize(bound), entry.impl.module, entry.impl))) return false;
    return true;
  }
  lookup(type, method, module, node, context=null, boundTraits=null, requiredTrait=null) {
    this.lookups++;
    const candidates = [...(this.byOwner.get(this.head(type))?.get(method) ?? []),...(this.byOwner.get('*')?.get(method) ?? [])], matches = [];
    let boundFailure = false;
    const query = ImplTypePattern.parse(type, new Set(), 'query:');
    for (const entry of candidates) {
      this.candidatesExamined++;
      if(requiredTrait && entry.trait?.name!==T.application(requiredTrait).name)continue;
      let mapping = this.match(entry, type, query);
      if (!mapping) continue;
      if(entry.trait) {
        const scoped=[...(requiredTrait?[requiredTrait]:boundTraits??[])].filter(bound=>T.application(bound).name===entry.trait.name);
        if(scoped.length) {
          const matched=scoped.map(bound=>this.traits.match(entry,type,bound)).filter(Boolean);
          if(!matched.length)continue;
          if(matched.length>1)throw new Diagnostic('E0283',`Multiple trait applications select ${method}`,node.span);
          mapping=matched[0];
        } else if(entry.trait.name!==T.application(context?.implementedTrait??'').name && !this.inScope(entry.trait,module))continue;
      }
      if (!this.applicable(entry, mapping)) { boundFailure = true; continue; }
      const fn=entry.methods.get(method);
      for(const [name,raw] of fn.defaultArguments??[]) {
        const unresolved=[...entry.parameters].some(parameter=>mapping.get(parameter)===null&&T.substitute(raw,new Map([[parameter,'_']]))!==raw);
        mapping.set(name,unresolved?null:T.substitute(raw,mapping));
      }
      matches.push({fn,mapping});
    }
    const defaults=boundTraits?matches.filter(candidate=>boundTraits.has(T.substitute(candidate.fn.implementedTrait??'',candidate.mapping))):context?.defaultTrait?matches.filter(candidate=>candidate.fn.implementedTrait===context.defaultTrait):[];
    const inherent = matches.filter(candidate => !candidate.fn.implementedTrait), selected = defaults.length?defaults:inherent.length ? inherent : matches;
    if (selected.length > 1) throw new Diagnostic('E0034', `Multiple applicable methods named ${method} for ${type}`, node.span);
    if (!selected.length) {
      if (boundFailure) throw new Diagnostic('E0277', `Implementation bounds are not satisfied for ${type}::${method}`, node.span);
      return null;
    }
    const result = selected[0]; this.index.visible(result.fn, module, node);
    return result;
  }
  inScope(trait,module) {
    if(trait.module===module)return true;
    for(const imported of this.index.imports.get(module)?.values()??[])
      if(this.index.resolve(this.index.traits,imported,module,null,false)?.name===trait.name)return true;
    return false;
  }
  associated(node, context) {
    if(node.qualifiedTrait) {
      const type=this.a.normalize(node.qualifiedSelf,context,node);
      const module=context.instance.fn.module;
      const trait=this.traits.hierarchy.canonical(node.qualifiedTrait,module,node,new Set(context.instance.substitution.keys()),type);
      const bound=T.substitute(trait,context.instance.substitution);
      const method=node.name.slice(node.name.lastIndexOf('::')+2);
      const result=this.lookup(type,method,module,node,context.instance.fn,null,bound);
      if(!result)throw new Diagnostic('E0277',`No implementation of ${bound} for ${type} supplies ${method}`,node.span);
      return result;
    }
    const separator = node.name.lastIndexOf('::'); if (separator < 0) return null;
    let owner = node.name.slice(0, separator);
    const boundTraits = context.methodScope?.traits(owner);
    const method = node.name.slice(separator + 2), module = context.instance.fn.module;
    if (owner === 'Self') owner = context.instance.fn.owner;
    else owner = T.substitute(owner, context.instance.substitution ?? new Map(Object.entries(context.instance.typeArguments)));
    if (!owner) return null;
    const app = T.application(owner);
    const declaration = this.index.typeResolver.find(this.index.structs, app.name, module, node) ??
      this.index.typeResolver.find(this.index.enums, app.name, module, node) ?? this.index.typeResolver.find(this.index.aliases, app.name, module, node);
    if (!declaration) {
      // A substituted method binder can name a primitive/structural implementor,
      // not just an item in the nominal declaration tables.
      if(!T.numeric(owner)&&!['bool','char','str','String'].includes(owner)&&
        !T.reference(owner)&&!T.tuple(owner)&&!T.array(owner)&&!T.function(owner))return null;
      if(node.ownerTypeArguments?.length)throw new Diagnostic('E0107','This implementing type has no type arguments',node.span);
      return this.lookup(owner,method,module,node,context.instance.fn,boundTraits);
    }
    const explicit = node.ownerTypeArguments?.map(type => this.a.normalize(type, context, node));
    const args = explicit ?? (app.args.length ? app.args : declaration.generics.map(() => '_'));
    if (args.length !== declaration.generics.length) throw new Diagnostic('E0107', `Wrong number of type arguments for ${app.name}`, node.span);
    const type = this.index.type(app.name + (args.length ? `<${args.join(',')}>` : ''), module, context.instance.fn.owner, new Set(), node);
    const result = this.lookup(type, method, module, node,context.instance.fn,boundTraits);
    if (!result) throw new Diagnostic('E0599', `No associated function ${method} for ${type}`, node.span);
    return result;
  }
  explicit(resolved, node, context) {
    const {fn, mapping} = resolved, count = fn.implGenericCount ?? 0;
    const method = (node.typeArguments ?? []).map(type => this.a.normalize(type, context, node));
    if (method.length && method.length !== fn.generics.length - count) throw new Diagnostic('E0107', `Wrong number of method type arguments for ${fn.localName}`, node.span);
    return [...fn.generics.slice(0, count).map(parameter => mapping.get(parameter.name)), ...method];
  }
  snapshot() { return {implementations: this.entries.length, lookups: this.lookups, candidatesExamined: this.candidatesExamined}; }
}
