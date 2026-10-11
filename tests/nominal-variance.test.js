import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {Parser} from '../src/compiler/Parser.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';
import {NominalVariance} from '../src/compiler/NominalVariance.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {nominalVarianceCases, nominalVarianceCompileFailCases} from './fixtures/nominal-variance.js';

const parse = source => Parser.parse(Lexer.tokenize(source));
const index = source => new SymbolIndex(parse(source), {validate: false});
const execute = c => new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)), {entry: c.entry}).run().output;
const report = source => compile(source).sem.nominalVariance;
const parameters = (snapshot, name) => snapshot.declarations.find(d => d.name === name).parameters;
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };

for (const [name, source, output] of nominalVarianceCases) test(name, () => {
  for (const optimize of [false, true]) {
    const c = compile(source, {optimize});
    assert.equal(execute(c), output);
    assert.equal(new WebAssemblyRuntime(c.wasm).run().output, output);
    const context = vm.createContext({});
    vm.runInContext(c.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of nominalVarianceCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack);
    assert.ok(error.span && error.span.start >= 0, 'source-linked diagnostic');
    return true;
  });
});

test('variance lattice: complete transform table and monotonicity', () => {
  // Ambient composition is asymmetric: invariant x bivariant is invariant,
  // but bivariant x invariant is bivariant (Rust's variance.xform operation).
  const table = [[0, 0, 0, 0], [0, 1, 2, 3], [0, 2, 1, 3], [3, 3, 3, 3]];
  for (let a = 0; a < 4; a++) for (let b = 0; b < 4; b++) {
    assert.equal(NominalVariance.transform(a, b), table[a][b]);
    for (let x = 0; x < 4; x++) for (let y = 0; y < 4; y++) {
      if ((a | x) !== x || (b | y) !== y) continue;
      const before = NominalVariance.transform(a, b), after = NominalVariance.transform(x, y);
      assert.equal(before | after, after);
    }
  }
});

test('variance snapshot reports field polarity separately from constrained outputs', () => {
  const s = report(`trait Source { type Out; }
    struct Co<T>(T); struct Contra<T>(fn(T)); struct Inv<T>(fn(T)->T);
    struct Unstored<T:Source<Out=U>,U>(T); fn main(){}`);
  assert.equal(parameters(s, 'Co')[0].variance, 'covariant');
  assert.equal(parameters(s, 'Contra')[0].variance, 'contravariant');
  assert.equal(parameters(s, 'Inv')[0].variance, 'invariant');
  assert.deepEqual(parameters(s, 'Unstored')[1], {name: 'U', variance: 'bivariant', used: true, constrainedByOutput: true});
  assert.ok(Object.isFrozen(s) && Object.isFrozen(s.declarations) && Object.isFrozen(parameters(s, 'Unstored')));
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
  assert.ok(s.equationCount > 0 && s.equationRefinements > 0);
});

test('variance worklist: mutually recursive constraints converge independently of source order', () => {
  const a = 'struct A<T>(fn(B<T>));', b = 'struct B<T>(fn(A<T>),T);';
  const first = report(a + b + 'fn main(){}'), second = report(b + a + 'fn main(){}');
  for (const name of ['A', 'B']) assert.deepEqual(parameters(first, name), parameters(second, name));
  assert.equal(parameters(first, 'A')[0].variance, 'contravariant');
  assert.equal(parameters(first, 'B')[0].variance, 'covariant');
  for (const snapshot of [first, second]) assert.ok(snapshot.refinements <= 2 * snapshot.nodes);
});

test('variance worklist: nested generic growth does not expand recursive bodies', () => {
  const model = index('struct Recursive<T>(fn(Recursive<Vec<T>>));fn main(){}');
  const service = new NominalVariance(model);
  const snapshot = service.analyze();
  assert.equal(parameters(snapshot, 'Recursive')[0].variance, 'bivariant');
  assert.equal(parameters(snapshot, 'Recursive')[0].used, false);
  assert.ok(snapshot.nodes < 30 && snapshot.work < 500);
  assert.throws(() => service.validate(), {code: 'E0392'});
});

test('variance: invariant recursive context is genuine native evidence', () => {
  const snapshot = report('struct Recursive<T>(fn(&mut Recursive<T>));fn main(){}');
  assert.equal(parameters(snapshot, 'Recursive')[0].variance, 'invariant');
  assert.equal(parameters(snapshot, 'Recursive')[0].used, true);
});

test('variance: unnormalized projections survive equalities, blanket impls and aliases', () => {
  const snapshot = report(`trait Source{type Out;}impl<T>Source for T{type Out=u8;}
    type Project<T>=<T as Source>::Out;
    struct Bound<T:Source<Out=u8>>(T::Out);struct Alias<T>(Project<T>);fn main(){}`);
  for (const name of ['Bound', 'Alias']) assert.equal(parameters(snapshot, name)[0].variance, 'invariant');
});

test('variance: inspection resolver and hierarchy caches never mutate the main analyzer', () => {
  const analyzer = new SemanticAnalyzer(parse(`trait Source{type Out;}
    struct Bound<T:Source<Out=U>,U>(T);fn main(){}`));
  const cache = () => JSON.stringify({type: analyzer.index.typeResolver.snapshot(),
    associated: analyzer.index.associatedTypes.snapshot(), bindings: analyzer.index.associatedBindings.snapshot(),
    hierarchy: analyzer.implementations.traits.hierarchy.snapshot(), defaults: analyzer.index.genericDefaults.snapshot()});
  const before = cache(), result = new NominalVariance(analyzer.index).snapshot();
  assert.equal(parameters(result, 'Bound')[1].constrainedByOutput, true);
  assert.equal(cache(), before);
});

for (const option of ['maxNodes', 'maxEdges', 'maxWork', 'maxDepth', 'maxTypeCharacters']) test(`variance budget: ${option} failure is atomic and retryable`, () => {
  const model = index('struct S<T>(fn(T)->T);fn main(){}');
  const service = new NominalVariance(model, {[option]: 0});
  assert.throws(() => service.analyze(), {code: 'F_VARIANCE_LIMIT'});
  assert.equal(service.result, null); assert.equal(service.running, false);
  service[option] = option === 'maxDepth' ? 128 : 2000000;
  const completed = service.analyze();
  assert.equal(parameters(completed, 'S')[0].variance, 'invariant');
  assert.equal(service.analyze(), completed);
});

test('variance limits reject invalid configuration and deeply nested injected fields', () => {
  const model = index('struct S<T>(T);fn main(){}');
  for (const value of [-1, Infinity, NaN, 0.5, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => new NominalVariance(model, {maxNodes: value}), RangeError);
  const shape = model.structs.get('S');
  shape.fields[0].type = 'fn('.repeat(300) + 'T' + ')->()'.repeat(300);
  const service = new NominalVariance(model);
  assert.throws(() => service.analyze(), {code: 'F_VARIANCE_LIMIT'});
  assert.equal(service.result, null); assert.equal(service.running, false);
});

test('variance output equations use directed hyperedges, not source-order rescanning', () => {
  const count = 48, names = Array.from({length: count}, (_, i) => `T${i}`);
  const predicates = names.slice(0, -1).map((name, i) => `${name}:Source<Out=${names[i+1]}>`).reverse();
  const source = `trait Source{type Out;}struct Chain<${names.join(',')}>(T0)where ${predicates.join(',')};fn main(){}`;
  const snapshot = report(source);
  assert.ok(parameters(snapshot, 'Chain').every(p => p.used));
  assert.equal(snapshot.equationRefinements, count - 1);
  assert.ok(snapshot.equationEdges <= count && snapshot.work < 15000);
});

test('variance: all accepted fixtures tolerate deeply frozen source ASTs', () => {
  for (const [, source, output] of nominalVarianceCases) {
    const ast = freeze(parse(source)), before = JSON.stringify(ast);
    for (const optimize of [false, true]) assert.equal(execute(compile('', {ast, optimize})), output);
    assert.equal(JSON.stringify(ast), before);
  }
});

test('variance: warm semantic-query replay cannot authorize a changed declaration', () => {
  const cache = new SemanticQueryCache(), good = 'struct S<T>(fn(S<T>),T);fn main(){println!("ok");}';
  const bad = 'struct S<T>(fn(S<T>));fn main(){println!("ok");}';
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const result = compile(good, {queryCache: cache}); assert.equal(execute(result), 'ok\n');
    if (i) assert.ok(result.queries.nodes.some(node => node.stage === 'type' && node.cacheHit));
    cache.beginBuild(); assert.throws(() => compile(bad, {queryCache: cache}), {code: 'E0392'});
  }
  cache.beginBuild();
  const changed = compile('struct S<T>(fn(T));fn main(){println!("ok");}', {queryCache: cache});
  assert.equal(parameters(changed.sem.nominalVariance, 'S')[0].variance, 'contravariant');
  assert.equal(execute(changed), 'ok\n');
});

test('variance: declaration analysis is isolated from executable MIR and callable identities', () => {
  const base = compile('fn main(){println!("ok");}');
  const extra = compile('trait A{type Item;}struct R<T:A<Item=U>,U>(T);struct S<T>(T,fn(Self));fn main(){println!("ok");}');
  const types = artifact => artifact.optimizedMir.map(fn => ({params: fn.params.map(p => p.type), registers: fn.registers.map(r => r.type), returnType: fn.returnType}));
  assert.deepEqual(types(extra), types(base));
  assert.equal(extra.sem.instances.length, base.sem.instances.length);
  assert.deepEqual(extra.sem.functionItems, base.sem.functionItems);
  assert.equal(execute(extra), 'ok\n');
});

test('variance: a user nominal called Vec is not the compiler builtin', () => {
  const snapshot = report('struct Vec<T>(fn(T));struct S<T>(Vec<T>);fn main(){}');
  assert.equal(parameters(snapshot, 'Vec')[0].variance, 'contravariant');
  assert.equal(parameters(snapshot, 'S')[0].variance, 'contravariant');
});

test('variance: same-spelled Self owner and generic binder remains an explicit identity boundary', () => {
  // This is valid native Rust, but not yet representable by Ferrite's canonical
  // string identities. Keep it separate from the native compile-fail corpus.
  assert.throws(() => compile('struct X<X>(X,fn(Self));fn main(){}'), {code: 'E0109'});
});
