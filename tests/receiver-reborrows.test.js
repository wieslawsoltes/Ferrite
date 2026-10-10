import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {receiverReborrowCases,receiverReborrowCompileFailCases,receiverReborrowPanicCases} from './fixtures/receiver-reborrows.js';
for(const [name,source,expected] of receiverReborrowCases)test(name,()=>{
  for(const optimize of [false,true]){
    const build=compile(source,{optimize});let output;
    vm.runInNewContext(build.js,{postMessage:value=>output=value},{timeout:2000});
    assert.equal(output,expected);
    assert.equal(new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run().output,expected);
    assert.equal(new WebAssemblyRuntime(build.wasm).run().output,expected);
  }
});
for(const [name,source,code] of receiverReborrowCompileFailCases)test(name,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),error=>error.code===code);
});
test('receiver reservation and activation are observable in ownership results',()=>{
  const build=compile(receiverReborrowCases[7][1]);
  const events=build.ownership.find(item=>item.instance==='main<>').events.map(event=>event.kind);
  assert(events.includes('reserve mutable reborrow'));assert(events.includes('activate mutable receiver'));
  assert(events.indexOf('reserve mutable reborrow')<events.indexOf('activate mutable receiver'));
  assert(!events.includes('move'));
});
test('shared receiver specialization does not retain mutable argument type',()=>{
  const build=compile(receiverReborrowCases[2][1]);
  const method=build.mir.find(item=>item.name==='C::get' || item.key==='C::get<>');
  assert(method);assert.equal(method.registers[method.params[0]].type,'&C');
});
test('reference-carrying results and untracked receiver origins remain explicit boundaries',()=>{
  assert.throws(()=>compile('struct C;impl C{fn get(&self)->&Self{self}}fn main(){let c=C;let r=&c;let x=r.get();}'),e=>e.code==='F_IMPL_REFERENCE');
  assert.throws(()=>compile('struct C;fn identity(r:&C)->&C{r}impl C{fn get(&self)->i32{42}}fn main(){let c=C;println!("{}",identity(&c).get());}'),e=>e.code==='F_REBORROW_REFERENCE');
});
test('call-scoped loans survive cache replay and invalidation',()=>{
  const source=receiverReborrowCases[7][1];
  const files={'Cargo.toml':'[package]\nname="receiver"\nversion="0.1.0"','src/main.rs':source};
  const session=new CompilerSession(),first=session.compile(files),snapshot=JSON.stringify(first.hir);
  assert.equal(new MirVirtualMachine(session.compile(files).optimizedMir,{entry:first.entry}).run().output,'42\n');
  files['src/main.rs']=source.replace('r.set(r.get()+1)','r.set({r.set(0);42})');
  assert.throws(()=>session.compile(files),e=>e.code==='E0502');
  assert.equal(JSON.stringify(first.hir),snapshot);
});

for(const [name,source,code,expected] of receiverReborrowPanicCases)test(name,()=>{
  for(const optimize of [false,true]){
    const build=compile(source,{optimize});
    for(const runner of [new MirVirtualMachine(build.optimizedMir,{entry:build.entry}),new WebAssemblyRuntime(build.wasm)]){
      assert.throws(()=>runner.run(),e=>e.code===code);assert.equal(runner.runtime.output,expected);
    }
    const context=vm.createContext({});
    assert.throws(()=>vm.runInContext(build.js,context,{timeout:2000}),e=>e.code===code);
    assert.equal(vm.runInContext('r.output',context),expected);
  }
});
test('runtime borrow captures a location rather than a reference register',()=>{
  const runtime=new Runtime(),cells=runtime.cells(3);
  cells[0].value=20;cells[1].value=30;
  cells[2].value=runtime.borrow(runtime.reference(cells,0));
  const child=runtime.borrow(runtime.reference(cells,2,[{kind:'deref'}]));
  cells[2].value=runtime.borrow(runtime.reference(cells,1));
  runtime.write(child,42);
  assert.equal(cells[0].value,42);assert.equal(cells[1].value,30);
  assert(Object.isFrozen(child));assert(Object.isFrozen(child.path));
});
test('runtime borrow validates an unused place immediately',()=>{
  const runtime=new Runtime(),cells=runtime.cells(2);cells[0].value=[1];
  assert.throws(()=>runtime.borrow(runtime.reference(cells,0,[{kind:'index',value:1}])),e=>e.code==='R_BOUNDS');
  assert.throws(()=>runtime.borrow(runtime.reference(cells,1)),e=>e.code==='R_UNINITIALIZED');
  assert.throws(()=>runtime.borrow({__ref:true,cell:null,path:[]}),e=>e.code==='R_REFERENCE');
});

test('documented receiver example executes on each backend',()=>{
  const documentation=readFileSync(new URL('../docs/receiver-reborrows.md',import.meta.url),'utf8');
  const sources=[...documentation.matchAll(/```rust\n([\s\S]*?)```/g)].map(match=>match[1]);
  assert.equal(sources.length,1);
  for(const source of sources)for(const optimize of [false,true]){
    const build=compile(source,{optimize});let output;
    vm.runInNewContext(build.js,{postMessage:value=>output=value},{timeout:2000});
    assert.equal(output,'42\n');
    assert.equal(new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run().output,'42\n');
    assert.equal(new WebAssemblyRuntime(build.wasm).run().output,'42\n');
  }
});
