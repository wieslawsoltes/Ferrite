import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile,parse,tokenize} from '../src/engine.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {traitHardeningCases,traitHardeningCompileFailCases} from './fixtures/trait-hardening.js';
for(const [name,source,expected] of traitHardeningCases)test(name,()=>{
  for(const optimize of [false,true]){
    const build=compile(source,{optimize});let output;
    vm.runInNewContext(build.js,{postMessage:value=>output=value},{timeout:2000});
    assert.equal(output,expected);
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(build.optimizedMir)),{entry:build.entry}).run().output,expected);
    assert.equal(new WebAssemblyRuntime(build.wasm).run().output,expected);
  }
});
for(const [name,source,code] of traitHardeningCompileFailCases)test(name,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),error=>error.code===code);
});
test('path alpha-renaming preserves immutable AST snapshots',()=>{
  const source=traitHardeningCases.find(([name])=>name==='default qualified generic path alpha renaming')[1];
  const ast=parse(tokenize(source)),snapshot=JSON.stringify(ast);
  SemanticAnalyzer.analyze(ast);SemanticAnalyzer.analyze(ast);
  assert.equal(JSON.stringify(ast),snapshot);
});
