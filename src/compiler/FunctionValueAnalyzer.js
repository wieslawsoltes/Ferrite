import {Diagnostic} from './Diagnostic.js';
import {TypeSystem as T} from './TypeSystem.js';
import {ClosureAnalyzer} from './closures/ClosureAnalyzer.js';

/** Item identity and monomorphic callable inference, independent of storage spelling.
 * Function items have a zero-field value; their call target is known statically. */
export class FunctionValueAnalyzer {
  constructor(analyzer) {
    this.a=analyzer;this.index=analyzer.index;this.records=new Map();this.interned=new Map();this.aliases=new Map();this.sequence=0;this.closureAdapters=new Map();
  }
  static requiresFreshQueries(ast,index) {
    const names=new Set([...index.functions.keys(),...index.structs.keys()]);
    for(const declaration of index.enums.values())for(const variant of declaration.variants)if((variant.form??(variant.fields.length?'tuple':'unit'))==='tuple')names.add(variant.name);
    for(const imports of index.imports.values())for(const alias of imports.keys())names.add(alias);
    for(const name of [...names])names.add(name.split('::').at(-1));
    const visit=(node,parent=null,key=null)=>{
      if(!node||typeof node!=='object')return false;
      if(node.kind==='variable'&&!(parent?.kind==='call'&&key==='callee')&&names.has(node.name.split('::').at(-1)))return true;
      return Object.entries(node).some(([key,value])=>!['span','loc'].includes(key)&&(Array.isArray(value)?value.some(n=>visit(n,node,key)):visit(value,node,key)));
    };
    return visit(ast);
  }
  name() {
    let name;do{name=`__ferrite_function_item_${this.sequence++}`;}while(this.index.structs.has(name)||this.index.enums.has(name)||this.index.functions.has(name)||this.index.aliases.has(name));
    return name;
  }
  base(type){while(T.reference(type))type=T.target(type);return type;}
  get(type){return this.records.get(this.base(type));}
  canonical(type){return typeof type==='string'&&this.aliases.size?T.substitute(type,this.aliases):type;}
  create(node,definition,ctx,expected=null,prepared=null) {
    const constructor=definition.kind==='fn'?null:definition;
    const owner=constructor?.owner??definition;
    if(constructor&&constructor.form!=='tuple')throw new Diagnostic('E0533','Only tuple constructors are callable items',node.span);
    if(constructor?.kind==='struct')for(const field of owner.fields)this.index.fieldVisible(owner,field,ctx.instance.fn.module,node);
    const explicit=prepared ?? (node.ownerTypeArguments??node.typeArguments??constructor?.typeArguments??[]).map(type=>this.a.normalize(type,ctx,node));
    if(!prepared&&explicit.length&&explicit.length!==owner.generics.length)throw new Diagnostic('E0107',`Expected ${owner.generics.length} function-item type arguments`,node.span);
    const type=this.name(),record={type,definition,constructor,owner,node,ctx,explicit,
      mapping:new Map(owner.generics.map((g,i)=>[g.name,explicit[i]==='_'?null:explicit[i]??null])),signature:null,instance:null};
    this.records.set(type,record);
    this.index.structs.set(type,{kind:'struct',form:'unit',name:type,fields:[],generics:[],attributes:[],module:'',visibility:'private',span:node.span});
    node.kind='functionItem';node.itemType=type;
    const signature=this.concrete(expected)?T.function(expected)??ClosureAnalyzer.bound(expected):null;
    this.prepare(record,signature?.params??[],signature?.result,null);
    return this.canonical(type);
  }
  formals(record) {
    return record.constructor?(record.constructor.kind==='struct'?record.owner.fields.map(f=>f.type):record.constructor.variant.fields):record.owner.params.map(p=>p.type);
  }
  result(record) {
    return record.constructor?record.owner.name+(record.owner.generics.length?`<${record.owner.generics.map(g=>g.name).join(',')}>`:''):record.owner.returnType;
  }
  prepare(record,hints=[],resultHint=null,node=record.node) {
    if(record.instance){
      if(hints.length&&hints.length!==record.signature.length)throw new Diagnostic('E0061',`Callable expects ${record.signature.length} arguments`,node?.span??record.node.span);
      record.signature.forEach((type,i)=>{if(hints[i])T.unify(type,hints[i],new Map(),node??record.node);});
      if(resultHint)T.unify(resultHint,record.instance.returnType,new Map(),node??record.node);
      return record.instance;
    }
    const formals=this.formals(record),parameters=new Set(record.mapping.keys());
    if(hints.length&&hints.length!==formals.length)throw new Diagnostic('E0061',`Callable expects ${formals.length} arguments`,node?.span??record.node.span);
    const normalize=type=>record.constructor ? this.index.type(T.substitute(type,record.mapping),record.owner.module,record.owner.owner,parameters,record.node) : this.a.formal(record.owner,type,record.mapping,record.node);
    formals.forEach((type,i)=>{if(hints[i])T.unify(normalize(type),hints[i],record.mapping,node??record.node);});
    if(resultHint)T.unify(normalize(this.result(record)),resultHint,record.mapping,node??record.node);
    if([...record.mapping.values()].some(type=>!type||/\b_\b/.test(type))){
      if(node)throw new Diagnostic('E0282','Cannot infer function-item specialization; provide type arguments or callable context',node.span);
      return null;
    }
    const concrete=record.owner.generics.map(g=>record.mapping.get(g.name));
    const key=JSON.stringify([record.constructor?record.constructor.tag??record.owner.name:record.owner.name,concrete]);
    const prior=this.interned.get(key);
    if(prior){
      record.instance=prior.instance;record.signature=prior.signature;this.aliases.set(record.type,prior.type);
      this.index.aliases.set(record.type,{kind:'typeAlias',name:record.type,module:'',visibility:'private',generics:[],target:prior.type,span:record.node.span});
      this.index.typeResolver.cache.clear();this.index.typeResolver.characters=0;
      return record.instance;
    }
    record.signature=formals.map(normalize);
    let fn=record.owner;
    if(record.constructor){
      const span=record.node.span,loc=record.node.loc;
      const args=record.signature.map((type,i)=>({kind:'variable',name:`__argument${i}`,span,loc}));
      const call={kind:'call',callee:{kind:'variable',name:record.constructor.tag??record.owner.name,typeArguments:concrete,span,loc},args,span,loc};
      fn={kind:'fn',name:record.type+'::__construct',localName:'__construct',module:record.ctx.instance.fn.module,generics:[],
        params:record.signature.map((type,i)=>({kind:'param',name:`__argument${i}`,type,mutable:false,span,loc})),returnType:normalize(this.result(record)),
        body:{kind:'block',body:[],tail:call,span,loc},attributes:[],visibility:'private',span,loc,generatedFunctionItem:true,isConst:true};
      this.index.functions.set(fn.name,fn);
    }
    record.instance=this.a.instantiate(fn,record.signature,record.constructor?[]:concrete,record.node);
    this.interned.set(key,record);return record.instance;
  }
  concrete(type){if(!type||/\b_\b/.test(type))return false;try{this.index.typeResolver.validateKnown(type,new Set(),{name:'callable'});return true;}catch{return false;}}
  pointer(type){return T.function(this.base(type));}
  /** Coercion owns a typed expression wrapper, never a mutable callable environment. */
  coerce(node,actual,expected,ctx) {
    let signature=T.function(expected);if(!signature||actual==='!')return actual;
    if(!this.concrete(expected)){
      if(T.function(actual))return actual;
      const record=this.get(actual),closure=this.a.closures.get(actual);
      const instance=record?this.prepare(record,[],null,null):closure?.instance;
      if(!instance)return actual;
      signature={params:record?.signature??closure.signature,result:instance.returnType};expected=T.functionName(signature.params,signature.result);
    }
    if(actual===expected)return actual;
    if(T.reference(actual))T.mismatch(expected,actual,node);
    let target;
    const item=this.get(actual),closure=this.a.closures.get(actual);
    if(item){
      if(item.owner.attributes?.some(a=>a.name==='target_feature'))throw new Diagnostic('F_FUNCTION_ABI','Target-feature functions require a native ABI',node.span);
      const instance=this.prepare(item,signature.params,signature.result,node);target=instance.key;
      if(item.signature.length!==signature.params.length||item.signature.some((p,i)=>p!==signature.params[i]))T.mismatch(expected,actual,node);
    }else if(closure){
      if(closure.captures.length)throw new Diagnostic('E0308','Capturing closures cannot coerce to a function pointer',node.span);
      const instance=this.a.closures.prepare(closure,signature.params);
      if(closure.signature.length!==signature.params.length||instance.returnType!==signature.result)T.mismatch(expected,actual,node);
      target=this.closureAdapters.get(actual);
      if(!target){
        const span=node.span,loc=node.loc,name=this.name()+'::__closure_pointer';
        const args=signature.params.map((type,i)=>({kind:'variable',name:`__argument${i}`,span,loc}));
        const fn={kind:'fn',name,module:closure.module,generics:[],attributes:[],visibility:'private',generatedFunctionItem:true,span,loc,
          params:signature.params.map((type,i)=>({kind:'param',name:`__argument${i}`,type,mutable:false,span,loc})),returnType:signature.result,
          body:{kind:'block',body:[],tail:{kind:'call',callee:{kind:'structLiteral',name:actual,fields:[],span,loc},args,span,loc},span,loc}};
        this.index.functions.set(name,fn);target=this.a.instantiate(fn,signature.params,[],node).key;
        this.closureAdapters.set(actual,target);
      }
    }else T.mismatch(expected,actual,node);
    if(node.kind==='block'){
      if(node.tail)this.coerce(node.tail,node.tail.type,expected,ctx);
      node.type=expected;return expected;
    }
    const value={...node,type:actual,copy:this.a.hasTrait(actual,'Copy')};
    for(const key of Object.keys(node))delete node[key];
    Object.assign(node,{kind:'functionCoercion',value,pointerTarget:target,pointerSignature:expected,type:expected,copy:true,span:value.span,loc:value.loc,id:value.id});
    return expected;
  }
  join(nodes,ctx,origin) {
    const live=nodes.filter(n=>n&&n.type!=='!');if(!live.length)return '!';
    if(live.every(n=>this.canonical(n.type)===this.canonical(live[0].type)))return this.canonical(live[0].type);
    const signatureOf=node=>{
      if(T.reference(node.type))return null;
      const pointer=T.function(node.type);if(pointer)return pointer;
      const item=this.get(node.type);if(item){const i=this.prepare(item,[],null,null);return i?{params:item.signature,result:i.returnType}:null;}
      const closure=this.a.closures.get(node.type);
      if(closure&&!closure.captures.length&&closure.instance)return {params:closure.signature,result:closure.instance.returnType};
      return null;
    };
    const signature=live.map(signatureOf).find(Boolean);
    if(signature){const type=T.functionName(signature.params,signature.result);live.forEach(n=>this.coerce(n,n.type,type,ctx));return type;}
    return live.reduce((type,n)=>T.join(type,n.type,origin),'!');
  }
  callPointer(node,ctx,type) {
    const signature=this.pointer(type);
    if(node.args.length!==signature.params.length)throw new Diagnostic('E0061',`Function pointer expects ${signature.params.length} arguments`,node.span);
    node.args.forEach((arg,i)=>T.unify(signature.params[i],this.a.infer(arg,ctx,signature.params[i]),new Map(),arg));
    node.calleeValue=node.callee;node.indirect=true;node.pointerSignature=this.base(type);
    (ctx.instance.indirectCalls??=[]).push({signature:node.pointerSignature,span:node.span});
    return signature.result;
  }
  satisfies(type,bound) {
    const record=this.get(type),signature=ClosureAnalyzer.bound(bound);
    if(!signature)return false;
    const pointer=this.pointer(type);if(pointer)return pointer.params.length===signature.params.length&&pointer.params.every((p,i)=>p===signature.params[i])&&pointer.result===signature.result;
    if(!record)return false;
    if(record.owner.attributes?.some(attribute=>attribute.name==='target_feature'))return false;
    const instance=this.prepare(record,signature.params,signature.result);
    return record.signature.length===signature.params.length&&record.signature.every((t,i)=>t===signature.params[i])&&instance.returnType===signature.result;
  }
  call(node,ctx,type) {
    const record=this.get(type);if(!record)return null;
    const formals=record.signature??this.formals(record).map(t=>this.index.type(T.substitute(t,record.mapping),record.owner.module,record.owner.owner,new Set(record.mapping.keys()),node));
    if(node.args.length!==formals.length)throw new Diagnostic('E0061',`Callable expects ${formals.length} arguments`,node.span);
    const types=node.args.map((arg,i)=>this.a.infer(arg,ctx,record.mapping.has(formals[i])?null:formals[i]));
    const instance=this.prepare(record,types,null,node);
    node.calleeValue=node.callee;node.calledItemType=this.canonical(type);node.resolved=instance.key;
    ctx.instance.calls.push({to:instance.key,span:node.span,loc:node.loc});return instance.returnType;
  }
  finish(){
    for(const record of this.records.values())if(!record.instance)this.prepare(record);
    if(!this.aliases.size)return;
    const seen=new Set(),keys=new Set(['type','returnType','targetType','operandType','itemType','calledItemType','pointerSignature']);
    const walk=node=>{
      if(!node||typeof node!=='object'||seen.has(node))return;seen.add(node);
      for(const [key,value] of Object.entries(node)){
        if(keys.has(key)&&typeof value==='string')node[key]=this.canonical(value);
        else if(key==='typeArguments'&&value&&!Array.isArray(value))for(const name of Object.keys(value))value[name]=this.canonical(value[name]);
        else if(!['span','loc'].includes(key))walk(value);
      }
    };
    for(const instance of this.a.instances.values())walk(instance);
  }
  snapshot(){return [...this.interned.values()].map(r=>({type:r.type,target:r.instance.key,params:r.signature,returnType:r.instance.returnType,span:r.node.span}));}
}
