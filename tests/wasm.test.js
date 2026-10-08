import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {WebAssemblyEmitter} from '../src/compiler/wasm/WebAssemblyEmitter.js';
import {WasmBinaryWriter} from '../src/compiler/wasm/WasmBinaryWriter.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {SampleCatalog} from '../src/ui/model/SampleCatalog.js';
const binary=source=>new WebAssemblyEmitter(compile(source).optimizedMir).build();
for(const sample of SampleCatalog.projects.filter(s=>!s.native&&!s.error))test('WebAssembly sample: '+sample.name,()=>{
  let build;try{build=new CompilerSession().compile(sample.files);}catch(error){if(sample.diagnostic)return;throw error;}
  if(!build.entry)return;
  const emitted=new WebAssemblyEmitter(build.optimizedMir,{entry:build.entry}).build();
  assert(WebAssembly.validate(emitted.bytes));
  const reference=new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run();
  const actual=new WebAssemblyRuntime(emitted).run();
  assert.equal(actual.output,reference.output);assert.equal(actual.result,reference.result);assert.equal(actual.steps,reference.steps);
});
test('WebAssembly references and aliases remain coherent through direct calls and nested places',()=>{
  const code='fn change(p:&mut i32){*p+=3;} fn main(){let mut a=[1,2,3];change(&mut a[1]);let t=(a[1],a[2]);println!("{} {}",t.0,t.1);}';
  const emitted=binary(code);assert.equal(new WebAssemblyRuntime(emitted).run().output,'5 3\n');
});
test('WebAssembly byte maps identify exact source ranges and emitted modules are deterministic',()=>{
  const code='fn main(){println!("Unicode Zażółć 🚀 {}", 7);}';
  const a=binary(code),b=binary(code);assert.deepEqual(a.bytes,b.bytes);
  assert.equal(new WebAssemblyRuntime(a.bytes).run().output,'Unicode Zażółć 🚀 7\n');
  for(const item of a.metadata.sourceMap){assert(item.start<item.end&&item.end<a.bytes.length);assert.equal(a.bytes[item.start],0x41);assert(item.span.end>item.span.start);}
  assert.equal(WebAssembly.Module.customSections(new WebAssembly.Module(a.bytes),'ferrite.abi').length,1);
});
for(const [name,source,code,options] of [
 ['overflow','fn main(){let x=255u8;println!("{}",x+1u8);}','R_OVERFLOW'],
 ['division','fn main(){let x=0;println!("{}",1/x);}','R_DIV_ZERO'],
 ['bounds','fn main(){let a=[1];println!("{}",a[4]);}','R_BOUNDS'],
 ['budget','fn main(){loop{}}','R_BUDGET',{maxSteps:50}],
 ['recursion','fn f()->i32{f()} fn main(){f();}','R_STACK',{maxDepth:10}],
 ['output','fn main(){println!("123456789");}','R_OUTPUT',{maxOutput:3}]
])test('WebAssembly preserves '+name+' traps and source location',()=>{
 const artifact=binary(source),runtime=new WebAssemblyRuntime(artifact,options);
 assert.throws(()=>runtime.run(),e=>e.code===code&&e.span?.file==='src/main.rs');assert.equal(runtime.runtime.depth,0);
});
test('WebAssembly binary writer encodes unsigned and signed LEB boundaries',()=>{
 assert.deepEqual([...new WasmBinaryWriter().u32(128).finish()],[0x80,1]);
 assert.deepEqual([...new WasmBinaryWriter().i32(-1).finish()],[0x7f]);
 assert.throws(()=>new WasmBinaryWriter().u32(-1));assert.throws(()=>new WasmBinaryWriter().i32(0x80000000));
});
