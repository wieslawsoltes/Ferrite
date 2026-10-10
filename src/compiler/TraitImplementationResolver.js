import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ImplTypePattern} from './ImplTypePattern.js';
import {ImplObligations} from './ImplObligations.js';
import {TraitHierarchy} from './TraitHierarchy.js';

/** Per-analysis, bounded solver for declared (non-parameterized) user traits.
 * Trait identities are canonical declaration names, not their last path segment.
 * This is inductive proof: an obligation in progress is never proof of itself. */
export class TraitImplementationResolver {
  constructor(owner) {
    this.owner=owner;this.a=owner.a;this.index=owner.index;
    this.hierarchy=new TraitHierarchy(this.index);
    this.byTrait=new Map();this.byRoot=new Map();this.memo=new Map();this.memoCharacters=0;this.active=new Set();this.queries=0;this.hits=0;this.candidatesExamined=0;
  }
  declaration(name,module,node,required=true) {
    const app=T.application(name);
    const trait=this.index.typeResolver.find(this.index.traits,app.name,module,node);
    if(!trait) {
      if(required) {
        if(/^(std|core)::/.test(name)||['Copy','Clone','Debug','Display','PartialEq','Eq','PartialOrd','Ord','Sized','Send','Sync','Unpin','Default'].includes(name))
          throw new Diagnostic('F_TRAIT_EXTERNAL','Manual standard-library trait implementations require imported trait definitions',node?.span);
        throw new Diagnostic('E0405',`Unknown trait '${name}'`,node?.span);
      }
      return null;
    }
    if(app.args.length!==(trait.generics?.length??0))throw new Diagnostic('E0107',`Trait ${trait.name} expects ${trait.generics?.length??0} type argument(s)`,node?.span);
    return trait;
  }
  validateDeclarations() {
    for(const trait of this.index.traits.values()) {
      const seen=new Set(), traitParameters=trait.generics??[];
      const identity=trait.name+(traitParameters.length?`<${traitParameters.map(g=>g.name).join(',')}>`:'');
      const traitDeclaration={...trait,unsizedSelf:true,generics:[{name:'Self',bounds:[identity]},...traitParameters]};
      const traitRequirements=new ImplObligations(this.a,{target:'Self',impl:traitDeclaration},traitDeclaration);
      for(const generic of traitParameters)traitRequirements.validate(generic.name,trait);
      for(const method of trait.methods) {
        if(method.kind!=='fn')throw new Diagnostic('F_TRAIT_ITEM','Associated types and constants require their trait continuation',method.span);
        if(seen.has(method.localName))throw new Diagnostic('E0428',`Duplicate trait method ${method.localName}`,method.span);
        seen.add(method.localName);
        if(method.isConst)throw new Diagnostic('E0379','Trait methods cannot be const',method.span);
        if(method.visibility==='pub')throw new Diagnostic('E0449','Trait methods inherit the trait visibility',method.span);
        const parameters=new Set(['Self',...traitParameters.map(g=>g.name),...method.generics.map(g=>g.name)]);
        if(parameters.size!==method.generics.length+traitParameters.length+1)throw new Diagnostic('E0403','Duplicate trait method parameter',method.span);
        const declaration={...method,module:trait.module,unsizedSelf:true,generics:[{name:'Self',bounds:[identity]},...traitParameters,...method.generics],predicates:[...(trait.predicates??[]),...(method.predicates??[])]};
        const requirements=new ImplObligations(this.a,{target:'Self',impl:declaration},declaration);
        for(const raw of [...method.params.map(p=>p.type),method.returnType]) {
          if(/\b_\b/.test(raw))throw new Diagnostic('E0121','Trait signatures cannot contain inferred types',method.span);
          if(raw.startsWith('impl '))throw new Diagnostic('F_TRAIT_OPAQUE','Opaque trait return types require their inference continuation',method.span);
          const type=this.index.type(raw,trait.module,'Self',parameters,method);
          this.index.typeResolver.validateKnown(type,parameters,method);
          requirements.validateCanonical(type,method);
          // Required methods may mention unsized Self by value, but a default
          // body must have a Sized proof before materializing parameters/results.
          if(method.body && !requirements.prove(type,'core::marker::Sized'))
            throw new Diagnostic('E0277',`Default method ${method.localName} needs a Sized bound for ${type}`,method.span);
        }
      }
    }
  }
  prepare() {
    for(const entry of this.owner.entries) if(entry.impl.trait) {
      entry.trait=this.declaration(entry.impl.trait,entry.impl.module,entry.impl);
      this.owner.prepare(entry);
      entry.traitRef=this.hierarchy.canonical(entry.impl.trait,entry.impl.module,entry.impl,entry.parameters,entry.target);
      if(!this.byTrait.has(entry.trait.name))this.byTrait.set(entry.trait.name,[]);
      this.byTrait.get(entry.trait.name).push(entry);
      if(!this.byRoot.has(entry.trait.name))this.byRoot.set(entry.trait.name,new Map());
      const roots=this.byRoot.get(entry.trait.name);
      if(!roots.has(entry.root))roots.set(entry.root,[]);
      roots.get(entry.root).push(entry);
    }
  }
  validate(entry) {
    const {impl,trait,parameters,target}=entry;
    const traitArguments=T.application(entry.traitRef).args;
    const substitution=new Map([['Self',target],...(trait.generics??[]).map((g,i)=>[g.name,traitArguments[i]])]);
    const parametersInTrait=new Set(['Self',...(trait.generics??[]).map(g=>g.name)]);
    const typeInTrait=raw=>T.substitute(this.index.type(raw,trait.module,'Self',parametersInTrait,trait),substitution);
    const environment=new ImplObligations(this.a,entry);
    for(const argument of traitArguments){this.index.typeResolver.validateKnown(argument,parameters,impl);environment.validate(argument,impl);environment.requireSized(argument,impl);}
    for(const generic of trait.generics??[])for(const bound of generic.bounds)
      if(!environment.prove(substitution.get(generic.name),this.hierarchy.canonical(typeInTrait(bound),impl.module,impl,parameters,target)))
        throw new Diagnostic('E0277',`Trait argument bound is not satisfied: ${generic.name}: ${bound}`,impl.span);
    for(const predicate of trait.predicates??[])if(predicate.type!=='Self')for(const bound of predicate.bounds)
      if(!environment.prove(typeInTrait(predicate.type),this.hierarchy.canonical(typeInTrait(bound),impl.module,impl,parameters,target)))
        throw new Diagnostic('E0277',`Trait predicate is not satisfied: ${predicate.type}: ${bound}`,impl.span);
    const parents = this.hierarchy.parents(entry.traitRef,target);
    if (parents.length) {
      const environment = new ImplObligations(this.a, entry);
      for (const parent of parents) if (!environment.prove(target, parent))
        throw new Diagnostic('E0277', `Implementing ${trait.name} requires ${target}: ${parent}`, impl.span,
          [{message: 'Supertrait is required here', span: trait.span}]);
    }
    const root=T.application(target).name,shape=this.index.structs.get(root)??this.index.enums.get(root);
    if((trait.crateRoot??'')!==(impl.crateRoot??'') && (!shape||(shape.crateRoot??'')!==(impl.crateRoot??'')))
      throw new Diagnostic('E0117','A trait implementation needs a local trait or local implementing type',impl.span);
    const declared=new Map(trait.methods.map(method=>[method.localName,method]));
    for(const [name,fn] of entry.methods) {
      const expected=declared.get(name);
      if(!expected)throw new Diagnostic('E0407',`${name} is not a member of ${trait.name}`,fn.span);
      if(fn.isConst)throw new Diagnostic('E0379','Trait implementation methods cannot be const',fn.span);
      // SymbolIndex assigns effective visibility; inspect the original declaration.
      if(impl.methods.find(method=>method.localName===name)?.visibility==='pub')throw new Diagnostic('E0449','Trait impl methods cannot declare visibility',fn.span);
      const actual=fn.generics.slice(fn.implGenericCount??0);
      if(actual.length!==expected.generics.length)throw new Diagnostic('E0049',`Generic arity differs from ${trait.name}::${name}`,fn.span);
      if(fn.params.length!==expected.params.length)throw new Diagnostic('E0050',`Parameter count differs from ${trait.name}::${name}`,fn.span);
      if((fn.params[0]?.name==='self')!==(expected.params[0]?.name==='self'))throw new Diagnostic('E0185',`Receiver differs from ${trait.name}::${name}`,fn.span);
      const expectedNames=new Set(['Self',...(trait.generics??[]).map(g=>g.name),...expected.generics.map(g=>g.name)]);
      const actualNames=new Set(fn.generics.map(g=>g.name));
      const rename=new Map([...substitution,...expected.generics.map((g,i)=>[g.name,actual[i].name])]);
      const expectedType=raw=>T.substitute(this.index.type(raw,trait.module,'Self',expectedNames,expected),rename);
      const actualType=raw=>this.index.type(raw,fn.module,target,actualNames,fn);
      const lhs=[...fn.params.map(p=>p.type),fn.returnType].map(actualType);
      const rhs=[...expected.params.map(p=>p.type),expected.returnType].map(expectedType);
      if(lhs.some((type,i)=>type!==rhs[i]))throw new Diagnostic('E0053',`Signature differs from ${trait.name}::${name}`,fn.span,
        [{message:'Trait declaration is here',span:expected.span}]);
      // An implementation cannot add requirements not present on the trait method.
      const environment={...fn,generics:[...(impl.generics??[]),...expected.generics.map((g,i)=>({...g,name:actual[i].name,
        bounds:g.bounds.map(expectedType)}))],
        predicates:[...(impl.predicates??[]),...(expected.predicates??[]).map(p=>({...p,type:expectedType(p.type),bounds:p.bounds.map(expectedType)}))]};
      const obligations=new ImplObligations(this.a,entry,environment);
      const require=(type,bound,node)=>{
        const canonical=obligations.trait(actualType(bound),fn.module,node);
        if(!obligations.prove(actualType(type),canonical))throw new Diagnostic('E0276',`Impl has a stricter requirement ${type}: ${bound}`,node.span??fn.span);
      };
      for(const parameter of actual)for(const bound of parameter.bounds)require(parameter.name,bound,fn);
      for(const predicate of (fn.predicates??[]).slice((impl.predicates??[]).length))for(const bound of predicate.bounds)require(predicate.type,bound,predicate);
      // Copy the effective inherited method contract without changing any AST node.
      fn.generics=environment.generics;fn.predicates=environment.predicates;fn.implementedTrait=entry.traitRef;
    }
    for(const [name,method] of declared) if(!entry.methods.has(name)) {
      if(!method.body)throw new Diagnostic('E0046',`Missing ${trait.name}::${name}`,impl.span);
      this.addDefault(entry,method);
    }
  }
  addDefault(entry,method) {
    const {impl,trait,target}=entry,parameters=new Set(impl.generics?.map(g=>g.name)??[]);
    method=this.freshen(method,parameters,entry.id);
    const traitParameters=trait.generics??[], actual=T.application(entry.traitRef).args, rename=new Map();
    const used=new Set([...parameters,...method.generics.map(g=>g.name)]), serialized=JSON.stringify(method);
    for(const [i,generic] of traitParameters.entries()) {
      let name=`__FerriteTraitArg${entry.id}_${i}`;
      while(used.has(name)||serialized.includes(name))name+='_';
      used.add(name);rename.set(generic.name,name);
    }
    method=this.rewrite(method,rename);
    const additional=traitParameters.map(generic=>({name:rename.get(generic.name),bounds:generic.bounds.map(bound=>T.substitute(this.index.type(bound,trait.module,'Self',new Set(traitParameters.map(g=>g.name)),trait),rename))}));
    const defaultArguments=additional.map((generic,i)=>[generic.name,actual[i]]);
    const traitPredicates=(trait.predicates??[]).filter(p=>p.type!=='Self').map(p=>({...p,type:T.substitute(p.type,rename),bounds:p.bounds.map(bound=>T.substitute(bound,rename))}));
    const normalize=type=>this.index.type(type,impl.module,target,parameters,impl);
    const inherited=(impl.generics??[]).map(g=>({...g,bounds:g.bounds.map(normalize)}));
    const fn={...structuredClone(method),name:`${target}::__trait${entry.id}::${method.localName}`,owner:target,
      implIndex:entry.id,implGenericCount:inherited.length+additional.length,implementedTrait:entry.traitRef,defaultTrait:trait.name+(additional.length?`<${additional.map(g=>g.name).join(',')}>`:''),defaultArguments,module:trait.module,
      crateRoot:impl.crateRoot,dependency:impl.dependency,visibility:trait.visibility,
      generics:[...inherited,...additional,...method.generics],predicates:[...(impl.predicates??[]).map(p=>({...p,type:normalize(p.type),bounds:p.bounds.map(normalize)})),...traitPredicates,...(method.predicates??[])]};

    // Self in a default body resolves in the trait namespace, to the actual owner.
    entry.methods.set(method.localName,fn);this.index.functions.set(fn.name,fn);
    const bucket=this.owner.byOwner.get(entry.root);
    if(!bucket.has(method.localName))bucket.set(method.localName,[]);
    bucket.get(method.localName).push(entry);
  }
  /** Alpha-rename only type binders/type syntax. Local names, field names and
   * string contents belong to different namespaces and must remain unchanged. */
  freshen(method,inherited,id) {
    const rename=new Map(),serialized=JSON.stringify(method),used=new Set([...inherited,...method.generics.map(g=>g.name)]);
    for(const parameter of method.generics) if(inherited.has(parameter.name)) {
      let name=`__FerriteTrait${id}_${rename.size}`;
      while(used.has(name)||serialized.includes(name))name+='_';
      used.add(name);rename.set(parameter.name,name);
    }
    return this.rewrite(method,rename,true);
  }
  rewrite(method,rename,renameBinders=false) {
    const copy=structuredClone(method);if(!rename.size)return copy;
    const rewrite=value=>T.substitute(value,rename),queue=[copy];
    while(queue.length) {
      const node=queue.pop();
      for(const [key,value] of Object.entries(node)) {
        if(typeof value==='string' && ['type','returnType','target','annotation','to','qualifiedSelf','qualifiedTrait'].includes(key))node[key]=rewrite(value);
        else if(typeof value==='string' && key==='name' && value.includes('::') && rename.has(value.split('::')[0])) {
          // TypeSystem.substitute intentionally treats qualified names atomically.
          // A generic associated path instead needs only its binder prefix changed.
          const separator=value.indexOf('::');
          node[key]=rename.get(value.slice(0,separator))+value.slice(separator);
        }
        else if(Array.isArray(value) && ['bounds','typeArguments','ownerTypeArguments'].includes(key))node[key]=value.map(rewrite);
        else if(value&&typeof value==='object') {
          if(Array.isArray(value)){for(const child of value)if(child&&typeof child==='object')queue.push(child);}
          else queue.push(value);
        }
      }
    }
    if(renameBinders)copy.generics.forEach(parameter=>{parameter.name=rename.get(parameter.name)??parameter.name;});
    return copy;
  }
  coherence() {
    let pairs=0;
    for(const entries of this.byTrait.values()) for(let i=0;i<entries.length;i++)for(let j=i+1;j<entries.length;j++) {
      if(++pairs>200000)throw new Diagnostic('F_TRAIT_COHERENCE_LIMIT','Trait overlap comparison budget exceeded',entries[j].impl.span);
      if(ImplTypePattern.unify(this.goal(entries[i]),this.goal(entries[j])))throw new Diagnostic('E0119',`Conflicting implementations of ${entries[i].trait.name}`,entries[j].impl.span);
    }
  }
  goal(entry) {
    this.owner.prepare(entry);
    return entry.goalPattern??=Object.freeze({kind:'tuple',name:'tuple',args:Object.freeze([entry.pattern,ImplTypePattern.parse(entry.traitRef,entry.parameters,`impl${entry.id}:`)])});
  }
  match(entry,type,bound) {
    const query={kind:'tuple',name:'tuple',args:[ImplTypePattern.parse(type,new Set(),'query:'),ImplTypePattern.parse(bound,new Set(),'traitQuery:')]};
    const bindings=ImplTypePattern.unify(this.goal(entry),query);
    return bindings?new Map([...entry.parameters].map(name=>[name,ImplTypePattern.render({variable:`impl${entry.id}:`+name},bindings)])):null;
  }
  candidates(type,bound) {
    const roots=this.byRoot.get(T.application(bound).name);
    return [...(roots?.get(this.owner.head(type))??[]),...(roots?.get('*')??[])];
  }
  remember(key,result) {
    if(key.length>32768)return;
    const previous=this.memo.has(key);if(previous)this.memoCharacters-=key.length;
    this.memo.delete(key);this.memo.set(key,result);this.memoCharacters+=key.length;
    while(this.memo.size>4096 || this.memoCharacters>4000000) {
      const oldest=this.memo.keys().next().value;this.memoCharacters-=oldest.length;this.memo.delete(oldest);
    }
  }
  snapshot() {return {hierarchy:this.hierarchy.snapshot(),queries:this.queries,cacheHits:this.hits,cacheEntries:this.memo.size,cacheCharacters:this.memoCharacters,candidatesExamined:this.candidatesExamined};}
  prove(type,bound,environment,depth) {
    const active=environment.traitActive??=new Set(),key=JSON.stringify([type,bound]);
    if(active.has(key))return false;
    active.add(key);
    try {
      return this.candidates(type,bound).some(entry=>{
        const mapping=this.match(entry,type,bound);
        return mapping && [...mapping.values()].every(value=>value!==null) &&
          this.owner.applicable(entry,mapping,(subject,requirement)=>environment.prove(subject,requirement,depth+1));
      });
    } finally {active.delete(key);}
  }
  has(type,bound) {
    if(!this.index.traits.has(T.application(bound).name))return null;
    const key=JSON.stringify([type,bound]);
    if(++this.queries>200000)throw new Diagnostic('F_TRAIT_OBLIGATION_LIMIT','Trait obligation query budget exceeded');
    if(this.memo.has(key)){this.hits++;return this.memo.get(key);}
    if(this.active.has(key))return false;
    if(this.active.size>=64)throw new Diagnostic('E0275','Trait obligation recursion exceeded the supported budget');
    this.active.add(key);
    try {
      let success=false;
      for(const entry of this.candidates(type,bound)) {
        this.candidatesExamined++;
        const mapping=this.match(entry,type,bound);
        if(mapping && [...mapping.values()].every(value=>value!==null) && this.owner.applicable(entry,mapping)){success=true;break;}
      }
      // A negative result inside recursion may depend on an in-progress query.
      // Only the top-level result is memoized; successful finite proofs are stable.
      if(success || this.active.size===1)this.remember(key,success);
      return success;
    } finally {this.active.delete(key);}
  }
}
