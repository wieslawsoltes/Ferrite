import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {Parser} from '../src/compiler/Parser.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {TraitMethodScope} from '../src/compiler/TraitMethodScope.js';
import {TypeSystem as T} from '../src/compiler/TypeSystem.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {associatedBoundCases, associatedBoundCompileFailCases} from './fixtures/associated-bounds.js';

for (const [name, source, output] of associatedBoundCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(compiled.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of associatedBoundCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, `${error.message}\n${error.stack}`);
    return true;
  });
});

const analyzer = source => new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)));
const fixture = suffix => associatedBoundCases.find(([name]) => name.endsWith(suffix))[1];

test('associated bounds are distinct labelled predicates, not positional inputs or equations', () => {
  const app = T.traitApplication('A<bool,Item:B<Out=U>+Copy,Other:>');
  assert.deepEqual(app, {name: 'A', args: ['bool'], bindings: [
    {name: 'Item', bounds: ['B<Out=U>', 'Copy']}, {name: 'Other', bounds: []}
  ]});
  assert.equal(T.traitName(app.name, app.args, app.bindings), 'A<bool,Item:B<Out=U>+Copy,Other:>');
  assert.equal(T.traitIdentity('A<bool,Item:B<Out=U>+Copy>'), 'A<bool>');
  assert.equal(T.substitute('A<Item:B<Item,Out=Item>>', new Map([['Item', 'u8'], ['Out', 'bool']])), 'A<Item:B<u8,Out=u8>>');
  assert.deepEqual(T.traitApplication('A<Item:Fn(U)->U>'), {name: 'A', args: [], bindings: [{name: 'Item', bounds: ['Fn(U)->U']}]});
  assert.throws(() => T.traitApplication('A<Item:Copy,u8>'), e => e.code === 'E0229');
});

test('associated predicate evidence is declaration-local and ignores free-alias refinements', () => {
  const a = analyzer('trait A{type Item;}struct S;impl A for S{type Item=u8;}fn bounded<T:A<Item:Copy>>(){}fn plain<T:A>(){}type V<T:A<Item:Copy>>=T::Item;fn main(){}');
  const parameters = new Set(['T']), bindings = a.index.associatedBindings;
  for (let iteration = 0; iteration < 3; iteration++) {
    const bounded = a.index.functions.get('bounded'), plain = a.index.functions.get('plain');
    assert.ok(bindings.boundsFor('<T as A>::Item', parameters, bounded).includes('core::marker::Copy'));
    assert.deepEqual(bindings.boundsFor('<T as A>::Item', parameters, plain), []);
    assert.deepEqual(bindings.boundsFor('<T as A>::Item', parameters, a.index.aliases.get('V')), []);
    assert.equal(a.index.type('<S as A>::Item'), 'u8');
    const boundedScope = new TraitMethodScope(a, bounded, new Map([['T', 'S']]));
    const plainScope = new TraitMethodScope(a, plain, new Map([['T', 'S']]));
    assert.equal(boundedScope.copyOrigin('<T as A>::Item'), true);
    assert.equal(plainScope.copyOrigin('<T as A>::Item'), false);
  }
});

test('proof transfer uses explicit output equations without inferring an implementing type', () => {
  const a = analyzer('trait A{type Item;}fn f<T:A<Item=U>+A<Item:Copy>,U>(){}fn plain<T:A,U>(){}fn main(){}');
  const fn = a.index.functions.get('f'), parameters = new Set(['T', 'U']);
  assert.ok(a.index.associatedBindings.boundsFor('U', parameters, fn).includes('core::marker::Copy'));
  assert.equal(new TraitMethodScope(a, fn).copyOrigin('U'), true);
  assert.equal(new TraitMethodScope(a, a.index.functions.get('plain')).copyOrigin('U'), false);
  assert.equal(a.index.type('T', '', null, parameters, fn), 'T');
});

test('real semantic query replay invalidates bound removal and recovers after failed compilation', () => {
  const cache = new SemanticQueryCache(), source = fixture('closure capture preserves associated Copy proof');
  for (const iteration of [0, 1]) {
    cache.beginBuild(); const compiled = compile(source, {queryCache: cache});
    assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '7 7\n');
    if (iteration) assert.ok(compiled.queries.hits > 0, 'must replay real checked HIR');
  }
  cache.beginBuild();
  assert.throws(() => compile(source.replace('A<Item:Copy>', 'A'), {queryCache: cache}), e => e.code === 'E0507');
  cache.beginBuild(); const restored = compile(source, {queryCache: cache});
  assert.equal(new WebAssemblyRuntime(restored.wasm).run().output, '7 7\n');
});

test('source AST including nested bound syntax remains deeply frozen', () => {
  const source = fixture('nested bounds output type inference'), ast = Parser.parse(Lexer.tokenize(source));
  const before = JSON.stringify(ast);
  const freeze = value => {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  };
  freeze(ast);
  for (const optimize of [false, true]) {
    const compiled = compile(source, {ast, optimize});
    assert.equal(new MirVirtualMachine(compiled.optimizedMir, {entry: compiled.entry}).run().output, '7 7\n');
    assert.equal(JSON.stringify(ast), before);
  }
});

test('associated predicate budgets restore construction and inherited-evidence guards', () => {
  const a = analyzer('trait A{type Item:B<Out:Copy>;}trait B{type Out;}fn f<T:A<Item:B<Out:Copy>>>(){}fn main(){}');
  const bindings = a.index.associatedBindings, fn = a.index.functions.get('f'), parameters = new Set(['T']);
  bindings.environments = new WeakMap(); bindings.maxEquations = 0;
  assert.throws(() => bindings.environment(parameters, fn), e => e.code === 'F_ASSOC_BINDING_LIMIT');
  assert.equal(bindings.building, 0);
  bindings.maxEquations = 4096;
  assert.ok(bindings.boundsFor('<<T as A>::Item as B>::Out', parameters, fn).includes('core::marker::Copy'));
  bindings.inheritedDepth = 64;
  assert.throws(() => bindings.inheritedRequirements('<<T as A>::Item as B>::Out', parameters, fn), e => e.code === 'F_ASSOC_BINDING_LIMIT');
  assert.equal(bindings.inheritedDepth, 64);
  bindings.inheritedDepth = 0;
  assert.ok(bindings.boundsFor('<<T as A>::Item as B>::Out', parameters, fn).includes('core::marker::Copy'));
  bindings.maxQueries = 0;
  assert.throws(() => bindings.requirements('T', 'A<Item:B<Out:Copy>>', fn), e => e.code === 'F_ASSOC_BINDING_LIMIT');
  assert.equal(bindings.building, 0); assert.equal(bindings.inheritedDepth, 0);
});

test('bound syntax depth has a source diagnostic rather than a JavaScript stack overflow', () => {
  const bound = 'A<Item:'.repeat(140) + 'Copy' + '>'.repeat(140);
  assert.throws(() => Parser.parse(Lexer.tokenize(`fn f<T:${bound}>(){}fn main(){}`)), e => e.code === 'F_TYPE_DEPTH');
});

test('lifetime and higher-ranked associated bounds stay explicit unsupported boundaries', () => {
  for (const bound of ["'static", "for<'a> B"]) {
    assert.throws(() => compile(`trait A{type Item;}trait B{}fn f<T:A<Item:${bound}>>(){}fn main(){}`), e => e.code === 'F_ASSOC_LIFETIME');
  }
});

test('associated constraints never enter executable MIR types or opcode vocabulary', () => {
  let predicates = 0;
  for (const [, source] of associatedBoundCases) {
    const compiled = compile(source);
    predicates += compiled.sem.associatedBindings.predicates;
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      for (const [key, entry] of Object.entries(value)) {
        if (['type', 'returnType', 'pointerSignature'].includes(key) && typeof entry === 'string')
          assert.ok(!entry.includes('>::') && !entry.includes('=') && !/[<,][\w]+:(?!:)/.test(entry), `unresolved runtime type ${entry}`);
        if (key === 'op') assert.ok(!/associatedBound|constantReference/.test(entry));
        if (entry && typeof entry === 'object') visit(entry);
      }
    };
    visit(compiled.mir); visit(compiled.optimizedMir);
  }
  assert.ok(predicates > 0, 'exercise actual declaration predicate construction');
});
