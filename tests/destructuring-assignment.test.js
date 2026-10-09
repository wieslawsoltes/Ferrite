import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {destructuringCases, destructuringCompileFailCases} from './fixtures/destructuring-conformance.js';

for (const [name, source, expected] of destructuringCases) test(name, () => {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    const mir = JSON.parse(JSON.stringify(result.optimizedMir));
    assert.equal(new MirVirtualMachine(mir, {entry: result.entry}).run().output, expected, 'MIR');
    assert.equal(new WebAssemblyRuntime(result.wasm.bytes).run().output, expected, 'Wasm');
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 2000});
    assert.equal(output, expected, 'JavaScript');
  }
});
for (const [name, source] of destructuringCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => /^E\d+$/.test(error.code));
});
for (const source of [
  'fn main(){let a=1;let mut r=&a;let b=2;(r,)=(&b,);println!("{}",r);}',
  'struct P{r:&i32}fn main(){let a=1;let b=2;let mut p=P{r:&a};(p,)=(P{r:&b},);}',
]) test('reference-carrying stores are an explicit boundary: '+source, () => {
  assert.throws(() => compile(source), error => error.code === 'F_ASSIGN_REFERENCE');
});
test('skipping a large rest emits no per-element projections', () => {
  const source = 'fn main(){let mut first=0;let mut last=0;[first,..,last]=[7;100000];println!("{} {}",first,last);}';
  const result = compile(source, {optimize:false});
  const instructions = result.mir.flatMap(fn => fn.blocks.flatMap(block => block.instructions));
  assert.equal(instructions.filter(i => i.op === 'get').length, 2);
  assert.ok(instructions.length < 30);
  assert.equal(new MirVirtualMachine(result.mir, {entry:result.entry,maxTrace:0}).run().output, '7 7\n');
});
