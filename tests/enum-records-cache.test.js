import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, parse, tokenize} from '../src/engine.js';
import {SymbolIndex} from '../src/compiler/SymbolIndex.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import vm from 'node:vm';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const run = c => new MirVirtualMachine(c.optimizedMir, {entry:c.entry}).run().output;
const files = () => ({'Cargo.toml':'[package]\nname="records"\nversion="0.1.0"',
  'src/main.rs':'mod data;fn main(){let e=data::E::R{y:2,x:1};let data::E::R{x,y}=e;println!("{} {}",x,y);}',
  'src/data.rs':'pub enum E{R{x:i32,y:i32}}pub fn unused()->i32{0}'});

test('enum field indices are declaration-local and do not mutate syntax', () => {
  const ast = parse(tokenize('enum E{R{x:i32,y:bool},T(i32),U}'));
  const before = structuredClone(ast), index = new SymbolIndex(ast), variants = index.enums.get('E').variants;
  assert.equal(index.variantPosition(variants[0], 'x'), 0);
  assert.equal(index.variantPosition(variants[0], 'y'), 1);
  assert.equal(index.variantPosition(variants[0], 'missing'), undefined);
  assert.equal(index.variantPosition(variants[1], '0'), 0);
  assert.equal(index.variantPosition(variants[2], '0'), undefined);
  assert.deepEqual(ast,before);
  let visits=0;
  const variant={fields:Array.from({length:1024},()=> 'i32'),members:Array.from({length:1024},(_,i)=>({get name(){visits++;return `f${i}`;}}))};
  for(let pass=0;pass<4;pass++)for(let i=0;i<1024;i++)assert.equal(index.variantPosition(variant,`f${i}`),i);
  assert.equal(visits,1024);
});

test('enum field reorder invalidates cached payload ordinals without modifying prior HIR', () => {
  const session=new CompilerSession(), source=files(), first=session.compile(source), snapshot=JSON.stringify(first.hir);
  assert.equal(run(first),'1 2\n');
  source['src/data.rs']='pub enum E{R{y:i32,x:i32}}pub fn unused()->i32{0}';
  const second=session.compile(source);assert.equal(run(second),'1 2\n');
  assert.equal(second.queries.nodes.find(node=>node.id==='type:main<>').cacheHit,false);
  assert.equal(JSON.stringify(first.hir),snapshot);
  source['src/data.rs']=source['src/data.rs'].replace('{0}','{1}');
  const third=session.compile(source);assert.equal(run(third),'1 2\n');
  assert.equal(third.queries.nodes.find(node=>node.id==='type:main<>').cacheHit,true);
});

test('enum field removal/type and privacy edits cannot replay old accepted constructors', () => {
  const session=new CompilerSession(), source=files();session.compile(source);
  for(const declaration of ['pub enum E{R{x:i32}}','pub enum E{R{x:bool,y:i32}}','enum E{R{x:i32,y:i32}}']) {
    source['src/data.rs']=declaration;
    assert.throws(()=>session.compile(source),e=>/^E\d+$/.test(e.code));
  }
  source['src/data.rs']=files()['src/data.rs'];assert.equal(run(session.compile(source)),'1 2\n');
});

test('record coverage witness includes missing named payload', () => {
  assert.throws(()=>compile('enum E{R{x:bool}}fn f(e:E)->i32{match e{E::R{x:true}=>1}}fn main(){}'),
    e=>e.code==='E0004' && /E::R/.test(e.message) && /x: false/.test(e.message));
});

test('large omitted enum payloads emit only selected projections', () => {
  const width=1024, fields=Array.from({length:width},(_,i)=>`f${i}:i32`).join(','), values=Array.from({length:width},(_,i)=>`f${i}:${i}`).reverse().join(',');
  const c=compile(`enum E{R{${fields}}}fn main(){let e=E::R{${values}};let E::R{f0:a,f1023:b,..}=e;println!("{} {}",a,b);}`,{optimize:false});
  assert.equal(run(c),'0 1023\n');
  assert.equal(new WebAssemblyRuntime(c.wasm).run().output,'0 1023\n');
  let output;vm.runInNewContext(c.js,{postMessage:s=>output=s},{timeout:2000});assert.equal(output,'0 1023\n');
  assert(c.wasm.metadata.imports.every(i=>i.params.length<=256));
  assert.equal(c.mir.flatMap(fn=>fn.blocks.flatMap(b=>b.instructions)).filter(i=>i.op==='payload').length,2);
});

test('cfg enum payload ordinals are rebuilt on every feature selection', () => {
  const session=new CompilerSession(), source={'Cargo.toml':'[package]\nname="record_cfg"\nversion="0.1.0"\n[features]\nextra=[]',
    'src/main.rs':'enum E{R{#[cfg(feature="extra")]unused:bool,x:i32}}#[cfg(feature="extra")]fn make()->E{E::R{unused:true,x:7}}#[cfg(not(feature="extra"))]fn make()->E{E::R{x:7}}fn main(){let E::R{x,..}=make();println!("{}",x);}'};
  for(const features of [[],['extra'],[]])assert.equal(run(session.compile(source,'check',{features})),'7\n');
});
