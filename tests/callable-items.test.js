import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, tokenize} from '../src/engine.js';
import {Parser} from '../src/compiler/Parser.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {callableCases, callableCompileFailCases, callablePanicCases} from './fixtures/callable-items.js';

for (const [name, source, expected] of callableCases) test(name, () => {
  for (const optimize of [false, true]) {
    const c = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)), {entry:c.entry}).run().output, expected, 'MIR');
    assert.equal(new WebAssemblyRuntime(c.wasm.bytes).run().output, expected, 'Wasm');
    let output; vm.runInNewContext(c.js, {postMessage:value => {output=value;}}, {timeout:2000});
    assert.equal(output, expected, 'JavaScript');
  }
});
for (const [name, source, code] of callableCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => error.code === code);
});
for (const [name, source, code, output] of callablePanicCases) test(name, () => {
  for (const optimize of [false, true]) {
    const c = compile(source, {optimize}), machine = new MirVirtualMachine(c.optimizedMir, {entry:c.entry});
    assert.throws(() => machine.run(), error => error.code === code); assert.equal(machine.runtime.output, output);
    const wasm = new WebAssemblyRuntime(c.wasm);
    assert.throws(() => wasm.run(), error => error.code === code); assert.equal(wasm.runtime.output, output);
    const context = vm.createContext({});
    assert.throws(() => vm.runInContext(c.js, context, {timeout:2000}), error => error.code === code);
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
