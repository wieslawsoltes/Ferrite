import {Diagnostic} from '../Diagnostic.js';
import {TypeSystem as T} from '../TypeSystem.js';
import {CaptureWalker} from './CaptureWalker.js';

/** Lambda lifting to ordinary typed functions and explicit closure environment records. */
export class ClosureAnalyzer {
  constructor(analyzer) { this.analyzer = analyzer; this.records = new Map(); this.sequence = 0; }
  static bound(text) {
    const match = /^(Fn|FnMut|FnOnce)\((.*)\)->(.+)$/.exec(text ?? '');
    return match ? {trait: match[1], params: T.split(match[2]), result: match[3]} : null;
  }
  get(type) { return this.records.get(T.reference(type) ? T.target(type) : type); }
  create(node, ctx) {
    const compiler = this.analyzer;
    let name;do{name=[ctx.instance.fn.module,`__closure_${this.sequence++}`].filter(Boolean).join('::');}while(compiler.index.structs.has(name)||compiler.index.enums.has(name)||compiler.index.functions.has(name));
    const identifiers=JSON.stringify(node);let environmentName='__environment';
    while(identifiers.includes(JSON.stringify(environmentName)))environmentName+='_';
    const captures = new Map();
    const names = new Set(node.params.map(p => p.name));
    CaptureWalker.transform(node.body, names, (variable, use) => {
      const binding = ctx.lookup(variable.name, variable, false);
      if (!binding) return variable;
      const capture = captures.get(variable.name) ?? {name: variable.name, binding, read: false, mutate: false, consume: false};
      capture[use] = true; captures.set(variable.name, capture); return variable;
    }, 'consume');
    const fields = [], descriptions = [];
    let trait = 'Fn';
    for (const capture of captures.values()) {
      const copy = compiler.hasTrait(capture.binding.type, 'Copy');
      const consumes = capture.consume && !copy;
      const mode = node.move || consumes ? 'move' : capture.mutate ? 'mutable borrow' : 'shared borrow';
      if (consumes) trait = 'FnOnce'; else if (capture.mutate && trait === 'Fn') trait = 'FnMut';
      const variable = {kind:'variable', name:capture.name, span:node.span, loc:node.loc};
      const value = mode === 'move' ? variable : {kind:'unary', op:'&', mutable:mode==='mutable borrow', value:variable, span:node.span, loc:node.loc};
      const type = compiler.infer(value, ctx), field = `_capture${fields.length}`;
      capture.field = field; capture.mode = mode;
      fields.push({name:field, value}); descriptions.push({name:capture.name, type, mode, span:capture.binding.span});
    }
    const body = CaptureWalker.transform(node.body, names, variable => {
      const capture = captures.get(variable.name); if (!capture) return variable;
      const access = {kind:'field', object:{kind:'variable', name:environmentName, span:variable.span, loc:variable.loc}, field:capture.field, span:variable.span, loc:variable.loc};
      return capture.mode === 'move' ? access : {kind:'unary', op:'*', value:access, span:variable.span, loc:variable.loc};
    }, 'consume');
    const record = {type:name, node, trait, captures:descriptions, body, environmentName, module:ctx.instance.fn.module, ctx, instance:null, preparing:false};
    this.records.set(name, record);
    compiler.index.structs.set(name, {kind:'struct', name, fields:descriptions.map((capture,i)=>({name:`_capture${i}`,type:capture.type})),
      generics:[], attributes:[], module:ctx.instance.fn.module, visibility:'private', span:node.span});
    node.fields = fields; node.closureType = name; node.callTrait = trait; node.copy = this.copy(record);
    node.borrowCarrier = descriptions.some(c => c.mode !== 'move' || T.reference(c.type));
    if (node.params.every(p => p.type !== null)) this.prepare(record, node.params.map(p => compiler.normalize(p.type,ctx)));
    return name;
  }
  copy(record) { return record.trait !== 'FnOnce' && record.captures.every(c => this.analyzer.hasTrait(c.type,'Copy')); }
  prepare(record, hints = []) {
    if (record.instance) {
      record.signature.forEach((type,i)=>{if(hints[i])T.unify(type,hints[i],new Map(),record.node);});
      return record.instance;
    }
    if (record.preparing) throw new Diagnostic('E0644','A closure cannot recursively reference its own anonymous type',record.node.span);
    const params = record.node.params.map((param,i)=>({...param, type:param.type ? this.analyzer.normalize(param.type,record.ctx) : hints[i]}));
    if (params.some(p=>!p.type || p.type==='_')) throw new Diagnostic('E0282','Cannot infer closure parameter type; add an annotation or callable context',record.node.span);
    record.preparing = true;
    const receiver = record.trait === 'FnOnce' ? record.type : (record.trait === 'FnMut' ? '&mut ' : '&') + record.type;
    const fn = {kind:'fn', name:record.type+'::__call', localName:'__call', module:record.module, owner:record.type, generics:[],
      params:[{kind:'param',name:record.environmentName,type:receiver,mutable:true,span:record.node.span},...params],
      returnType:record.node.returnType ? this.analyzer.normalize(record.node.returnType,record.ctx) : '_',
      body:record.body.kind==='block'?record.body:{kind:'block',body:[],tail:record.body,span:record.node.span,loc:record.node.loc},
      span:record.node.span,loc:record.node.loc,attributes:[],visibility:'private',generatedClosure:true};
    this.analyzer.index.functions.set(fn.name,fn);
    record.signature=params.map(p=>p.type);record.instance=this.analyzer.instantiate(fn,[receiver,...record.signature],[],record.node);
    record.preparing=false;return record.instance;
  }
  satisfies(type, bound) {
    const record=this.get(type),signature=ClosureAnalyzer.bound(bound);
    if(!record||!signature)return false;
    if(record.trait==='FnOnce'&&signature.trait!=='FnOnce'||record.trait==='FnMut'&&signature.trait==='Fn')return false;
    const instance=this.prepare(record,signature.params);
    return record.signature.length===signature.params.length&&record.signature.every((t,i)=>t===signature.params[i])&&instance.returnType===signature.result;
  }
  call(node,ctx,type){
    const compiler=this.analyzer,record=this.get(type);
    if(!record)return null;
    const types=node.args.map((arg,i)=>compiler.infer(arg,ctx,record.signature?.[i]??record.node.params[i]?.type));
    if(types.length!==record.node.params.length)throw new Diagnostic('E0057',`Closure expects ${record.node.params.length} arguments`,node.span);
    const instance=this.prepare(record,types);
    let environment=node.callee;
    if(!['variable','field','index'].includes(environment.kind)){
      let temporary=`__temporary_closure${ctx.locals.length}`;while(ctx.lookup(temporary,node,false))temporary+='_';
      const binding=ctx.declare(temporary,type,true,node);
      node.temporaryCallee={value:environment,binding};
      environment={kind:'variable',name:binding.name,binding,type,span:node.span,loc:node.loc};
    }
    const formal=instance.fn.params[0].type;
    if(T.reference(formal)&&!T.reference(type))environment={kind:'unary',op:'&',mutable:formal.startsWith('&mut '),value:environment,span:node.span,loc:node.loc};
    compiler.infer(environment,ctx,formal);T.unify(formal,environment.type,new Map(),node);
    node.args=[environment,...node.args];node.resolved=instance.key;node.closureCall=true;
    ctx.instance.calls.push({to:instance.key,span:node.span,loc:node.loc});return instance.returnType;
  }
  finish(){for(const record of this.records.values())if(!record.instance)this.prepare(record);}
  snapshot(){return [...this.records.values()].map(r=>({type:r.type,trait:r.trait,captures:r.captures,params:r.signature,returnType:r.instance?.returnType,instance:r.instance?.key,span:r.node.span}));}
}
