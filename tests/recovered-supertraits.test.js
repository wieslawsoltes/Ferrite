import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile,parse,tokenize} from '../src/engine.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';
import {TraitHierarchy} from '../src/compiler/TraitHierarchy.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {supertraitCases,supertraitCompileFailCases} from './fixtures/recovered-supertraits.js';
const run=build=>new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run().output;
for(const [name,source,expected] of supertraitCases)test(name,()=>{
  for(const optimize of [false,true]){
    const build=compile(source,{optimize});let output;
    vm.runInNewContext(build.js,{postMessage:value=>output=value},{timeout:2000});
    assert.equal(output,expected);assert.equal(run(build),expected);
    assert.equal(new WebAssemblyRuntime(build.wasm).run().output,expected);
  }
});
for(const [name,source,code] of supertraitCompileFailCases)test(name,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),error=>error.code===code);
});
const hierarchy=(source,options)=>new TraitHierarchy(new SymbolIndex(parse(tokenize(source))),options);
test('supertrait analysis does not mutate syntax snapshots',()=>{
  const ast=parse(tokenize(supertraitCases[0][1])),snapshot=JSON.stringify(ast);
  SemanticAnalyzer.analyze(ast);SemanticAnalyzer.analyze(ast);
  assert.equal(JSON.stringify(ast),snapshot);
});
test('diamond ancestors are unique, immutable and cached',()=>{
  const graph=hierarchy('trait Root{}trait Left:Root{}trait Right:Root{}trait Leaf:Left+Right{}');
  assert.deepEqual(new Set(graph.ancestors('Leaf')),new Set(['Left','Right','Root']));
  assert(Object.isFrozen(graph.ancestors('Leaf')));const visits=graph.visits;
  for(let i=0;i<100;i++)assert(graph.implies('Leaf','Root'));
  assert.equal(graph.visits,visits);assert(graph.hits>=100);
  assert(!graph.implies('Root','Leaf'));
});
test('iterative cycle validation handles a deep hierarchy',()=>{
  const graph=hierarchy(Array.from({length:3000},(_,i)=>`trait T${i}${i?`:T${i-1}`:''}{}`).join(''));
  assert.equal(graph.ancestors('T2999').length,2999);
  assert(graph.implies('T2999','T0'));
});
test('hierarchy LRU limits entry and character retention',()=>{
  const graph=hierarchy('trait A{}trait B:A{}trait C:B{}trait D:C{}',{maxEntries:2,maxCharacters:20});
  for(const name of ['A','B','C','D'])graph.ancestors(name);
  assert(graph.cache.size<=2);assert(graph.characters<=20);
  const tiny=hierarchy('trait LongParent{}trait LongChild:LongParent{}',{maxCharacters:1});
  assert.deepEqual(tiny.ancestors('LongChild'),['LongParent']);assert.equal(tiny.cache.size,0);
});
test('hierarchy budgets produce diagnostics',()=>{
  assert.throws(()=>hierarchy('trait A{}trait B:A{}',{maxEdges:0}),e=>e.code==='F_TRAIT_HIERARCHY_LIMIT');
  const graph=hierarchy('trait A{}trait B:A{}trait C:B{}',{maxQueryVisits:1});
  assert.throws(()=>graph.ancestors('C'),e=>e.code==='F_TRAIT_HIERARCHY_LIMIT');
});
test('canonical graph equals independent closure oracle on generated DAGs',()=>{
  let seed=19;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let sample=0;sample<25;sample++){
    const edges=Array.from({length:30},(_,i)=>Array.from({length:i},(_,j)=>j).filter(()=>next()%5===0));
    const graph=hierarchy(edges.map((parents,i)=>`trait T${i}${parents.length?':'+parents.map(j=>`T${j}`).join('+'):''}{}`).join(''));
    for(let i=0;i<edges.length;i++){
      const expected=new Set(),queue=[...edges[i]];
      while(queue.length){const j=queue.shift();if(!expected.has(`T${j}`)){expected.add(`T${j}`);queue.push(...edges[j]);}}
      assert.deepEqual(new Set(graph.ancestors(`T${i}`)),expected);
    }
  }
});
test('supertrait changes invalidate declaration and call caches',()=>{
  const files={'Cargo.toml':'[package]\nname="supers"\nversion="0.1.0"',
    'src/main.rs':'trait Root{fn value(&self)->i32{42}}trait Leaf:Root{fn answer(&self)->i32{self.value()}}struct C;impl Root for C{}impl Leaf for C{}fn main(){println!("{}",C.answer());}'};
  const session=new CompilerSession(),first=session.compile(files),snapshot=JSON.stringify(first.hir);
  assert.equal(run(first),'42\n');assert.equal(run(session.compile(files)),'42\n');
  files['src/main.rs']=files['src/main.rs'].replace('Leaf:Root','Leaf:Root+Copy');
  assert.throws(()=>session.compile(files),e=>e.code==='E0277');
  files['src/main.rs']=files['src/main.rs'].replace('struct C;','#[derive(Copy,Clone)]struct C;');
  assert.equal(run(session.compile(files)),'42\n');assert.equal(JSON.stringify(first.hir),snapshot);
});
test('cfg removes supertrait cycles before hierarchy construction',()=>{
  assert.doesNotThrow(()=>compile('#[cfg(any())]trait A:B{}#[cfg(any())]trait B:A{}fn main(){}'));
});
test('parameterized traits and concrete predicates no longer hit old boundaries',()=>{
  assert.doesNotThrow(()=>compile('trait A<T>{}fn main(){}'));
  assert.doesNotThrow(()=>compile('trait A where i32:Copy{}fn main(){}'));
  assert.throws(()=>compile('trait A:Fn(i32)->i32{}fn main(){}'),e=>e.code==='F_SUPERTRAIT_CALLABLE');
});

test('total traversal budget bounds repeated uncached queries',()=>{
  const graph=hierarchy('trait A{}trait B:A{}trait C:B{}',{maxTotalVisits:3,maxEntries:0});
  assert.deepEqual(new Set(graph.ancestors('C')),new Set(['A','B']));
  assert.throws(()=>graph.ancestors('C'),e=>e.code==='F_TRAIT_HIERARCHY_LIMIT');
});
test('invalid hierarchy limits fail before graph construction',()=>{
  for(const limits of [{maxVisits:NaN},{maxEntries:-1},{maxCharacters:Infinity},{maxTotalVisits:1.5}])
    assert.throws(()=>hierarchy('trait A{}',limits),RangeError);
});

test('documented supertrait example runs across the three backends',()=>{
  const documentation=readFileSync(new URL('../docs/supertraits.md',import.meta.url),'utf8');
  const sources=[...documentation.matchAll(/```rust\n([\s\S]*?)```/g)].map(match=>match[1]);
  assert.equal(sources.length,1);
  for(const source of sources)for(const optimize of [false,true]){
    const build=compile(source,{optimize});let output;
    vm.runInNewContext(build.js,{postMessage:value=>output=value},{timeout:2000});
    assert.equal(output,'42\n');assert.equal(run(build),'42\n');
    assert.equal(new WebAssemblyRuntime(build.wasm).run().output,'42\n');
  }
});
