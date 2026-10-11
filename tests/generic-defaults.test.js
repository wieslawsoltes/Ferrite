import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {Parser} from '../src/compiler/Parser.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {GenericDefaults} from '../src/compiler/GenericDefaults.js';
import {DefaultArgumentInference} from '../src/compiler/DefaultArgumentInference.js';
import {TypeSystem as T} from '../src/compiler/TypeSystem.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {genericDefaultCases, genericDefaultCompileFailCases} from './fixtures/generic-defaults.js';

for (const [name, source, output] of genericDefaultCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(compiled.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of genericDefaultCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, `${error.message}\n${error.stack}`);
    return true;
  });
});


const analyzer = source => new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)));
const fixture = suffix => genericDefaultCases.find(([name]) => name.endsWith(suffix))[1];
const execute = (source, options = {}) => {
  const compiled = compile(source, options);
  return {compiled, output: new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output};
};

test('generic default AST keeps source templates and locations through all optimized backends', () => {
  const source = fixture('chain hole default'), ast = Parser.parse(Lexer.tokenize(source));
  const before = JSON.stringify(ast);
  const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } };
  freeze(ast);
  for (const optimize of [false, true]) {
    const {compiled, output} = execute(source, {ast, optimize});
    assert.equal(output, '1 2 3 4\n');
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    assert.equal(JSON.stringify(ast), before);
  }
  const generic = ast.items[0].generics[1];
  assert.equal(generic.defaultType, 'A');
  assert.ok(generic.defaultSpan.start < generic.defaultSpan.end);
});

test('default expansion resolves templates at declaration scope and substitutes simultaneously', () => {
  const a = analyzer('mod m{pub type X=u8;pub struct S<T=X,U=(T,T)>(pub T,pub U);}type X=bool;fn main(){}');
  assert.equal(a.index.type('m::S'), 'm::S<u8,(u8,u8)>');
  assert.equal(a.index.type('m::S<bool>'), 'm::S<bool,(bool,bool)>');
  assert.equal(a.index.type('m::S<bool,u16>'), 'm::S<bool,u16>');
  const defaults = a.index.genericDefaults, shape = a.index.structs.get('m::S');
  assert.deepEqual(defaults.expand(shape, ['T'], {parameters: new Set(['T'])}), ['T', '(T,T)']);
  assert.deepEqual(defaults.info(shape).generics.map(g => g.defaultType), ['X', '(T,T)']);
  assert.ok(defaults.snapshot().expandedArguments > 0);
});

test('hidden projection defaults have declaration-sensitive type cache keys', () => {
  const a = analyzer('trait A{type Item;}struct S<T:A,U=<T as A>::Item>(T,U);fn f<T:A<Item=u8>>(){}fn g<T:A<Item=bool>>(){}fn plain<T:A>(){}fn main(){}');
  const p = new Set(['T']), types = a.index.typeResolver;
  for (let iteration = 0; iteration < 4; iteration++) {
    for (const [fn, expected] of [['f','S<T,u8>'], ['g','S<T,bool>'], ['plain','S<T,<T as A>::Item>']])
      assert.equal(a.index.type('S<T>', '', null, p, a.index.functions.get(fn)), expected);
  }
  assert.ok(types.hits > 0);
  assert.equal(a.index.genericDefaults.active.size, 0);
});

test('real HIR query replay invalidates default edits and recovers after a failed default', () => {
  const cache = new SemanticQueryCache();
  const source = 'struct S<T=u8>(T);fn f(x:S)->S{x}fn main(){let x=f(S(7));println!("{}",x.0);}';
  for (const iteration of [0, 1]) {
    cache.beginBuild(); const {compiled, output} = execute(source, {queryCache: cache});
    assert.equal(output, '7\n');
    if (iteration) assert.ok(compiled.queries.hits > 0);
  }
  cache.beginBuild();
  const changed = execute(source.replace('T=u8', 'T=u16'), {queryCache: cache});
  assert.equal(changed.output, '7\n');
  assert.ok(JSON.stringify(changed.compiled.optimizedMir).includes('S<u16>'));
  assert.ok(!JSON.stringify(changed.compiled.optimizedMir).includes('S<u8>'));
  cache.beginBuild();
  assert.throws(() => compile(source.replace('T=u8','T=Missing'), {queryCache: cache}), e => e.code === 'E0412');
  cache.beginBuild(); assert.equal(execute(source, {queryCache: cache}).output, '7\n');
});

test('default Self uses predicate subjects while explicit Self remains lexical', () => {
  const source = 'trait A<R=Self>{type Item;}struct W;impl W{fn f<T:A<Item=u8>,U:A<Self,Item=bool>>() {}}fn main(){}';
  const a = analyzer(source), fn = [...a.index.functions.values()].find(fn => fn.localName === 'f');
  const scope = a.implementations.traits.hierarchy, p = new Set(['T','U']);
  assert.equal(scope.canonical('A<Item=u8>', '', fn, p, 'W', 'T'), 'A<T,Item=u8>');
  assert.equal(scope.canonical('A<Self,Item=bool>', '', fn, p, 'W', 'U'), 'A<W,Item=bool>');
  assert.notEqual(scope.canonical('A', '', fn, p, 'W', 'T'), scope.canonical('A', '', fn, p, 'W', 'U'));
});

test('default inference is constructor-local, hygienic and atomic on mismatch', () => {
  const a = analyzer('struct T;struct S<T,U=T>(T,U);fn main(){}');
  const shape = a.index.structs.get('S');
  const first = new DefaultArgumentInference(a.index, shape, ['_'], [], shape);
  first.mapping.set('T', 'u8'); first.complete();
  assert.deepEqual([...first.mapping], [['T','u8'],['U','u8']]);
  const second = new DefaultArgumentInference(a.index, shape, ['T'], [], shape);
  assert.deepEqual([...second.mapping], [['T','T'],['U','T']]);
  first.mapping.set('U', 'bool'); const before = [...first.mapping];
  assert.throws(() => first.complete(), e => e.code === 'E0308');
  assert.deepEqual([...first.mapping], before);
  assert.deepEqual([...second.mapping], [['T','T'],['U','T']]);
});

test('default expansion budgets clean up and explicit full arguments do not consume defaults', () => {
  const a = analyzer('struct S<T=(u8,u8)>(T);fn main(){}'), shape = a.index.structs.get('S');
  for (const options of [{maxQueries:0}, {maxDepth:0}, {maxCharacters:1}]) {
    const service = new GenericDefaults(a.index, options);
    assert.throws(() => service.expand(shape, []), e => e.code === 'F_GENERIC_DEFAULT_LIMIT');
    assert.equal(service.active.size, 0);
    assert.deepEqual(service.expand(shape, ['bool']), ['bool']);
    service.maxQueries = 1000; service.maxDepth = 64; service.maxCharacters = 1000;
    assert.deepEqual(service.expand(shape, []), ['(u8,u8)']);
  }
  for (const value of [-1, NaN, Infinity, 0.1]) assert.throws(() => new GenericDefaults(a.index, {maxQueries:value}), RangeError);
});

test('default cycles report source diagnostics and cannot poison another declaration', async () => {
  const {SymbolIndex} = await import('../src/compiler/SymbolIndex.js');
  const ast = Parser.parse(Lexer.tokenize('struct A<T=B>(T);struct B<T=A>(T);struct C<T=u8>(T);fn main(){}'));
  const index = new SymbolIndex(ast, {validate:false});
  assert.throws(() => index.type('A'), e => e.code === 'E0391');
  assert.equal(index.genericDefaults.active.size, 0);
  assert.equal(index.type('C'), 'C<u8>');
  assert.throws(() => index.type('B'), e => e.code === 'E0391');
  assert.equal(index.genericDefaults.active.size, 0);
});

test('defaults outside the supported grammar have explicit diagnostics', () => {
  for (const source of ['fn f<T=u8>(){}fn main(){}','struct S<T>(T);impl<T=u8>S<T>{}fn main(){}'])
    assert.throws(() => compile(source), e => e.code === 'F_GENERIC_DEFAULT_POSITION');
  assert.throws(() => compile('struct S<T=u8,U>(T,U);fn main(){}'), e => e.code === 'E_GENERIC_DEFAULT_ORDER');
  // A type-path _ is not a fresh independently duplicated variable. Constructor
  // partial applications have the equation service; type-path equations do not.
  assert.throws(() => compile('struct S<T,U=T>(T,U);fn main(){let x:S<_>=S(7u8,8u8);}'), e => e.code === 'F_GENERIC_DEFAULT_INFERENCE');
});

test('no default equations, type-only operands or unresolved placeholders reach executable MIR', () => {
  for (const [,source] of genericDefaultCases) {
    const compiled = compile(source);
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (['type','returnType','pointerSignature'].includes(key) && typeof entry === 'string')
          assert.ok(!entry.includes('=') && !entry.includes('>::') && !/\b_\b/.test(entry), `unresolved runtime type ${entry}`);
        if(key==='op') assert.ok(!/genericDefault|constantReference/.test(entry));
        if(entry && typeof entry==='object')visit(entry);
      }
    };
    visit(compiled.mir); visit(compiled.optimizedMir);
  }
});

test('published generic defaults example matches the guide and executes across backends', async () => {
  const {readFileSync} = await import('node:fs');
  const source = readFileSync(new URL('../examples/07-generic-defaults.rs', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../docs/generic-defaults.md', import.meta.url), 'utf8');
  assert.ok(guide.includes('```rust\n' + source + '```'));
  for (const optimize of [false,true]) {
    const {compiled,output} = execute(source,{optimize}); assert.equal(output,'7\n');
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output,output);
    const context=vm.createContext({}); vm.runInContext(compiled.js,context,{timeout:3000});
    assert.equal(vm.runInContext('r.output',context),output);
  }
});
