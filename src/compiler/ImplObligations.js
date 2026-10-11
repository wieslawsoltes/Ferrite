import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

/** Declaration-time well-formedness under explicitly stated impl/method bounds.
 * This bounded entailment check is separate from expression coercion and does
 * not infer trait bounds merely from the occurrence of a constrained nominal.
 * Generic body checking remains owned by the monomorphization pipeline. */
export class ImplObligations {
  constructor(analyzer, entry, declaration = entry.impl) {
    this.a=analyzer; this.index=analyzer.index; this.entry=entry; this.declaration=declaration;
    this.parameters=new Set((declaration.generics??[]).map(g=>g.name));
    this.assumptions=new Map(); this.checked=new Set(); this.visits=0;
    for(const generic of declaration.generics??[]) for(const bound of generic.bounds)
      this.assume(generic.name,bound,generic);
    for(const predicate of declaration.predicates??[]) {
      const type=this.normalize(predicate.type,predicate);
      this.index.typeResolver.validateKnown(type,this.parameters,{...declaration,span:predicate.span});
      for(const bound of predicate.bounds) this.assume(type,bound,predicate);
    }
  }
  normalize(type,node=this.declaration) {
    return this.index.type(type,this.declaration.module,this.entry.target,this.parameters,{...node,typeContext:this.declaration});
  }
  trait(raw,module=this.declaration.module,node=this.declaration,subject=this.entry.target) {
    return this.a.implementations.traits.hierarchy.canonical(raw,module,node,this.parameters,this.entry.target,subject);
  }
  symbolic(type) {
    if(this.parameters.has(type))return true;
    const projection=T.projection(type);if(projection)return this.symbolic(projection.self)||this.symbolic(projection.trait);
    if(T.reference(type))return this.symbolic(T.target(type));
    const fn=T.function(type);if(fn)return [...fn.params,fn.result].some(t=>this.symbolic(t));
    const tuple=T.tuple(type);if(tuple)return tuple.some(t=>this.symbolic(t));
    const array=T.array(type);if(array)return this.symbolic(array.element);
    const app=T.traitApplication(type);
    return [...app.args,...T.bindingTypes(app.bindings)].some(t=>this.symbolic(t));
  }
  assume(rawType,rawBound,node) {
    const type=this.normalize(rawType,node),bound=this.trait(this.normalize(rawBound,node),this.declaration.module,node,type);
    if(this.index.traits.has(T.application(bound).name))this.index.associatedBindings.validateArguments(bound,this.parameters,{...this.declaration,span:node.span??this.declaration.span});
    this.index.associatedBindings.constraints(type,bound,{...node,typeContext:this.declaration});
    if((!this.index.traits.has(T.application(bound).name) && type.startsWith('&mut ') && ['Copy','Clone'].includes(this.a.implementations.traits.hierarchy.builtinName(bound))) || !this.symbolic(type) && !this.symbolic(bound) && !this.prove(type,bound))
      throw new Diagnostic('E0277',`Implementation has an unsatisfied bound: ${type}: ${bound}`,node.span??this.declaration.span);
    if(!this.assumptions.has(type))this.assumptions.set(type,new Set());
    const set=this.assumptions.get(type);
    for(const implied of this.a.implementations.traits.hierarchy.closure(bound,type)) {
      if(this.index.traits.has(T.application(implied).name))this.index.associatedBindings.validateArguments(implied,this.parameters,{...this.declaration,span:node.span??this.declaration.span});
      this.index.associatedBindings.constraints(type,implied,{...node,typeContext:this.declaration});
      set.add(implied); set.add(T.traitIdentity(implied));
    }
  }
  prove(type,bound,depth=0) {
    if(++this.visits>65536 || depth>64)throw new Diagnostic('F_IMPL_BOUND_LIMIT','Implementation obligation budget exceeded',this.declaration.span);
    const graph=this.a.implementations.traits.hierarchy;
    if(this.index.traits.has(T.application(bound).name))bound=graph.completeCanonical(bound,type,this.declaration,this.parameters);
    // Recursive builtin proofs use canonical identities, never a same-named user trait.
    const short=graph.builtinName(bound);
    if(T.traitApplication(bound).bindings.length) {
      return this.prove(type,T.traitIdentity(bound),depth+1) &&
        this.index.associatedBindings.satisfies(type,bound,this.parameters,this.declaration,(type,required)=>this.prove(type,required,depth+1));
    }
    if(this.assumptions.get(type)?.has(bound))return true;
    if(this.index.associatedBindings.boundsFor(type,this.parameters,this.declaration).some(required=>graph.implies(required,bound)))return true;
    const projection=T.projection(type);
    if(projection) {
      const normalized=this.index.associatedTypes.normalize(type,this.parameters,{typeContext:this.declaration});
      if(normalized!==type)return this.prove(normalized,bound,depth+1);
      return this.index.associatedTypes.declaredBounds(projection,this.declaration,this.parameters).some(required=>
        graph.implies(graph.canonical(required,this.declaration.module,this.declaration,this.parameters,this.entry.target,type),bound));
    }
    // Ordinary parameters are implicitly Sized, unlike Self in a trait.
    if(this.index.traits.has(T.application(bound).name))return (this.symbolic(type)||this.symbolic(bound))?this.a.implementations.traits.prove(type,bound,this,depth):this.a.hasBound(type,bound);
    if(bound==='Sized'||bound==='core::marker::Sized'||bound==='std::marker::Sized') {
      if(this.parameters.has(type))return !(type==='Self'&&this.declaration.unsizedSelf);
      if(T.reference(type)||T.function(type))return true;
      const tuple=T.tuple(type),array=T.array(type);
      if(tuple||array)return (tuple??[array.element]).every(t=>this.prove(t,'core::marker::Sized',depth+1));
      const {name,args}=T.application(type);
      if(name==='Vec'||this.index.structs.has(name)||this.index.enums.has(name))
        return args.every(t=>this.prove(t,'core::marker::Sized',depth+1));
      return this.a.hasTrait(type,'core::marker::Sized');
    }
    if(!this.symbolic(type))return this.a.hasTrait(type,bound);
    const identity=bound;bound=short??bound;
    if(this.parameters.has(type))return false;
    if(T.function(type))return ['Copy','Clone','Send','Sync','Unpin','PartialEq','Eq'].includes(bound);
    if(T.reference(type)) {
      if(['Copy','Clone'].includes(bound))return !type.startsWith('&mut ');
      return ['Debug','Display','PartialEq','Eq','PartialOrd','Ord'].includes(bound) && this.prove(T.target(type),identity,depth+1);
    }
    const tuple=T.tuple(type),array=T.array(type);
    if(tuple||array)return ['Copy','Clone','Debug','PartialEq','Eq','PartialOrd','Ord'].includes(bound) &&
      (tuple??[array.element]).every(t=>this.prove(t,identity,depth+1));
    const {name,args}=T.application(type),shape=this.index.structs.get(name)??this.index.enums.get(name);
    if(['Option','Result','Vec'].includes(name))return ['Clone','Debug','PartialEq','Eq','PartialOrd','Ord',...(name==='Vec'?[]:['Copy'])].includes(bound) && args.every(t=>this.prove(t,identity,depth+1));
    if(shape?.attributes?.some(attribute=>attribute.name==='derive'&&attribute.args.includes(bound))) {
      if(!args.every(t=>this.prove(t,identity,depth+1)))return false;
      const map=new Map(shape.generics.map((g,i)=>[g.name,args[i]]));
      const fields=shape.fields?.map(field=>field.type)??shape.variants.flatMap(v=>v.fields);
      return fields.every(field=>this.prove(this.index.instantiatedType(field,shape,map,shape,this.parameters),identity,depth+1));
    }
    return false;
  }
  requireSized(type,node=this.declaration) {
    if(!this.prove(type,'core::marker::Sized'))throw new Diagnostic('E0277',
      `The size of ${type} is not known in this declaration; add a Sized bound`,node.span??this.declaration.span);
  }
  validate(raw,node=this.declaration) {
    return this.validateCanonical(this.normalize(raw,node),node);
  }
  validateCanonical(type,node=this.declaration) {
    if(this.checked.has(type))return;
    this.checked.add(type);
    if(++this.visits>65536)throw new Diagnostic('F_IMPL_BOUND_LIMIT','Implementation obligation budget exceeded',node.span);
    const projection=T.projection(type);
    if(projection) {
      this.index.associatedTypes.validateProjection(projection,this.parameters,node);
      this.validateCanonical(projection.self,node);
      for(const argument of T.application(projection.trait).args)this.validateCanonical(argument,node);
      if(!this.prove(projection.self,projection.trait))throw new Diagnostic('E0277',`Missing projection bound: ${projection.self}: ${projection.trait}`,node.span??this.declaration.span);
      return;
    }
    if(T.reference(type))return this.validateCanonical(T.target(type),node);
    const fn=T.function(type);if(fn){[...fn.params,fn.result].forEach(t=>this.validateCanonical(t,node));return;}
    const tuple=T.tuple(type);if(tuple){
      tuple.slice(0,-1).forEach(t=>this.requireSized(t,node));
      tuple.forEach(t=>this.validateCanonical(t,node));return;
    }
    const array=T.array(type);if(array){this.requireSized(array.element,node);return this.validateCanonical(array.element,node);}
    const {name,args}=T.application(type),shape=this.index.structs.get(name)??this.index.enums.get(name);
    if(this.parameters.has(name)&&args.length)throw new Diagnostic('E0109',`Type parameter ${name} does not accept type arguments`,node.span);
    args.forEach(t=>this.validateCanonical(t,node));
    if(shape||name==='Vec')args.forEach(t=>this.requireSized(t,node));
    if(!shape)return;
    const substitution=new Map(shape.generics.map((g,i)=>[g.name,args[i]]));
    const required=[];
    for(const generic of shape.generics)for(const bound of generic.bounds)required.push([generic.name,bound]);
    for(const predicate of shape.predicates??[])for(const bound of predicate.bounds)required.push([predicate.type,bound]);
    for(const [subject,rawBound] of required) {
      const actual=this.index.instantiatedType(subject,shape,substitution,node,this.parameters);
      const bound=this.trait(this.index.instantiatedType(rawBound,shape,substitution,node,this.parameters),shape.module,node,actual);
      if(!this.prove(actual,bound))throw new Diagnostic('E0277',`Missing declaration bound: ${actual}: ${bound}`,node.span??this.declaration.span,
        [{message:'Required by this nominal declaration',span:shape.span}]);
    }
  }
}
