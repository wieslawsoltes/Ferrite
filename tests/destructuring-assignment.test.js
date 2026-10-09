import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, tokenize} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {destructuringCases, destructuringCompileFailCases, destructuringPanicCases} from './fixtures/destructuring-conformance.js';

for (const [name, source, expected] of destructuringCases) test(name, () => {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    const mir = JSON.parse(JSON.stringify(result.optimizedMir));
    assert.equal(new MirVirtualMachine(mir, {entry: result.entry}).run().output, expected, 'MIR');
    assert.equal(new WebAssemblyRuntime(result.wasm.bytes).run().output, expected, 'Wasm');
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 2000});
    assert.equal(output, expected, 'JavaScript');
  }
});
for (const [name, source, code] of destructuringCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compile(source, {optimize}), error => error.code === code);
});
for (const source of [
  'fn main(){let a=1;let mut r=&a;let b=2;(r,)=(&b,);println!("{}",r);}',
  'struct P{r:&i32}fn main(){let a=1;let b=2;let mut p=P{r:&a};(p,)=(P{r:&b},);}',
]) test('reference-carrying stores are an explicit boundary: '+source, () => {
  assert.throws(() => compile(source), error => error.code === 'F_ASSIGN_REFERENCE');
});
test('skipping a large rest emits no per-element projections', () => {
  const source = 'fn main(){let mut first=0;let mut last=0;[first,..,last]=[7;100000];println!("{} {}",first,last);}';
  const result = compile(source, {optimize:false});
  const instructions = result.mir.flatMap(fn => fn.blocks.flatMap(block => block.instructions));
  assert.equal(instructions.filter(i => i.op === 'get').length, 2);
  assert.ok(instructions.length < 30);
  assert.equal(new MirVirtualMachine(result.mir, {entry:result.entry,maxTrace:0}).run().output, '7 7\n');
});

for (const [name, source, code, expected] of destructuringPanicCases) test(name, () => {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    for (const runtime of [new MirVirtualMachine(result.optimizedMir, {entry: result.entry}), new WebAssemblyRuntime(result.wasm.bytes)]) {
      assert.throws(() => runtime.run(), error => error.code === code);
      assert.equal(runtime.runtime.output, expected);
    }
    const context = vm.createContext({});
    assert.throws(() => vm.runInContext(result.js, context, {timeout: 2000}), error => error.code === code);
    assert.equal(vm.runInContext('r.output', context), expected);
  }
});

test('destination writes retain leaf source spans and never create replacement bindings', () => {
  const source = 'fn main(){let mut a=0;let mut b=0;(a,..,b)=(1,true,2);}';
  const tokens = tokenize(source, {file:'src/assign.rs'}), before = structuredClone(tokens);
  const result = compile(source, {tokens,file:'src/assign.rs',optimize:false});
  assert.deepEqual(tokens, before);
  const start = source.indexOf('(a,..,b)');
  const writes = result.mir.flatMap(fn => fn.blocks.flatMap(block => block.instructions))
    .filter(i => i.op === 'write' && i.span.start >= start);
  assert.deepEqual(writes.map(i => source.slice(i.span.start,i.span.end)), ['a','b']);
  assert.ok(writes.every(i => i.span.file === 'src/assign.rs'));
  assert.deepEqual(result.sem.instances.find(fn => fn.name === 'main').locals.map(local => local.name), ['a','b']);
});

test('cached typed assignees stay isolated and retain updated callees and relocated spans', () => {
  const session = new CompilerSession();
  const files = {'Cargo.toml':'[package]\nname="assign"\nversion="0.1.0"',
    'src/main.rs':'mod helper;fn main(){let mut a=0;let mut b=0;(a,b)=(helper::value(),8);println!("{} {}",a,b);}',
    'src/helper.rs':'pub fn value()->i32{1}'};
  const execute = result => new MirVirtualMachine(result.optimizedMir,{entry:result.entry}).run().output;
  const first = session.compile(files); assert.equal(execute(first),'1 8\n');
  const hir = first.hir.find(fn => fn.instance === 'main<>');
  assert.throws(() => { hir.body.body.find(node => node.kind === 'assign').target.items[0].assigneeIndex = 99; }, TypeError);
  const detached = structuredClone(hir); detached.body.body.find(node => node.kind === 'assign').target.items[0].assigneeIndex = 99;
  files['src/helper.rs'] = 'pub fn value()->i32{9}';
  const second = session.compile(files); assert.equal(execute(second),'9 8\n');
  assert.equal(second.queries.nodes.find(n => n.id === 'type:main<>').cacheHit,true);
  assert.equal(second.hir.find(fn => fn.instance === 'main<>').body.body.find(node => node.kind === 'assign').target.items[0].assigneeIndex,0);
  files['src/main.rs'] = '\n' + files['src/main.rs'];
  const third = session.compile(files); assert.equal(execute(third),'9 8\n');
  assert.equal(third.queries.nodes.find(n => n.id === 'type:main<>').cacheHit,false);
  assert.equal(third.hir.find(fn => fn.instance === 'main<>').body.body.find(node => node.kind === 'assign').target.span.line,2);
});

test('assignee validation bounds depth and width before lowering', () => {
  let nested = 'a'; for (let i=0;i<130;i++) nested='('+nested+',)';
  for (const target of [nested,'['+Array.from({length:16384},()=> 'a').join(',')+']']) {
    assert.throws(() => compile(`fn main(){let mut a=0;${target}=[1;16384];}`), error => error.code === 'F_ASSIGN_BUDGET');
  }
});
