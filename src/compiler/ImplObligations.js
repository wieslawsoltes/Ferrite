import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';

const builtin = new Set(['Copy','Clone','Debug','Display','PartialEq','Eq','PartialOrd','Ord','Sized','Send','Sync','Unpin','Default']);
const supers = {Copy:['Clone'],Eq:['PartialEq'],PartialOrd:['PartialEq'],Ord:['Eq','PartialOrd','PartialEq']};

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
    return this.index.type(type,this.declaration.module,this.entry.target,this.parameters,node);
  }
  trait(raw,module=this.declaration.module,node=this.declaration) {
    const found=this.index.resolve(this.index.traits,raw,module,node,false);
    if(found){this.index.visible(found,module,node);return found.name;}
    const name=raw.split('::').at(-1);
    if(builtin.has(name) && (raw===name || /^(std|core)::/.test(raw)))return name;
    if(/^(Fn|FnMut|FnOnce)\(/.test(raw))return this.normalize(raw,node);
    throw new Diagnostic('E0405',`Unknown trait '${raw}' in implementation bound`,node.span??this.declaration.span);
  }
  symbolic(type) {
    if(this.parameters.has(type))return true;
    if(T.reference(type))return this.symbolic(T.target(type));
    const fn=T.function(type);if(fn)return [...fn.params,fn.result].some(t=>this.symbolic(t));
    const tuple=T.tuple(type);if(tuple)return tuple.some(t=>this.symbolic(t));
    const array=T.array(type);if(array)return this.symbolic(array.element);
    return T.application(type).args.some(t=>this.symbolic(t));
  }
  assume(rawType,rawBound,node) {
    const type=this.normalize(rawType,node),bound=this.trait(rawBound,this.declaration.module,node);
    if((!this.index.traits.has(bound) && type.startsWith('&mut ') && ['Copy','Clone'].includes(bound)) || !this.symbolic(type) && !this.prove(type,bound))
      throw new Diagnostic('E0277',`Implementation has an unsatisfied bound: ${type}: ${bound}`,node.span??this.declaration.span);
    if(!this.assumptions.has(type))this.assumptions.set(type,new Set());
    const set=this.assumptions.get(type),pending=[bound];
    while(pending.length){const next=pending.pop();if(set.has(next))continue;set.add(next);if(!this.index.traits.has(next))pending.push(...(supers[next]??[]));}
  }
  prove(type,bound,depth=0) {
    if(++this.visits>65536 || depth>64)throw new Diagnostic('F_IMPL_BOUND_LIMIT','Implementation obligation budget exceeded',this.declaration.span);
    if(this.assumptions.get(type)?.has(bound))return true;
    // All parsed type parameters are implicitly Sized; ?Sized is not parsed.
    if(this.index.traits.has(bound))return this.symbolic(type)?this.a.implementations.traits.prove(type,bound,this,depth):this.a.hasBound(type,bound);
    if(bound==='Sized')return type!=='str';
    if(!this.symbolic(type))return this.a.hasTrait(type,bound);
    if(this.parameters.has(type))return false;
    if(T.function(type))return ['Copy','Clone','Send','Sync','Unpin','PartialEq','Eq'].includes(bound);
    if(T.reference(type)) {
      if(['Copy','Clone'].includes(bound))return !type.startsWith('&mut ');
      return ['Debug','Display','PartialEq','Eq','PartialOrd','Ord'].includes(bound) && this.prove(T.target(type),bound,depth+1);
    }
    const tuple=T.tuple(type),array=T.array(type);
    if(tuple||array)return ['Copy','Clone','Debug','PartialEq','Eq','PartialOrd','Ord'].includes(bound) &&
      (tuple??[array.element]).every(t=>this.prove(t,bound,depth+1));
    const {name,args}=T.application(type),shape=this.index.structs.get(name)??this.index.enums.get(name);
    if(['Option','Result','Vec'].includes(name))return ['Clone','Debug','PartialEq','Eq','PartialOrd','Ord',...(name==='Vec'?[]:['Copy'])].includes(bound) && args.every(t=>this.prove(t,bound,depth+1));
    if(shape?.attributes?.some(attribute=>attribute.name==='derive'&&attribute.args.includes(bound))) {
      if(!args.every(t=>this.prove(t,bound,depth+1)))return false;
      const map=new Map(shape.generics.map((g,i)=>[g.name,args[i]]));
      const fields=shape.fields?.map(field=>field.type)??shape.variants.flatMap(v=>v.fields);
      return fields.every(field=>this.prove(this.index.type(T.substitute(field,map),shape.module,type,this.parameters,shape),bound,depth+1));
    }
    return false;
  }
  validate(raw,node=this.declaration) {
    const type=this.normalize(raw,node);
    if(this.checked.has(type))return;
    this.checked.add(type);
    if(++this.visits>65536)throw new Diagnostic('F_IMPL_BOUND_LIMIT','Implementation obligation budget exceeded',node.span);
    if(T.reference(type))return this.validate(T.target(type),node);
    const fn=T.function(type);if(fn){[...fn.params,fn.result].forEach(t=>this.validate(t,node));return;}
    const tuple=T.tuple(type);if(tuple){tuple.forEach(t=>this.validate(t,node));return;}
    const array=T.array(type);if(array)return this.validate(array.element,node);
    const {name,args}=T.application(type),shape=this.index.structs.get(name)??this.index.enums.get(name);
    if(this.parameters.has(name)&&args.length)throw new Diagnostic('E0109',`Type parameter ${name} does not accept type arguments`,node.span);
    args.forEach(t=>this.validate(t,node));
    if(!shape)return;
    const substitution=new Map(shape.generics.map((g,i)=>[g.name,args[i]]));
    const required=[];
    for(const generic of shape.generics)for(const bound of generic.bounds)required.push([substitution.get(generic.name),bound]);
    for(const predicate of shape.predicates??[])for(const bound of predicate.bounds)required.push([T.substitute(predicate.type,substitution),bound]);
    for(const [subject,rawBound] of required) {
      const actual=this.index.type(subject,shape.module,type,this.parameters,node);
      const bound=this.trait(T.substitute(rawBound,substitution),shape.module,node);
      if(!this.prove(actual,bound))throw new Diagnostic('E0277',`Missing declaration bound: ${actual}: ${bound}`,node.span??this.declaration.span,
        [{message:'Required by this nominal declaration',span:shape.span}]);
    }
  }
}
