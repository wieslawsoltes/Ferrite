import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {associatedTypeCases, associatedTypeCompileFailCases, associatedTypeDiagnosticCases} from './fixtures/associated-types.js';

for (const [name, source, output] of associatedTypeCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled = compile(source, {optimize});
    const mir = JSON.parse(JSON.stringify(compiled.optimizedMir));
    assert.equal(new MirVirtualMachine(mir, {entry: compiled.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(compiled.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of [...associatedTypeCompileFailCases, ...associatedTypeDiagnosticCases]) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, `${error.message}\n${error.stack}`);
    return true;
  });
});

test('associated definitions preserve an immutable source AST and report type symbols', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const source = 'trait A{type Item;fn pass(x:Self::Item)->Self::Item{x}}struct S;impl A for S{type Item=i32;}fn main(){println!("{}",S::pass(7));}';
  const ast = Parser.parse(Lexer.tokenize(source)), before = JSON.stringify(ast);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(ast);
  for (const optimize of [false, true]) {
    const compiled = compile(source, {ast, optimize});
    assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '7\n');
    assert.equal(JSON.stringify(ast), before);
    const symbols = compiled.sem.symbols.filter(symbol => symbol.associatedType);
    assert.deepEqual(symbols.map(symbol => symbol.name), ['A::Item', '<S as A>::Item']);
    assert.ok(symbols.every(symbol => symbol.kind === 'typeAlias' && symbol.namespace === 'type' && symbol.span.start >= 0));
    assert.ok(compiled.sem.associatedTypes.queries > 0);
  }
});

test('associated type and bound edits invalidate real semantic query caches', async () => {
  const {SemanticQueryCache} = await import('../src/compiler/SemanticQueryCache.js');
  const cache = new SemanticQueryCache();
  const source = type => `trait A{type Item;}struct S;impl A for S{type Item=${type};}fn pass<T:A>(x:T::Item)->T::Item{x}fn main(){println!("{}",pass::<S>(${type === 'bool' ? 'true' : '7'}));}`;
  for (const type of ['i32', 'bool', 'u8', 'i32']) {
    cache.beginBuild();
    const cold = compile(source(type), {queryCache: cache});
    const expected = type === 'bool' ? 'true\n' : '7\n';
    assert.equal(new MirVirtualMachine(cold.optimizedMir, {entry: cold.entry}).run().output, expected);
    cache.beginBuild();
    const warm = compile(source(type), {queryCache: cache});
    assert.ok(warm.queries.hits > 0, 'test must actually replay cached queries');
    assert.equal(new MirVirtualMachine(warm.optimizedMir, {entry: warm.entry}).run().output, expected);
  }
  const sourceWithBound = bound => `trait A{type Item${bound};}struct S;impl A for S{type Item=String;}fn main(){let x:<S as A>::Item=String::from("ok");println!("{}",x);}`;
  cache.beginBuild(); compile(sourceWithBound(''), {queryCache: cache});
  cache.beginBuild(); assert.throws(() => compile(sourceWithBound(':Copy'), {queryCache: cache}), error => error.code === 'E0277');
  cache.beginBuild();
  const recovered = compile(sourceWithBound(''), {queryCache: cache});
  assert.equal(new MirVirtualMachine(recovered.optimizedMir, {entry: recovered.entry}).run().output, 'ok\n');
});

test('successful projection memo is bounded and trait-qualified; failed queries release guards', async () => {
  const {Lexer} = await import('../src/compiler/Lexer.js');
  const {Parser} = await import('../src/compiler/Parser.js');
  const {SemanticAnalyzer} = await import('../src/compiler/SemanticAnalyzer.js');
  const source = 'trait A{type Item;}trait B{type Item;}struct S;impl A for S{type Item=i32;}impl B for S{type Item=bool;}fn main(){}';
  const analyzer = new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)));
  const resolver = analyzer.index.associatedTypes;
  resolver.cache.clear(); resolver.characters = 0; resolver.maxEntries = 1; resolver.maxCharacters = 64;
  const type = trait => resolver.reduce('S', trait, 'Item', new Set(), analyzer.index.traits.get(trait));
  for (const [trait, expected] of [['A', 'i32'], ['B', 'bool'], ['A', 'i32']]) {
    assert.equal(type(trait), expected);
    assert.equal(type(trait), expected);
    assert.equal(resolver.cache.size, 1);
    assert.equal(resolver.characters, [...resolver.cache].reduce((n, [key, value]) => n + key.length + value.length, 0));
  }
  resolver.cache.clear(); resolver.characters = 0; resolver.maxDepth = 0;
  assert.throws(() => type('A'), error => error.code === 'F_ASSOC_TYPE_LIMIT');
  assert.equal(resolver.active.size, 0);
  resolver.maxDepth = 64;
  assert.equal(type('A'), 'i32');
});

test('finite but excessive associated-type expansion stops with a controlled diagnostic', () => {
  const source = 'trait A{type Item;}' + Array.from({length: 72}, (_, i) =>
    `struct S${i};impl A for S${i}{type Item=${i === 71 ? 'i32' : `<S${i + 1} as A>::Item`};}`).join('') + 'fn main(){}';
  assert.throws(() => compile(source), error => error.code === 'F_ASSOC_TYPE_LIMIT');
});

test('type projections remain metadata and never become runtime layout types', () => {
  for (const [, source] of associatedTypeCases) {
    const compiled = compile(source);
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (['type', 'returnType', 'pointerSignature'].includes(key) && typeof entry === 'string')
          assert.ok(!entry.includes('>::'), `unresolved executable type ${entry}`);
        if (typeof entry === 'object') visit(entry);
      }
    };
    visit(compiled.mir); visit(compiled.optimizedMir);
  }
});

// These are valid language features intentionally outside this increment. They
// are NOT exported as rustc compile-fail fixtures or counted as native conformance.
for (const [name, source, code] of [
  ['generic associated type binders', 'trait A{type Item<T>;}fn main(){}', 'F_ASSOC_GENERIC'],
  ['associated type bound arguments', 'trait A{type Item;}fn f<T:A<Item:Copy>>(x:T){}fn main(){}', 'F_ASSOC_BINDING'],
  ['symbolic projection equations in implementation heads', 'trait A{type Item;}trait B<T>{}struct H<T>(T);impl<T:A>B<T> for H<T::Item>{}fn main(){}', 'F_ASSOC_IMPL_HEAD'],
]) test(`explicit continuation boundary: ${name}`, () => {
  assert.throws(() => compile(source), error => error.code === code);
});

test('associated struct mismatches retain field context after deferred inference', () => {
  const declarations = 'trait A{type Item;}struct S;impl A for S{type Item=bool;}struct H<T:A>{value:T::Item,owner:T}';
  for (const fields of ['value:7,owner:S', 'owner:S,value:7'])
    assert.throws(() => compile(declarations + `fn main(){let x=H{${fields}};}`), error =>
      error.code === 'E0308' && /Field H.value expects bool, got i32/.test(error.message));
});
