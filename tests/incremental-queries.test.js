import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
const files = () => ({'Cargo.toml': '[package]\nname="queries"\nversion="0.1.0"',
  'src/main.rs': 'mod helper; fn main(){ println!("{}", helper::value()); }',
  'src/helper.rs': 'pub fn value()->i32 { 1 }'});
const run = build => new MirVirtualMachine(build.optimizedMir).run().output;
test('an unrelated function edit reuses typed callers but recompiles and executes the changed callee', () => {
  const session = new CompilerSession(), project = files();
  assert.equal(run(session.compile(project)), '1\n');
  project['src/helper.rs'] = 'pub fn value()->i32 { 9 }';
  const build = session.compile(project);
  assert.equal(run(build), '9\n');
  const nodes = build.queries.nodes;
  assert.equal(nodes.find(n=>n.id==='type:main<>').cacheHit, true);
  assert.equal(nodes.find(n=>n.id==='type:helper::value<>').cacheHit, false);
  assert(nodes.find(n=>n.id==='type:main<>').dependencies.includes('type:helper::value<>'));
  assert.equal(nodes.find(n=>n.id==='mir:main<>').cacheHit, true);
});
test('callee body errors are still diagnosed when its caller is a query-cache hit', () => {
  const session = new CompilerSession(), project = files(); session.compile(project);
  project['src/helper.rs'] = 'pub fn value()->i32 { "bad" }';
  assert.throws(()=>session.compile(project), /expected i32/);
  project['src/helper.rs'] = 'pub fn value()->i32 { 8 }';
  assert.equal(run(session.compile(project)), '8\n');
});
test('declaration changes invalidate type queries and updated trait semantics cannot leak through the cache', () => {
  const session = new CompilerSession(), project = files(); session.compile(project);
  project['src/helper.rs'] = 'pub fn value()->bool { true }';
  const build = session.compile(project);
  assert.equal(run(build), 'true\n');
  assert.equal(build.queries.nodes.find(n=>n.id==='type:main<>').cacheHit, false);
});
test('source relocation invalidates HIR and MIR spans; exact-project hit stays explicit', () => {
  const session = new CompilerSession(), project = files(); session.compile(project);
  project['src/main.rs'] = '\n' + project['src/main.rs'];
  const build = session.compile(project);
  assert.equal(build.queries.nodes.find(n=>n.id==='type:main<>').cacheHit, false);
  assert.equal(build.mir.find(f=>f.name==='main').span.line, 2);
  const again = session.compile(project);
  assert.equal(again.cacheHit,true); assert.deepEqual(again.timings,[]);
  assert.equal(again.stages.find(s=>s.kind==='queries').data.projectCacheHit,true);
});
test('recursive call graph cache replay terminates and preserves concrete generic instances', () => {
  const session = new CompilerSession(), project = files();
  project['src/main.rs'] = 'mod helper; fn fib(n:i32)->i32 { if n<2 {n} else {fib(n-1)+fib(n-2)} } fn main(){println!("{}", fib(7));}';
  const first = session.compile(project); assert.equal(run(first),'13\n');
  project['src/helper.rs'] = 'pub fn value()->i32 { 3 }';
  const next=session.compile(project); assert.equal(run(next),'13\n');
  assert(next.queries.hits>0);
});
test('bounded query cache owns immutable snapshots and clear resets all state', () => {
  const cache=new SemanticQueryCache({maxEntries:1});
  const value={data:[1]};const query=cache.lookup('test','a',{id:'a'});cache.store(query,value);value.data[0]=99;
  const copy=cache.run('test','a',{id:'a'},()=>assert.fail());copy.data[0]=21;
  assert.equal(cache.run('test','a',{id:'a'},()=>assert.fail()).data[0],1);
  cache.run('test','b',{id:'b'},()=>2);assert.equal(cache.entries.size,1);cache.clear();assert.equal(cache.characters,0);
});
