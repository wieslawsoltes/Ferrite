import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {genericImplCases, genericImplCompileFailCases} from './fixtures/generic-impls.js';

export function outputs(compiled) {
  let output;
  vm.runInNewContext(compiled.js, {postMessage: value => {output = value;}}, {timeout: 2000});
  return [new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output,
    new WebAssemblyRuntime(compiled.wasm).run().output, output];
}
for (const [name, source, expected] of genericImplCases) test(name, () => {
  for (const optimize of [false, true]) assert.deepEqual(outputs(compile(source, {optimize})), Array(3).fill(expected));
});
for (const [name, source, code] of genericImplCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => error.code === code);
});
test('generic method reference-carrying results retain an explicit boundary', () => {
  for (const expression of ['let c=Cell(1);let _=c.borrow();', 'let f=Cell::<u32>::borrow;'])
    assert.throws(() => compile(`struct Cell<T>(T);impl<T> Cell<T>{fn borrow(&self)->&T{&self.0}}fn main(){${expression}}`), error => error.code === 'F_IMPL_REFERENCE');
});
