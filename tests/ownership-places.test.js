import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile, parse, tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {PlaceTable} from '../src/compiler/ownership/PlaceTable.js';
import {OwnershipLiveness} from '../src/compiler/ownership/OwnershipLiveness.js';
import {ownershipPlaceCases, ownershipPlaceCompileFailCases} from './fixtures/ownership-places.js';

const execute = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry: artifact.entry}).run().output;
for (const [name, source, output] of ownershipPlaceCases) test(`ownership: ${name}`, () => {
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(execute(artifact), output);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, output);
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), output);
  }
});
for (const [name, source, code] of ownershipPlaceCompileFailCases) test(`ownership rejects: ${name}`, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack); assert.ok(error.span?.start >= 0); return true;
  });
});
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
test('ownership never annotates or mutates the source AST', () => {
  for (const [, source, output] of ownershipPlaceCases.slice(0, 36)) {
    const ast = freeze(parse(tokenize(source))), original = JSON.stringify(ast);
    assert.equal(execute(compile('', {ast})), output); assert.equal(JSON.stringify(ast), original);
  }
});
test('ownership errors preserve frozen source ASTs', () => {
  for (const [, source, code] of ownershipPlaceCompileFailCases.slice(0, 40)) {
    const ast = freeze(parse(tokenize(source))), original = JSON.stringify(ast);
    assert.throws(() => compile('', {ast}), {code}); assert.equal(JSON.stringify(ast), original);
  }
});
test('ownership query replay preserves places, liveness, diagnostics and error recovery', () => {
  const cache = new SemanticQueryCache();
  const good = 'fn main(){let mut p=(0,0);let a=&mut p.0;let b=&mut p.1;*a=20;*b=22;println!("{}",p.0+p.1);}';
  let first;
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const artifact = compile(good, {queryCache: cache});
    assert.equal(execute(artifact), '42\n');
    if (first) {
      assert.deepEqual(artifact.ownership, first.ownership);
      for (const stage of ['type', 'ownership', 'mir']) assert.ok(artifact.queries.nodes.some(n => n.stage === stage && n.cacheHit));
    } else first = structuredClone(artifact);
    cache.beginBuild(); assert.throws(() => compile(good.replace('&mut p.1', '&mut p.0'), {queryCache: cache}), {code: 'E0502'});
  }
});
for (const [owner, key, limit] of [[PlaceTable, 'MAX_PLACES', 2], [PlaceTable, 'MAX_WORK', 1],
  [OwnershipLiveness, 'MAX_NODES', 2], [OwnershipLiveness, 'MAX_WORDS', 1],
  [OwnershipLiveness, 'MAX_WORK', 1], [OwnershipLiveness, 'MAX_DEPTH', 2]]) {
  test(`ownership budget ${owner.name}.${key} fails atomically and recovers`, () => {
    const source = ownershipPlaceCases[1][1], cache = new SemanticQueryCache(), before = owner[key];
    try { owner[key] = limit; assert.throws(() => compile(source, {queryCache: cache}), {code: 'F_OWNERSHIP_LIMIT'}); }
    finally { owner[key] = before; }
    cache.beginBuild(); assert.equal(execute(compile(source, {queryCache: cache})), ownershipPlaceCases[1][2]);
  });
}
test('place interning, external parameter roots and prefix kills are distinct from overlap', () => {
  const table = new PlaceTable({locals: [{slot: 0, name: 'p'}, {slot: 1, name: 'q'}]});
  const left = table.project(0, '0'), right = table.project(0, '1'), nested = table.project(left, '0');
  assert.equal(left, table.project(0, '0')); assert.equal(table.overlaps(left, right), false);
  assert.equal(table.overlaps(left, nested), true); assert.equal(table.contains(left, nested), true);
  assert.equal(table.contains(nested, left), false); assert.equal(table.overlaps(0, table.parameter(0)), false);
  const element = table.project(0, null), otherField = table.project(element, '1');
  assert.equal(table.overlaps(element, otherField), true);
  assert.equal(table.overlaps(table.project(element, '0'), otherField), false);
  const snapshot = table.snapshot(); snapshot[left].path.push('bad'); assert.equal(table.get(left).path.length, 1);
});
test('ownership reports contain serializable source-linked places and actual CFG work', () => {
  const artifact = compile(ownershipPlaceCases[1][1]);
  assert.deepEqual(JSON.parse(JSON.stringify(artifact.ownership)), artifact.ownership);
  const report = artifact.ownership.find(item => item.instance === 'main<>');
  assert.ok(report.liveness.nodes > 0 && report.liveness.edges > 0 && report.liveness.work > 0 && report.placeWork > 0);
  assert.ok(report.places.some(place => place.path.length));
  for (const event of report.events) { assert.equal(report.places[event.place].local, event.slot); assert.ok(event.span); }
});
test('capturing three references retains every capture loan', () => {
  const source = 'fn main(){let mut x=1;let y=2;let z=3;let f=||x+y+z;x=9;println!("{}",f());}';
  assert.throws(() => compile(source), {code: 'E0502'});
});
test('documented projection and reborrow example runs on every backend', () => {
  const text = readFileSync(new URL('../docs/ownership-places.md', import.meta.url), 'utf8');
  const sources = [...text.matchAll(/```rust\n([\s\S]*?)```/g)].map(match => match[1]);
  assert.equal(sources.length, 1);
  for (const source of sources) {
    const artifact = compile(source); assert.equal(execute(artifact), '42\n');
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, '42\n');
    const context = vm.createContext({}); vm.runInContext(artifact.js, context); assert.equal(vm.runInContext('r.output', context), '42\n');
  }
});
