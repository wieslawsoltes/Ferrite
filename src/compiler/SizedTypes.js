import {Diagnostic} from './Diagnostic.js';
import {ImplObligations} from './ImplObligations.js';
import {TypeSystem as T} from './TypeSystem.js';

const sizedPaths = new Set(['Sized', 'core::marker::Sized', 'std::marker::Sized']);
const builtinBounds = new Set(['Copy','Clone','Debug','Display','PartialEq','Eq','PartialOrd','Ord','Sized','Send','Sync','Unpin','Default']);

/** Sized is a compiler-owned storage property, not a property of every generic
 * argument. References, function pointers and PhantomData break storage edges;
 * a struct's tail may be unsized while an enum's payloads must all be sized.
 *
 * Relaxations remove only an implicit parameter bound. Positive Sized evidence
 * (including Copy/Clone supertraits) remains owned by ImplObligations. All
 * metadata belongs to this index; source syntax and replayable HIR stay immutable.
 */
export class SizedTypes {
  constructor(index, {maxQueries = 1000000, maxDepth = 128, maxTypeCharacters = 1000000, maxEntries = 4096, maxCharacters = 4000000} = {}) {
    for (const value of [maxQueries,maxDepth,maxTypeCharacters,maxEntries,maxCharacters])
      if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Sized proof limits must be nonnegative safe integers');
    this.index=index; this.maxQueries=maxQueries; this.maxDepth=maxDepth; this.maxTypeCharacters=maxTypeCharacters;
    this.maxEntries=maxEntries; this.maxCharacters=maxCharacters; this.characters=0; this.concrete=new Set();
    this.parameters=new WeakMap(); this.active=new Set(); this.queries=0; this.fields=0; this.relaxations=0; this.declarations=0;
  }

  requiresParameter(declaration, name) {
    if (!declaration || name === undefined) return true;
    let metadata=this.parameters.get(declaration);
    if (!metadata || metadata.generics!==declaration.generics || metadata.predicates!==declaration.predicates) {
      const relaxed=new Set((declaration.generics??[]).filter(g=>g.relaxedSized || g.relaxedBounds?.length).map(g=>g.name));
      for (const predicate of declaration.predicates??[]) if (predicate.relaxedBounds?.length) relaxed.add(predicate.type);
      metadata={generics:declaration.generics,predicates:declaration.predicates,relaxed};this.parameters.set(declaration,metadata);
    }
    return !metadata.relaxed.has(name);
  }

  validateBound(modifier, declaration) {
    const {bound,span}=modifier, module=declaration.module??'';
    const parameters=new Set((declaration.generics??[]).map(g=>g.name));
    if (parameters.has(bound)) throw new Diagnostic('E0404', `Expected Sized trait, found type parameter ${bound}`,span);
    const named=this.index.typeResolver.find(this.index.traits,bound,module,{span});
    if (named) throw new Diagnostic('F_RELAXED_BOUND','A relaxed bound may only name the compiler-owned Sized trait',span);
    const candidates=this.index.candidates(bound,module);
    if (candidates.some(name=>sizedPaths.has(name))) { this.relaxations++; return; }
    if (candidates.some(name=>builtinBounds.has(name) || /^(?:std|core)::(?:marker::(?:Copy|Sized|Send|Sync|Unpin)|clone::Clone|fmt::(?:Debug|Display)|cmp::(?:PartialEq|Eq|PartialOrd|Ord)|default::Default)$/.test(name)))
      throw new Diagnostic('F_RELAXED_BOUND','The ? modifier may only be applied to Sized',span);
    throw new Diagnostic('E0405',`Unknown trait '${bound}' in relaxed bound`,span);
  }

  validateRelaxations() {
    const check=(declaration, associated=false, traitDefinition=false)=>{
      const relaxed=new Map(), own=new Set((declaration.generics??[]).map(g=>g.name));
      const add=(name,modifiers)=>{
        for(const modifier of modifiers??[]) {
          this.validateBound(modifier,declaration);
          if(relaxed.has(name))throw new Diagnostic('E0203',`Duplicate relaxed Sized bounds on ${name}`,modifier.span);
          relaxed.set(name,modifier);
        }
      };
      for(const generic of declaration.generics??[])add(generic.name,generic.relaxedBounds);
      for(const predicate of declaration.predicates??[])if(predicate.relaxedBounds?.length) {
        if(!own.has(predicate.type))throw new Diagnostic('F_RELAXED_POSITION','A where-clause relaxation must name a type parameter declared by this item',predicate.span);
        add(predicate.type,predicate.relaxedBounds);
      }
      if(associated && declaration.relaxedBounds?.length) {
        if(!traitDefinition)throw new Diagnostic('F_RELAXED_POSITION','Associated implementation definitions cannot add relaxed bounds',declaration.span);
        add('Self::'+declaration.localName,declaration.relaxedBounds);
      }
      if((declaration.bounds??[]).some(bound=>bound.startsWith('?')))
        throw new Diagnostic('F_RELAXED_POSITION','Relaxed bounds are not allowed in supertrait bounds',declaration.span);
    };
    for(const declaration of [...this.index.structs.values(),...this.index.enums.values(),...this.index.aliases.values()])check(declaration);
    for(const fn of this.index.functions.values())if(fn.implIndex===undefined)check(fn);
    for(const impl of this.index.impls) {
      check(impl);
      for(const method of impl.methods)check({...method,module:impl.module});
      for(const item of impl.associatedTypes)check(item,true,false);
    }
    for(const trait of this.index.traits.values()) {
      check(trait);
      for(const method of trait.methods)check(method);
      for(const item of trait.associatedTypes)check(item,true,true);
    }
  }

  /** Structural part of a Sized proof. The caller supplies declaration evidence
   * for children; it must never substitute runtime Copy/Sized privileges for an
   * unresolved parameter. Active storage edges are unwound even on budget failure.
   * No result is memoized across mutable obligation-building phases. */
  structural(type, prove, parameters=new Set(), node=null) {
    if (++this.queries>this.maxQueries || type.length>this.maxTypeCharacters || this.active.size>this.maxDepth)
      throw new Diagnostic('F_SIZED_LIMIT','Sized storage proof budget exceeded',node?.span);
    if(T.reference(type)||T.function(type)||T.numeric(type)||['bool','char','String','!'].includes(type))return true;
    if(type==='str')return false;
    if(this.active.has(type))throw new Diagnostic('E0072',`Recursive storage type ${type} has infinite size`,node?.span);
    this.active.add(type);
    try {
      const tuple=T.tuple(type),array=T.array(type);
      if(tuple||array)return (tuple??[array.element]).every(prove);
      const {name,args}=T.application(type),shape=this.index.structs.get(name)??this.index.enums.get(name);
      if(parameters.has(name))return false;
      if(name==='Vec'||shape?.builtin==='phantom')return true;
      if(!shape)return false;
      const mapping=new Map(shape.generics.map((g,i)=>[g.name,args[i]]));
      const fields=shape.fields?.map(field=>field.type)??shape.variants.flatMap(variant=>variant.fields);
      for(const raw of fields) {
        this.fields++;
        if(!prove(this.index.instantiatedType(raw,shape,mapping,node??shape,parameters)))return false;
      }
      return true;
    } finally { this.active.delete(type); }
  }

  /** Canonical concrete annotations and instantiated nominal uses. Unknown
   * inference holes are checked once inferred, not guessed to satisfy bounds. */
  checkConcrete(type, analyzer, node) {
    if (/\b_\b/.test(type) || type.startsWith('impl ')) return;
    if (this.concrete.has(type)) return;
    const declaration={kind:'concreteTypeUse',module:'',generics:[],predicates:[],span:node?.span};
    const env=new ImplObligations(analyzer,{target:null,impl:declaration},declaration);
    env.validateCanonical(type,node??declaration);
    if(this.index.traits.has(T.application(type).name))env.validateTraitArguments(type,node??declaration);
    if (this.maxEntries && type.length <= this.maxCharacters) {
      while (this.concrete.size && (this.concrete.size >= this.maxEntries || this.characters + type.length > this.maxCharacters)) {
        const first=this.concrete.values().next().value;
        this.characters-=first.length; this.concrete.delete(first);
      }
      this.concrete.add(type); this.characters+=type.length;
    }
  }

  validateDefinitions(analyzer) {
    const environment=declaration=>{
      const names=(declaration.generics??[]).map(g=>g.name);
      const target=declaration.kind==='struct'||declaration.kind==='enum'
        ? T.traitName(declaration.name,names) : declaration.owner??null;
      return new ImplObligations(analyzer,{target,impl:declaration},declaration);
    };
    for(const shape of [...this.index.structs.values(),...this.index.enums.values()]) {
      if(shape.builtin)continue;
      const env=environment(shape);this.declarations++;
      const fields=shape.fields?.map(field=>({type:field.type,node:field}))??shape.variants.flatMap(variant=>variant.fields.map((type,i)=>({type,node:variant.members?.[i]??variant})));
      for(const [i,field] of fields.entries()) {
        const type=env.normalize(field.type,{...field.node,typeContext:shape});
        env.validateCanonical(type,field.node);
        if(!shape.fields || i<fields.length-1)env.requireSized(type,field.node);
      }
      // Even an unsized tail may not recursively contain itself without an
      // indirection. The result may be false; a recursive storage edge is an error.
      env.prove(env.entry.target,'core::marker::Sized');
      for(const boundSet of env.assumptions.values())for(const bound of boundSet)env.validateTraitArguments(bound,shape);
    }
    for(const fn of this.index.functions.values()) {
      if(fn.implIndex!==undefined)continue; // Impl/default bodies have their own declaration environment.
      const env=environment(fn);this.declarations++;
      for(const raw of [...fn.params.map(p=>p.type),fn.returnType]) {
        if(raw.startsWith('impl '))continue;
        const type=env.normalize(raw,fn);
        this.index.typeResolver.validateKnown(type,env.parameters,fn);
        env.validateCanonical(type,fn);
        if(fn.body)env.requireSized(type,fn);
      }
      for(const boundSet of env.assumptions.values())for(const bound of boundSet)env.validateTraitArguments(bound,fn);
    }
    for(const constant of this.index.constants.values()) {
      const env=environment({...constant,generics:[],predicates:[]});
      const type=env.normalize(constant.type,constant);
      env.validateCanonical(type,constant);env.requireSized(type,constant);
    }
  }

  snapshot() { return {queries:this.queries,storageFields:this.fields,relaxedBounds:this.relaxations,checkedDeclarations:this.declarations,cachedTypes:this.concrete.size,cachedCharacters:this.characters}; }
}
