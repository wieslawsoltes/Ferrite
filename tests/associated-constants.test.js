import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {CompilerCache} from '../src/compiler/CompilerCache.js';
import {associatedConstantCases, associatedConstantCompileFailCases} from './fixtures/associated-constants.js';

for (const [name, source, output] of associatedConstantCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    const context = vm.createContext({}); vm.runInContext(compiled.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
    assert.ok(!compiled.mir.some(fn => fn.instance.startsWith('$const$')), 'CTFE root escaped into runtime MIR');
    assert.ok(!JSON.stringify(compiled.mir).includes('constantReference'), 'type-only constant escaped definition checking');
  }
});
for (const [name, source, code] of associatedConstantCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), e => e.code === code);
});

test('associated constant edits invalidate warm query results and preserve the AST', () => {
  const cache = new CompilerCache();
  const source = value => `struct S;impl S{const N:i32=${value};}fn main(){println!("{}",S::N);}`;
  for (const value of [7, 7, 42, 42, 7]) {
    const c = compile(source(value), {cache});
    assert.equal(new MirVirtualMachine(c.optimizedMir, {entry: c.entry}).run().output, `${value}\n`);
    const item = c.ast.items.find(item => item.kind === 'impl').methods[0];
    assert.equal(item.kind, 'const');
    assert.equal(item.value.kind, 'literal');
    assert.equal(item.value.type, '{integer}');
  }
});

test('associated evaluation consumes the shared instruction budget', () => {
  const source = 'struct A;impl A{const N:i32={let mut n=0;while n<1000{n+=1;}n};}fn main(){println!("{}",A::N);}';
  assert.throws(() => compile(source, {constEvaluation: {maxSteps: 16}}), e => e.code === 'F_CONST_BUDGET');
});
