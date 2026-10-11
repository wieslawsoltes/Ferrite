import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {associatedBindingCases, associatedBindingCompileFailCases} from './fixtures/associated-bindings.js';

for (const [name, source, output] of associatedBindingCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(compiled.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of associatedBindingCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, `${error.message}\n${error.stack}`);
    return true;
  });
});

test('associated binding labels are not generic substitution targets', async () => {
  const {TypeSystem: T} = await import('../src/compiler/TypeSystem.js');
  assert.equal(T.substitute('A<Item=Item>', new Map([['Item', 'i32']])), 'A<Item=i32>');
  assert.equal(T.substitute('A<Item=Vec<Item>>', new Map([['Item', 'bool']])), 'A<Item=Vec<bool>>');
  assert.equal(T.substitute('<T as A>::Item', new Map([['T', 'S'], ['Item', 'bool']])), '<S as A>::Item');
  assert.equal(T.traitIdentity('A<bool,Item=i32>'), 'A<bool>');
  assert.deepEqual(T.traitApplication('A<fn(i32)->bool,Item=(i32,bool)>'), {
    name: 'A', args: ['fn(i32)->bool'], bindings: [{name: 'Item', type: '(i32,bool)'}]
  });
});

test('associated binding formal equations are declaration-scoped, not inferred from implementations', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const source = 'trait A{type Item;}struct S;impl A for S{type Item=bool;}fn bound<T:A<Item=i32>>(x:T::Item){}fn plain<T:A>(x:T::Item){}fn main(){}';
  const a = new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)));
  const index = a.index, parameters = new Set(['T']);
  for (const name of ['bound', 'plain', 'bound', 'plain']) {
    const fn = index.functions.get(name);
    assert.equal(index.type('T::Item', '', null, parameters, fn), name === 'bound' ? 'i32' : '<T as A>::Item');
  }
  assert.equal(index.type('<S as A>::Item'), 'bool');
  assert.equal(a.implementations.traits.has('S', 'A<Item=i32>'), false);
  assert.equal(a.implementations.traits.has('S', 'A<Item=bool>'), true);
  assert.equal(index.type('T::Item', '', null, parameters, index.functions.get('bound')), 'i32');
});

test('associated binding changes invalidate real semantic query replay and recover after failure', async () => {
  const {SemanticQueryCache} = await import('../src/compiler/SemanticQueryCache.js');
  const cache = new SemanticQueryCache();
  const source = (binding = 'i32', literal = '42') => `trait A{type Item;}struct S;impl A for S{type Item=i32;}fn f<T:A<Item=${binding}>>(t:T,x:T::Item)->T::Item{x}fn main(){println!("{}",f(S,${literal}));}`;
  for (const iteration of [0, 1]) {
    cache.beginBuild(); const compiled = compile(source(), {queryCache: cache});
    assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '42\n');
    if (iteration) assert.ok(compiled.queries.hits > 0, 'must replay actual cached HIR');
  }
  cache.beginBuild(); assert.throws(() => compile(source('bool', 'true'), {queryCache: cache}), e => e.code === 'E0277');
  cache.beginBuild(); const restored = compile(source(), {queryCache: cache});
  assert.equal(new MirVirtualMachine(restored.optimizedMir, {entry: restored.entry}).run().output, '42\n');
});

test('associated binding source AST remains frozen across modes and warm compiler state', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const source = associatedBindingCases[0][1], ast = Parser.parse(Lexer.tokenize(source));
  const before = JSON.stringify(ast);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(ast);
  for (const optimize of [false, true]) {
    const compiled = compile(source, {ast, optimize});
    assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '42\n');
    assert.equal(JSON.stringify(ast), before);
  }
});

test('associated binding budgets fail explicitly and restore suppression guards', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const a = new SemanticAnalyzer(Parser.parse(Lexer.tokenize(associatedBindingCases[0][1])));
  const bindings = a.index.associatedBindings, fn = a.index.functions.get('f'), parameters = new Set(['T']);
  bindings.environments = new WeakMap(); bindings.maxEquations = 0;
  assert.throws(() => bindings.environment(parameters, fn), e => e.code === 'F_ASSOC_BINDING_LIMIT');
  assert.equal(bindings.building, 0);
  bindings.maxEquations = 4096;
  assert.equal(bindings.lookup('<T as A>::Item', parameters, fn), 'i32');
  bindings.maxQueries = 0;
  assert.throws(() => bindings.constraints('S', 'A<Item=i32>', fn), e => e.code === 'F_ASSOC_BINDING_LIMIT');
  assert.equal(bindings.building, 0);
});


test('associated bindings expose real query counters without entering executable layout types', () => {
  let inferred = 0;
  for (const [, source] of associatedBindingCases) {
    const compiled = compile(source);
    assert.equal(compiled.sem.associatedBindings.enabled, true);
    inferred += compiled.sem.associatedBindings.inferredArguments;
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (['type', 'returnType', 'pointerSignature'].includes(key) && typeof entry === 'string')
          assert.ok(!entry.includes('>::') && !entry.includes('='), `unresolved runtime type ${entry}`);
        if (typeof entry === 'object') visit(entry);
      }
    };
    visit(compiled.mir); visit(compiled.optimizedMir);
  }
  assert.ok(inferred > 0, 'exercise actual forward output inference');
});

test('alias equality evidence never refines the actual selected type or neighboring declaration', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const a = new SemanticAnalyzer(Parser.parse(Lexer.tokenize('trait A{type Item;}struct S;impl A for S{type Item=bool;}type V<T:A<Item=i32>>=T::Item;fn f<T:A<Item=i32>>(x:T::Item){}fn main(){}')));
  const parameters = new Set(['T']);
  for (let i = 0; i < 3; i++) {
    assert.equal(a.index.type('T::Item', '', null, parameters, a.index.functions.get('f')), 'i32');
    assert.equal(a.index.type('T::Item', '', null, parameters, a.index.aliases.get('V')), '<T as A>::Item');
    assert.equal(a.index.type('V<S>'), 'bool');
  }
});

test('output inference failures release active guards and do not contaminate later candidate matches', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const source = 'trait A{type Item;}struct S;struct Wrong;impl A for S{type Item=(u8,bool);}impl A for Wrong{type Item=(u8,i32);}trait B{type Out;}impl<T:A<Item=(U,bool)>,U>B for T{type Out=U;}fn main(){}';
  const a = new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source))), bindings = a.index.associatedBindings;
  assert.equal(a.implementations.traits.has('Wrong', 'B'), false);
  assert.equal(bindings.inferenceActive.size, 0);
  assert.equal(a.index.type('<S as B>::Out'), 'u8');
  assert.equal(bindings.inferenceActive.size, 0);
  assert.equal(a.implementations.traits.has('Wrong', 'B'), false);
});
