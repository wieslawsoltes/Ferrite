import {LiteralValue} from '../LiteralValue.js';
import {WasmBinaryWriter as Writer} from './WasmBinaryWriter.js';
import {MirVerifier} from '../MirVerifier.js';

/**
 * MIR -> real WebAssembly functions and br_table dispatchers. Values use externref
 * and explicit checked host operations; this is not a freestanding native ABI.
 */
export class WebAssemblyEmitter {
  static types = {i32: 0x7f, externref: 0x6f};
  // JS WebAssembly engines cap function parameters; large aggregates use a
  // fixed-arity frame import instead of encoding their width in a signature.
  static directAggregateLimit = 256;
  constructor(functions, {entry = 'main<>'} = {}) {
    this.functions = functions; this.entry = entry; this.imports = []; this.importKeys = new Map();
    this.signatures = []; this.signatureKeys = new Map(); this.spans = []; this.mappings = [];
    this.indices = new Map(functions.map((fn, index) => [fn.instance, index]));
  }
  signature(params, result) {
    const key = JSON.stringify([params, result]);
    if (!this.signatureKeys.has(key)) { this.signatureKeys.set(key, this.signatures.length); this.signatures.push({params, result}); }
    return this.signatureKeys.get(key);
  }
  host(spec, count, result = 'externref', params = null) {
    const descriptor = {...spec, params: params ?? Array(count).fill('externref'), result};
    const key = JSON.stringify(descriptor);
    if (!this.importKeys.has(key)) {
      if (this.frozen) throw Error('WebAssembly imports changed after layout');
      const index = this.imports.length;
      this.importKeys.set(key, index); this.imports.push({...descriptor, importName: `h${index}`, signature: this.signature(descriptor.params, result)});
    }
    return this.importKeys.get(key);
  }
  place(place) {
    let n = 0;
    return {slot: place.slot, path: place.path.map(part => part.kind === 'index' ? {kind: 'index', argument: n++} : part)};
  }
  descriptor(i) {
    switch (i.op) {
      case 'const': return [{op:'literal', value:LiteralValue.encode(i.value), type:i.type},0];
      case 'read': case 'borrow': return [{op:i.op,place:this.place(i.place),copy:!!i.copy},1+i.place.path.filter(p=>p.kind==='index').length];
      case 'write': return [{op:'write',place:this.place(i.place)},2+i.place.path.filter(p=>p.kind==='index').length,null];
      case 'binary': return [{op:'binary',operator:i.operator,type:i.operandType},2];
      case 'unary': return [{op:'unary',operator:i.operator,type:i.type},1];
      case 'cast': return [{op:'cast',type:i.targetType},1];
      case 'aggregate': {
        const spec={op:'aggregate',form:i.form,names:i.names??[],tag:i.tag??null};
        return i.values.length > WebAssemblyEmitter.directAggregateLimit
          ? [{...spec,op:'aggregate_frame',slots:i.values},1] : [spec,i.values.length];
      }
      case 'repeat': return [{op:'repeat',count:i.count},1];
      case 'get': return [{op:'get',field:i.field??null,index:i.index!=null,deref:!!i.deref,copy:!!i.copy},i.index!=null?2:1];
      case 'tag': return [{op:'tag'},1];
      case 'payload': return [{op:'payload',index:i.index},1];
      case 'builtin': return [{op:'builtin',name:i.name,format:i.format??null,receiverReference:!!i.receiverPlace,receiverDeref:!!i.receiverDeref},1+i.args.length];
      default: throw Error(`No WebAssembly lowering for ${i.op}`);
    }
  }
  build() {
    MirVerifier.verify(this.functions);
    this.enter = this.host({op:'enter'},0,null); this.leave = this.host({op:'leave'},0,null);
    this.cells = this.host({op:'cells'},1,'externref',['i32']);
    this.set = this.host({op:'set'},3,null,['externref','i32','externref']);
    this.tick = this.host({op:'tick'},1,null,['i32']); this.truth = this.host({op:'truth'},1,'i32');
    this.clone = this.host({op:'clone'},1);
    for (const fn of this.functions) for (const block of fn.blocks) for (const i of block.instructions) {
      if (!['call','copy'].includes(i.op)) this.host(...this.descriptor(i));
      if (i.receiverPlace) this.host({op:'borrow',place:this.place(i.receiverPlace),copy:false},1+i.receiverPlace.path.filter(p=>p.kind==='index').length);
    }
    const types = this.functions.map(fn=>this.signature(fn.params.map(()=>'externref'),'externref'));
    this.frozen = true;
    const module = new Writer().append([0,97,115,109,1,0,0,0]);
    module.section(1,new Writer().vector(this.signatures,(w,s)=>{
      w.byte(0x60).vector(s.params,(v,type)=>v.byte(WebAssemblyEmitter.types[type]));
      w.vector(s.result?[s.result]:[],(v,type)=>v.byte(WebAssemblyEmitter.types[type]));
    }));
    module.section(2,new Writer().vector(this.imports,(w,i)=>w.string('ferrite').string(i.importName).byte(0).u32(i.signature)));
    module.section(3,new Writer().vector(types,(w,type)=>w.u32(type)));
    module.section(7,new Writer().vector(this.functions,(w,fn)=>w.string(fn.instance).byte(0).u32(this.imports.length+this.indices.get(fn.instance))));
    const code = new Writer().u32(this.functions.length), mappings = [];
    for (const fn of this.functions) {
      const body = this.body(fn); code.u32(body.writer.length); const offset=code.length;
      mappings.push(...body.mappings.map(m=>({...m,start:m.start+offset,end:m.end+offset})));
      code.append(body.writer.bytes);
    }
    const offset=module.section(10,code);
    this.mappings=mappings.map(m=>({...m,start:m.start+offset,end:m.end+offset}));
    const metadata={version:1,entry:this.entry,abi:'externref-checked-host-v1',imports:this.imports,spans:this.spans,
      sourceMap:this.mappings,functions:this.functions.map(fn=>({name:fn.instance,params:fn.params.length,returnType:fn.returnType,span:fn.span}))};
    module.section(0,new Writer().string('ferrite.abi').append(new TextEncoder().encode(JSON.stringify(metadata))));
    const bytes=module.finish();
    if (typeof WebAssembly!=='undefined'&&!WebAssembly.validate(bytes)) throw Error('Generated WebAssembly failed binary validation');
    return {bytes,metadata};
  }
  body(fn) {
    const w=new Writer(),maps=[],argc=fn.params.length,frame=argc+fn.registers.length,pc=frame+1;
    const addressable=new Set(fn.params);
    for(const block of fn.blocks)for(const i of block.instructions){
      for(const place of [i.place,i.receiverPlace])if(place)addressable.add(place.slot);
      if(i.op==='aggregate'&&i.values.length>WebAssemblyEmitter.directAggregateLimit)
        for(const slot of i.values)addressable.add(slot);
    }
    const get=slot=>w.byte(0x20).u32(argc+slot),put=slot=>w.byte(0x21).u32(argc+slot),call=id=>w.byte(0x10).u32(id);
    const frameGet=()=>w.byte(0x20).u32(frame),constant=n=>w.byte(0x41).i32(n);
    const indices=place=>place.path.filter(p=>p.kind==='index').forEach(p=>get(p.register));
    const synchronize=slot=>{if(addressable.has(slot)){frameGet();constant(slot);get(slot);call(this.set);}};
    const tick=node=>{constant(this.spans.length);this.spans.push(node.span??null);call(this.tick);};
    const blockIndex=new Map(fn.blocks.map((block,index)=>[block.id,index]));
    // All MIR values are GC-traced externrefs. Only the dispatch index is an i32.
    w.u32(2).u32(fn.registers.length+1).byte(0x6f).u32(1).byte(0x7f);
    call(this.enter);constant(fn.registers.length);call(this.cells);w.byte(0x21).u32(frame);
    fn.params.forEach((slot,index)=>{w.byte(0x20).u32(index);put(slot);synchronize(slot);});
    constant(blockIndex.get(fn.entry));w.byte(0x21).u32(pc);
    w.byte(0x03).byte(0x40); // dispatch loop
    w.byte(0x02).byte(0x40); // invalid program counter
    for(let i=fn.blocks.length-1;i>=0;i--)w.byte(0x02).byte(0x40);
    w.byte(0x20).u32(pc).byte(0x0e).u32(fn.blocks.length);
    fn.blocks.forEach((_,i)=>w.u32(i));w.u32(fn.blocks.length);
    fn.blocks.forEach((block,index)=>{
      w.byte(0x0b); // landing pad for block[index]
      for(const i of block.instructions){
        const start=w.length;tick(i);
        if(i.op==='call') {i.args.forEach(get);call(this.imports.length+this.indices.get(i.callee));}
        else if(i.op==='copy') {get(i.value);if(i.copy)call(this.clone);put(i.target);synchronize(i.target);}
        else {
          switch(i.op){
            case 'const':break;
            case 'read':case 'borrow':frameGet();indices(i.place);break;
            case 'write':frameGet();get(i.value);indices(i.place);break;
            case 'binary':get(i.left);get(i.right);break;
            case 'aggregate':
              if(i.values.length>WebAssemblyEmitter.directAggregateLimit)frameGet();else i.values.forEach(get);
              break;
            case 'get':get(i.value);if(i.index!=null)get(i.index);break;
            case 'builtin':
              if(i.receiverPlace){frameGet();indices(i.receiverPlace);call(this.host({op:'borrow',place:this.place(i.receiverPlace),copy:false},1+i.receiverPlace.path.filter(p=>p.kind==='index').length));}
              else if(i.receiver!=null)get(i.receiver);else w.byte(0xd0).byte(0x6f);
              i.args.forEach(get);break;
            default:get(i.value);
          }
          call(this.host(...this.descriptor(i)));
        }
        if(i.dest!=null){put(i.dest);synchronize(i.dest);}
        maps.push({start,end:w.length,instruction:i.id,operation:i.op,function:fn.instance,span:i.span??fn.span,synthetic:!i.span});
      }
      const start=w.length,term=block.terminator;tick(term);
      if(term.kind==='return'){call(this.leave);get(term.value);w.byte(0x0f);}
      else if(term.kind==='unreachable')w.byte(0x00);
      else {
        if(term.kind==='goto')constant(blockIndex.get(term.target));
        else {constant(blockIndex.get(term.true));constant(blockIndex.get(term.false));get(term.condition);call(this.truth);w.byte(0x1b);}
        w.byte(0x21).u32(pc).byte(0x0c).u32(fn.blocks.length-index);
      }
      maps.push({start,end:w.length,operation:term.kind,function:fn.instance,span:term.span??fn.span,synthetic:!term.span});
    });
    w.byte(0x0b).byte(0x00).byte(0x0b).byte(0x00).byte(0x0b);
    return {writer:w,mappings:maps};
  }
}
