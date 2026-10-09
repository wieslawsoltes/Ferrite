import {Runtime} from './Runtime.js';

/** Host value ABI for WebAssemblyEmitter. Native Wasm owns calls and CFG execution. */
export class WebAssemblyRuntime {
  constructor(binary, options={}) {
    const bytes=binary.bytes??binary;
    this.module = binary instanceof WebAssembly.Module ? binary : new WebAssembly.Module(Array.isArray(bytes)?new Uint8Array(bytes):bytes);
    const sections=WebAssembly.Module.customSections(this.module,'ferrite.abi');
    if(sections.length!==1||sections[0].byteLength>24_000_000)throw Error('Missing or oversized Ferrite WebAssembly ABI');
    this.metadata=JSON.parse(new TextDecoder().decode(sections[0]));
    if(this.metadata.version!==1||this.metadata.abi!=='externref-checked-host-v1'||!Array.isArray(this.metadata.imports))throw Error('Unsupported Ferrite WebAssembly ABI');
    this.options=options;this.runtime=new Runtime(options);
    const imports=Object.create(null);
    for(const spec of this.metadata.imports)imports[spec.importName]=this.host(spec);
    this.instance=new WebAssembly.Instance(this.module,{ferrite:imports});
  }
  reference(spec,frame,indices){
    if(!Array.isArray(frame)||!Number.isSafeInteger(spec.slot)||spec.slot<0||spec.slot>=frame.length)this.runtime.fail('Invalid Wasm reference frame');
    return this.runtime.reference(frame,spec.slot,spec.path.map(part=>part.kind==='index'?{kind:'index',value:indices[part.argument]}:part));
  }
  host(spec){
    const r=this.runtime;
    switch(spec.op){
      case 'enter':return ()=>r.enter();
      case 'leave':return ()=>r.leave();
      case 'cells':return count=>{if(!Number.isInteger(count)||count<0||count>1_000_000)r.fail('Invalid Wasm cell count');return r.cells(count);};
      case 'set':return (frame,slot,value)=>{if(!Array.isArray(frame)||!Number.isInteger(slot)||slot<0||slot>=frame.length)r.fail('Invalid Wasm register');frame[slot].value=value;};
      case 'tick':return index=>{if(!Number.isInteger(index)||index<0||index>=this.metadata.spans.length)r.fail('Invalid Wasm source position');r.tick(this.metadata.spans[index]);};
      case 'truth':return value=>{if(typeof value!=='boolean')r.fail('WebAssembly branch requires bool');return value?1:0;};
      case 'clone':return value=>r.clone(value);
      case 'function':return ()=>r.functionPointer(spec.target,spec.type);
      case 'callIndirect':return (value,...args)=>{
        const target=r.functionTarget(value,spec.type),fn=this.metadata.functions.find(f=>f.name===target);
        if(!fn||`fn(${fn.parameterTypes?.join(',')})->${fn.returnType}`!==spec.type||args.length!==fn.params||typeof this.instance.exports[target]!=='function')r.fail('Invalid Wasm indirect target','R_CALL');
        return this.instance.exports[target](...args);
      };
      case 'literal':return ()=>r.literal(spec.value,spec.type);
      case 'borrow':return (frame,...indices)=>this.reference(spec.place,frame,indices);
      case 'read':return (frame,...indices)=>r.read(this.reference(spec.place,frame,indices),spec.copy);
      case 'write':return (frame,value,...indices)=>r.write(this.reference(spec.place,frame,indices),value);
      case 'binary':return (left,right)=>r.binary(spec.operator,left,right,spec.type);
      case 'unary':return value=>r.unary(spec.operator,value,spec.type);
      case 'discriminant':return value=>r.discriminant(value,spec.table);
      case 'cast':return value=>r.cast(value,spec.type);
      case 'aggregate':return (...values)=>r.aggregate(spec.form,values,spec.names,spec.tag);
      case 'aggregate_frame': {
        if(!Array.isArray(spec.slots)||spec.slots.length>100000||spec.slots.some(slot=>!Number.isInteger(slot)||slot<0))
          throw Error('Invalid Wasm aggregate register list');
        const slots=spec.slots.slice();
        return frame=>{
          if(!Array.isArray(frame))r.fail('Invalid Wasm aggregate frame');
          const values=new Array(slots.length);
          for(let i=0;i<slots.length;i++){
            const cell=frame[slots[i]];
            if(slots[i]>=frame.length||cell===null||typeof cell!=='object'||!Object.hasOwn(cell,'value'))r.fail('Invalid Wasm aggregate register');
            if(cell.value===undefined)r.fail('Uninitialized Wasm aggregate register','R_UNINITIALIZED');
            values[i]=cell.value;
          }
          // Snapshot evaluated payloads, never retain the mutable activation frame.
          return r.aggregate(spec.form,values,spec.names,spec.tag);
        };
      }
      case 'repeat':return value=>{if(!Number.isInteger(spec.count)||spec.count<0||spec.count>100000)r.fail('Invalid array repetition size');return Array.from({length:spec.count},()=>r.clone(value));};
      case 'get':return (value,index)=>r.get(value,spec.index?index:spec.field,spec.index,spec.deref,spec.copy);
      case 'tag':return value=>value.tag;
      case 'payload':return value=>value.values[spec.index];
      case 'builtin':return (receiver,...args)=>r.builtin(spec.name,args,{format:spec.format,receiver,receiverReference:spec.receiverReference,receiverDeref:spec.receiverDeref});
      default:throw Error(`Unknown WebAssembly host operation ${spec.op}`);
    }
  }
  run({entry=this.metadata.entry,args=[]}={}){
    const fn=this.metadata.functions.find(f=>f.name===entry);
    if(!fn||typeof this.instance.exports[entry]!=='function')throw Error(`Missing WebAssembly entry ${entry}`);
    if(args.length!==fn.params)throw Error(`WebAssembly entry ${entry} expects ${fn.params} arguments`);
    try{
      const value=this.instance.exports[entry](...args);
      return {done:true,steps:this.runtime.steps,output:this.runtime.output,result:this.runtime.debug(value),value};
    }finally{this.runtime.depth=0;}
  }
}
