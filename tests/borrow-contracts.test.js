import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile, parse, tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {BorrowContract} from '../src/compiler/ownership/BorrowContract.js';
import {borrowContractCases, borrowContractCompileFailCases} from './fixtures/borrow-contracts.js';

const output = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry: artifact.entry}).run().output;
for (const [name, source, expected] of borrowContractCases) test(`borrow contract: ${name}`, () => {
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(output(artifact), expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, expected);
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), expected);
  }
});
for (const [name, source, code] of borrowContractCompileFailCases) test(`borrow contract rejects: ${name}`, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => {
    assert.equal(error.code, code, error.stack); assert.ok(error.span?.end > error.span?.start); return true;
  });
});
const freeze = node => {
  if (node && typeof node === 'object') { Object.values(node).forEach(freeze); Object.freeze(node); }
  return node;
};
test('borrow contracts preserve deeply frozen accepted and rejected source ASTs', () => {
  for (const [accepted, cases] of [[true, borrowContractCases], [false, borrowContractCompileFailCases]])
    for (const [, source, expected] of cases) {
      const ast = freeze(parse(tokenize(source))), before = JSON.stringify(ast);
      if (accepted) assert.equal(output(compile('', {ast})), expected);
      else assert.throws(() => compile('', {ast}), {code: expected});
      assert.equal(JSON.stringify(ast), before);
    }
});
test('signature changes invalidate ownership queries and preserve atomic error recovery', () => {
  const source = 'fn choose<T>(x:T,y:&i32)->T{x}fn main(){let x=42;let mut y=0;let r=choose(&x,&y);y=1;println!("{}",*r);}';
  const changed = source.replace('x:T,y:&i32', 'x:T,y:T');
  const cache = new SemanticQueryCache(); let first;
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const artifact = compile(source, {queryCache: cache});
    assert.equal(output(artifact), '42\n');
    if (first) {
      assert.deepEqual(artifact.ownership, first.ownership);
      for (const stage of ['type', 'ownership', 'mir']) assert.ok(artifact.queries.nodes.some(node => node.stage === stage && node.cacheHit));
    } else first = structuredClone(artifact);
    cache.beginBuild(); assert.throws(() => compile(changed, {queryCache: cache}), {code: 'E0502'});
  }
});
test('contracts and retained-call events are serializable and source linked', () => {
  const artifact = compile(borrowContractCases[0][1]);
  const contract = artifact.ownership.find(report => report.instance === 'id<>').referenceContract;
  assert.deepEqual(contract, {version: 1, kind: 'elided', sources: [0], mutable: false});
  assert.deepEqual(JSON.parse(JSON.stringify(artifact.ownership)), artifact.ownership);
  const caller = artifact.ownership.find(report => report.instance === 'main<>');
  const event = caller.events.find(event => event.kind === 'retain returned reference');
  assert.ok(event && event.span && caller.places[event.place].local === event.slot);
  // The contract is checker metadata, not an executable equation or MIR opcode.
  assert.ok(!JSON.stringify(artifact.optimizedMir).includes('referenceContract'));
});
test('implicit argument reservation/activation is observable without moving the handle', () => {
  const source = borrowContractCases.find(([name]) => name === 'mutable argument uses two phase activation')[1];
  const artifact = compile(source), events = artifact.ownership.find(report => report.instance === 'main<>').events;
  const reserve = events.findIndex(event => event.kind === 'reserve mutable argument');
  const activate = events.findIndex(event => event.kind === 'activate mutable argument');
  assert.ok(reserve >= 0 && activate > reserve);
  assert.ok(!events.some(event => event.kind === 'move' && event.name === 'r'));
});
for (const [key, limit] of [['MAX_WORK', 0], ['MAX_DEPTH', 0]]) test(`borrow signature ${key} is bounded and recovers`, () => {
  const before = BorrowContract[key], source = borrowContractCases[0][1], cache = new SemanticQueryCache();
  try { BorrowContract[key] = limit; assert.throws(() => compile(source, {queryCache: cache}), {code: 'F_OWNERSHIP_LIMIT'}); }
  finally { BorrowContract[key] = before; }
  cache.beginBuild(); assert.equal(output(compile(source, {queryCache: cache})), '42\n');
});
test('unrepresented aggregate input provenance fails explicitly', () => {
  assert.throws(() => compile('fn get(x:(&i32,))->&i32{x.0}fn main(){let x=42;get((&x,));}'), {code: 'F_BORROW_CONTRACT'});
});

test('call-contract guide matches the executable example on every backend', () => {
  const source = readFileSync(new URL('../examples/10-borrow-contracts.rs', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('../docs/borrow-contracts.md', import.meta.url), 'utf8');
  assert.equal(guide.match(/```rust\n([\s\S]*?)```/)[1], source);
  for (const optimize of [false, true]) {
    const artifact = compile(source, {optimize});
    assert.equal(output(artifact), '42\n');
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output, '42\n');
    const context = vm.createContext({}); vm.runInContext(artifact.js, context, {timeout: 3000});
    assert.equal(vm.runInContext('r.output', context), '42\n');
  }
});

test('indirect generic contract metadata preserves source-relative depth', () => {
  const source = 'fn choose<T:Copy>(x:T,y:&&T)->T{**y}fn main(){let a=42;let b=7;let s=&b;let t=&s;println!("{}",*choose(&a,&t));}';
  const artifact = compile(source), report = artifact.ownership.find(item => item.instance.startsWith('choose<'));
  assert.deepEqual(report.referenceContract, {version: 1, kind: 'generic', sources: [0, 1], mutable: false, indirections: [0, 2]});
  assert.equal(output(artifact), '7\n');
  assert.deepEqual(JSON.parse(JSON.stringify(artifact.ownership)), artifact.ownership);
});
test('indirect signature edits invalidate actual ownership cache entries', () => {
  const source = 'fn choose<T>(x:T,y:&&i32)->T{x}fn main(){let a=42;let mut b=7;let s=&b;let r=choose(&a,&s);b=9;println!("{}",*r);}';
  const changed = source.replace('y:&&i32', 'y:&T'), cache = new SemanticQueryCache();
  for (let i = 0; i < 3; i++) {
    cache.beginBuild(); const artifact = compile(source, {queryCache: cache}); assert.equal(output(artifact), '42\n');
    if (i) for (const stage of ['type', 'ownership', 'mir'])
      assert.ok(artifact.queries.nodes.some(node => node.stage === stage && node.cacheHit));
    cache.beginBuild(); assert.throws(() => compile(changed, {queryCache: cache}), {code: 'E0502'});
  }
});
test('hidden generic carriers fail as capabilities, not false native compile-fail cases', () => {
  // These are valid native Rust programs. Neither tuples nor nested result
  // regions are represented by this increment's flat direct-reference domain.
  const sources = [
    'fn choose<__borrow_origin:Copy>(x:__borrow_origin,y:(__borrow_origin,))->__borrow_origin{x}fn main(){let a=42;let b=7;println!("{}",*choose(&a,(&b,)));}',
    'fn choose<T>(x:&T,y:T)->&T{x}fn main(){let a=42;let b=7;let s=&a;println!("{}",**choose(&s,&b));}',
  ];
  for (const source of sources) {
    const ast = freeze(parse(tokenize(source))), before = JSON.stringify(ast);
    assert.throws(() => compile('', {ast}), {code: 'F_BORROW_CONTRACT'});
    assert.equal(JSON.stringify(ast), before);
  }
});
test('unrepresented nested result regions cannot silently discard local lifetime constraints', () => {
  const source = 'fn choose<T>(x:&T,y:T)->&T{x}fn main(){let a=42;let s=&a;let r={let b=7;choose(&s,&b)};println!("{}",**r);}';
  // Rust diagnoses b's lifetime. We refuse this contract before pretending to
  // solve its missing inner result region. Keep it out of conformance counts.
  assert.throws(() => compile(source), {code: 'F_BORROW_CONTRACT'});
});


test('generic direct-input traversal is charged even without dereference layers', () => {
  const source = 'fn same<T>(x:T)->T{x}fn main(){let x=42;println!("{}",*same(&x));}';
  const before = BorrowContract.MAX_WORK, cache = new SemanticQueryCache();
  try {
    BorrowContract.MAX_WORK = 0;
    assert.throws(() => compile(source, {queryCache: cache}), {code: 'F_OWNERSHIP_LIMIT'});
  } finally { BorrowContract.MAX_WORK = before; }
  cache.beginBuild(); assert.equal(output(compile(source, {queryCache: cache})), '42\n');
});
