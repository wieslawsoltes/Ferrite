import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {WebAssemblyEmitter} from '../src/compiler/wasm/WebAssemblyEmitter.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const values=n=>Array.from({length:n},(_,i)=>String(i)).join(',');
function compare(source,optimize){
  const c=compile(source,{optimize}),mir=new MirVirtualMachine(c.optimizedMir,{entry:c.entry}).run();
  assert(WebAssembly.validate(new Uint8Array(c.wasm.bytes)));
  const wasm=new WebAssemblyRuntime(c.wasm).run();
  assert.equal(wasm.output,mir.output);assert.equal(wasm.steps,mir.steps);assert.equal(wasm.result,mir.result);
  let output;vm.runInNewContext(c.js,{postMessage:value=>output=value},{timeout:3000});assert.equal(output,mir.output);
  assert(c.wasm.metadata.imports.every(i=>i.params.length<=WebAssemblyEmitter.directAggregateLimit));
  return c;
}
for(const width of [256,257,1000,1024])for(const optimize of [false,true])test(`Wasm array frame ABI width ${width}, optimize ${optimize}`,()=>{
  const c=compare(`fn main(){let mut a=[${values(width)}];let b=a;a[0]=99;println!("{} {} {}",a[0],b[0],b[${width-1}]);}`,optimize);
  assert.equal(c.wasm.metadata.imports.some(i=>i.op==='aggregate_frame'),width>WebAssemblyEmitter.directAggregateLimit);
});
test('wide tuple, nominal record and nested function frames preserve isolation',()=>{
  const width=1024, fields=Array.from({length:width},(_,i)=>`f${i}:i32`).join(','), init=Array.from({length:width},(_,i)=>`f${i}:${i}`).join(',');
  compare(`struct S{${fields}}fn make(n:i32)->[i32;${width}]{let mut a=[${values(width)}];a[0]=n;if n>0{let b=make(n-1);a[1]=b[0];}a}fn main(){let s=S{${init}};let t=(${values(width)});let a=make(2);println!("{} {} {} {}",s.f1023,t.1023,a[0],a[1]);}`,false);
});
test('frame ABI snapshots repeated loop aggregates before register reuse',()=>{
  const width=257;
  compare(`fn main(){let mut n=0;while n<3{let mut a=[${values(width)}];let b=a;a[0]=n;println!("{} {} {}",a[0],b[0],b[256]);n+=1;}}`,false);
});
test('wide aggregate panic effects and source span agree with the reference VM',()=>{
  const source=`fn fail()->i32{println!("rhs");panic!("stop")}fn main(){let a=[${values(1024)},fail()];println!("unreachable");}`;
  for(const optimize of [false,true]){
    const c=compile(source,{optimize}),mir=new MirVirtualMachine(c.optimizedMir,{entry:c.entry}),wasm=new WebAssemblyRuntime(c.wasm);
    assert.throws(()=>mir.run(),e=>e.code==='R_PANIC');assert.throws(()=>wasm.run(),e=>e.code==='R_PANIC'&&e.span?.file==='src/main.rs');
    assert.equal(wasm.runtime.output,'rhs\n');assert.equal(wasm.runtime.steps,mir.runtime.steps);
  }
});
test('frame aggregate metadata and register accesses are validated and snapshotted',()=>{
  const runtime=new WebAssemblyRuntime(compile('fn main(){}').wasm),spec={op:'aggregate_frame',form:'tuple',slots:[1,0]};
  for(const slots of [null,[-1],[0.5],['0']])assert.throws(()=>runtime.host({...spec,slots}),/register list/);
  const host=runtime.host(spec),frame=[{value:1n},{value:2n}];spec.slots[0]=0;
  const result=host(frame);frame[1].value=3n;assert.deepEqual(result,[2n,1n]);
  for(const invalid of [null,[],[null,null],[{},{value:1n}]])assert.throws(()=>host(invalid),e=>e.code==='RUNTIME');
  assert.throws(()=>host([{value:undefined},{value:1n}]),e=>e.code==='R_UNINITIALIZED');
});
