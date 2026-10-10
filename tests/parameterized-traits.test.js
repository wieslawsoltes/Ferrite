import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {parameterizedTraitCases,parameterizedTraitCompileFailCases} from './fixtures/parameterized-traits.js';
for(const [name,source,output] of parameterizedTraitCases)test(name,()=>{
  for(const optimize of [false,true]) {
    const c=compile(source,{optimize});
    const machine=new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)),{entry:c.entry});
    assert.equal(machine.run().output,output);
    assert.equal(new WebAssemblyRuntime(c.wasm).run().output,output);
    const context=vm.createContext({});vm.runInContext(c.js,context,{timeout:3000});
    assert.equal(vm.runInContext('r.output',context),output);
  }
});
for(const [name,source,code] of parameterizedTraitCompileFailCases)test(name,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),e=>e.code===code);
});
