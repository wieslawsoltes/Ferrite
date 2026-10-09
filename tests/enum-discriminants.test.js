import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, tokenize, parse} from '../src/engine.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {discriminantCases, discriminantCompileFailCases} from './fixtures/enum-discriminants.js';

function outputs(c) {
  const mir = new MirVirtualMachine(JSON.parse(JSON.stringify(c.optimizedMir)), {entry:c.entry}).run().output;
  const wasm = new WebAssemblyRuntime(c.wasm.bytes).run().output;
  let js; vm.runInNewContext(c.js, {postMessage:output => {js=output;}}, {timeout:3000});
  return [mir, wasm, js];
}
for (const [name, source, output] of discriminantCases) test(name, () => {
  for (const optimize of [false,true]) assert.deepEqual(outputs(compile(source,{optimize})), [output,output,output]);
});
for (const [name, source, code] of discriminantCompileFailCases) test(name, () => {
  for (const optimize of [false,true]) assert.throws(() => compile(source,{optimize}), e => e.code === code);
});
test('enum discriminants do not mutate reusable syntax or tokens', () => {
  const tokens = tokenize('enum E{A=2,B}fn main(){let _=E::B as i32;}'), ast = parse(tokens);
  const before = structuredClone({tokens,ast}); compile('',{tokens,ast});
  assert.deepEqual({tokens,ast},before);
});
test('discriminant table and const callee edits invalidate incremental callers', () => {
  const queryCache = new SemanticQueryCache();
  const source = n => `const fn start()->isize{${n}}enum E{A=start(),B}fn value()->i32{E::B as i32}fn main(){println!("{}",value());}`;
  for (const n of [5,9,5]) {
    queryCache.beginBuild(); const c=compile(source(n),{queryCache});
    assert.deepEqual(outputs(c),Array(3).fill(`${n+1}\n`));
  }
});
test('cached typed casts acquire this build’s resolved tables without changing stored HIR', () => {
  const queryCache=new SemanticQueryCache();
  const source='enum E{A=5,B}fn main(){println!("{}",E::B as u8);}';
  compile(source,{queryCache});const before=structuredClone([...queryCache.entries]);
  queryCache.beginBuild();const c=compile(source,{queryCache});
  assert.deepEqual(outputs(c),['6\n','6\n','6\n']);assert.ok(c.queries.hits>0);
  const after=new Map(queryCache.entries);
  for(const [key,value] of before)assert.deepEqual(after.get(key),value);
});
test('cfg filtering determines implicit discriminant order and cache identity', () => {
  const source='enum E{A=3,#[cfg(feature="extra")]B,C}fn main(){println!("{}",E::C as u8);}';
  const queryCache=new SemanticQueryCache();
  for(const [features,value] of [[[],4],[['extra'],5],[[],4]]) assert.deepEqual(outputs(compile(source,{queryCache,configuration:{features}})),Array(3).fill(`${value}\n`));
});
test('long implicit runs resolve without recursive stack growth', () => {
  const source=`enum E{${Array.from({length:1500},(_,i)=>`V${i}`).join(',')}}fn main(){println!("{}",E::V1499 as u16);}`;
  assert.deepEqual(outputs(compile(source)),Array(3).fill('1499\n'));
});
test('discriminant constants obey compilation-wide and expression budgets', () => {
  const source='const fn n(x:isize)->isize{let mut i:isize=0;while i<x{i+=1;}i}enum E{A=n(8),B=E::A as isize+n(8)}fn main(){}';
  assert.throws(()=>compile(source,{constEvaluation:{maxSteps:50}}),e=>e.code==='F_CONST_BUDGET');
  assert.throws(()=>compile('enum E{A=loop{}}fn main(){}',{constEvaluation:{maxExpressionSteps:30}}),e=>e.code==='F_CONST_BUDGET');
});
test('MIR rejects unresolved and malformed discriminant metadata before emission', () => {
  const c=compile('enum E{A=9}fn main(){println!("{}",E::A as i32);}',{optimize:false});
  for(const table of [null,[],{'E::A':'NaN'},{'Other::A':'2'},{'E::A':'999999999999999999999999999999999999999999999'}]){
    const functions=structuredClone(c.mir);functions.flatMap(f=>f.blocks).flatMap(b=>b.instructions).find(i=>i.op==='discriminant').table=table;
    assert.throws(()=>MirVerifier.verify(functions),e=>e.code==='F_MIR');
  }
});
test('runtime rejects absent tags and inherited table entries', () => {
  const r=new Runtime();assert.throws(()=>r.discriminant({tag:'toString'},{}),e=>e.code==='R_ENUM');
  assert.throws(()=>r.discriminant({tag:'E::A'},Object.create({'E::A':'4'})),e=>e.code==='R_ENUM');
});

test('generated JavaScript hoists and deduplicates immutable discriminant tables', () => {
  const source='#[derive(Copy,Clone)]enum E{A=7,B}fn first(e:E)->i32{e as i32}fn second(e:E)->u8{e as u8}fn main(){let mut total=0;for _ in 0..10{total+=first(E::B)+second(E::A) as i32;}println!("{}",total);}';
  const c=compile(source,{optimize:false});
  assert.equal((c.js.match(/const d\d+=Object\.freeze\(/g)??[]).length,1);
  assert.ok(c.js.indexOf('const d0=') < c.js.indexOf('function f0('));
  assert.deepEqual(outputs(c),['150\n','150\n','150\n']);
  const castLines=c.js.split('\n').filter(line=>line.includes('r.discriminant('));
  assert.equal(castLines.length,2);assert.ok(castLines.every(line=>!line.includes('{')&&line.includes(',d0)')));
});
test('runtime discriminant caching observes edits, removals and independent metadata', () => {
  const runtime=new Runtime(), value={tag:'E::A'}, table={'E::A':'7'};
  assert.equal(runtime.discriminant(value,table),7n);
  assert.equal(runtime.discriminant(value,table),7n);
  table['E::A']='9'; assert.equal(runtime.discriminant(value,table),9n);
  table['E::A']=9; assert.throws(()=>runtime.discriminant(value,table),{code:'R_ENUM'});
  table['E::A']='8'; assert.equal(runtime.discriminant(value,table),8n);
  delete table['E::A']; assert.throws(()=>runtime.discriminant(value,table),{code:'R_ENUM'});
  assert.throws(()=>runtime.discriminant(value,Object.create({'E::A':'10'})),{code:'R_ENUM'});
  assert.equal(runtime.discriminant(value,{'E::A':'11'}),11n);
});
