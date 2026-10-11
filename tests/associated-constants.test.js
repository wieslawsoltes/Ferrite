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

test('type-only dependency MIR is verified but never executable/exportable MIR', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const {MirLowerer} = await import('../src/compiler/MirLowerer.js');
  const {MirVerifier} = await import('../src/compiler/MirVerifier.js');
  const {MirOptimizer} = await import('../src/compiler/MirOptimizer.js');
  const source = 'struct S;impl S{const A:i32=7;const B:i32=Self::A;}fn main(){}';
  const a = new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)), {mode: 'library'});
  a.constants.checkingDefinition = true;
  for (const fn of a.index.functions.values()) if (fn.associatedConstant) a.instantiate(fn, [], [], fn);
  const semantic = {instances: [...a.instances.values()]};
  assert.throws(() => MirLowerer.lower(semantic), e => e.code === 'F_MIR');
  const options = {constantReferences: a.constants.references};
  const mir = MirLowerer.lower(semantic, options);
  assert.equal(MirVerifier.verify(mir, options).status, 'verified');
  assert.throws(() => MirVerifier.verify(mir), e => e.code === 'F_MIR');
  assert.throws(() => MirOptimizer.optimize(mir), e => e.code === 'F_MIR');
  assert.throws(() => MirVerifier.verify(mir, {constantReferences: new Map()}), e => e.code === 'F_MIR');
  const forged = structuredClone(mir);
  forged.flatMap(fn => fn.blocks).flatMap(block => block.instructions).find(i => i.op === 'constantReference').key = 'forged';
  assert.throws(() => MirVerifier.verify(forged, options), e => e.code === 'F_MIR');
  const referenceFunction = mir.find(fn => fn.blocks.some(block => block.instructions.some(i => i.op === 'constantReference')));
  assert.throws(() => new MirVirtualMachine(mir, {entry: referenceFunction.instance}).run(), /Unknown MIR operation/);
});

test('unused operands obey the shared evaluation budget without executing their root', () => {
  const source = 'struct A;impl A{const N:i32={let mut n=0;while n<1000{n+=1;}n};const M:i32=Self::N;}fn main(){}';
  assert.throws(() => compile(source, {constEvaluation: {maxSteps: 16}}), e => e.code === 'F_CONST_BUDGET');
});

test('warm caches cannot reuse a concrete value as a generic independence proof', () => {
  const cache = new CompilerCache();
  const source = value => `trait A{const N:i32;}impl A for bool{const N:i32=7;}struct S<T>(T);impl<T:A>S<T>{const N:i32=${value};}fn f<T:A>(n:i32)->i32{match n{S::<T>::N=>1,_=>0}}fn main(){println!("{} {}",S::<bool>::N,f::<bool>(7));}`;
  for (const value of ['7', '7', 'T::N', '7', 'T::N']) {
    if (value === 'T::N') assert.throws(() => compile(source(value), {cache}), e => e.code === 'E0158');
    else {
      const compiled = compile(source(value), {cache});
      assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '7 1\n');
    }
  }
});
