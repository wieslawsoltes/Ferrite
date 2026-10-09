import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {LiteralValue} from '../src/compiler/LiteralValue.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {floatCases, floatPanicCases, floatCompileFailCases} from './fixtures/float-conformance.js';

function backends(source, optimize) {
  const result = compile(source, {optimize});
  // Exercise the serialized MIR wire format as well as the Wasm ABI section.
  const mir = JSON.parse(JSON.stringify(result.optimizedMir));
  return [
    () => new MirVirtualMachine(mir, {entry: result.entry}).run().output,
    () => new WebAssemblyRuntime(result.wasm.bytes).run().output,
    () => { let output; vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 2000}); return output; },
  ];
}
for (const [name, source, output] of floatCases) test(name, () => {
  for (const optimize of [false, true]) for (const run of backends(source, optimize)) assert.equal(run(), output);
});
for (const [name, source, code] of floatPanicCases) test(name, () => {
  for (const optimize of [false, true]) for (const run of backends(source, optimize)) assert.throws(run, error => error.code === code);
});
for (const [name, source] of floatCompileFailCases) test(name, () => {
  assert.throws(() => compile(source), error => error.code === 'E0308');
});
test('literal encoding roundtrips IEEE special values and never aliases their keys', () => {
  const runtime = new Runtime(), values = [NaN, Infinity, -Infinity, -0, 0];
  const encoded = values.map(value => JSON.stringify(LiteralValue.encode(value)));
  assert.equal(new Set(encoded).size, values.length);
  values.forEach((value, index) => assert.ok(Object.is(runtime.literal(JSON.parse(encoded[index]), 'f64'), value)));
});
test('assertion equality is structural and does not use display truncation', () => {
  const runtime = new Runtime();
  const deep = value => { for (let i = 0; i < 20; i++) value = [value]; return value; };
  assert.equal(runtime.equal(deep(1n), deep(2n)), false);
  const same = [NaN]; assert.equal(runtime.equal(same, same), false);
  assert.equal(runtime.equal([0, {v: -0}], [-0, {v: 0}]), true);
});
