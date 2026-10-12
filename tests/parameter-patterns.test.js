import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile, parse, tokenize, analyze} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {ParameterPatterns} from '../src/compiler/patterns/ParameterPatterns.js';
import {parameterPatternCases, parameterPatternCompileFailCases, parameterPatternCapabilityCases, parameterPatternRegionSafetyCases} from './fixtures/parameter-patterns.js';

const execute = artifact => new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)), {entry:artifact.entry}).run().output;
for (const [name,source,expected] of parameterPatternCases) test(name, () => {
  for (const optimize of [false,true]) {
    const artifact=compile(source,{optimize});
    assert.equal(execute(artifact),expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output,expected);
    const context=vm.createContext({});vm.runInContext(artifact.js,context,{timeout:3000});
    assert.equal(vm.runInContext('r.output',context),expected);
  }
});
for (const [name,source,code] of parameterPatternCompileFailCases) test(`reject ${name}`, () => {
  for (const optimize of [false,true]) assert.throws(()=>compile(source,{optimize}),error=>{
    assert.equal(error.code,code,error.stack);assert.ok(error.span.end>error.span.start);return true;
  });
});
// Native-valid capability limits, never counted as native compile-fail fixtures.
for (const [name,source,code] of parameterPatternCapabilityCases) test(`capability ${name}`, () => {
  for (const optimize of [false,true]) assert.throws(()=>compile(source,{optimize}),{code});
});

const freeze=value=>{
  if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
  return value;
};
const walk=function*(value){
  if(!value||typeof value!=='object')return;
  yield value;for(const child of Object.values(value))yield*walk(child);
};

test('parameter patterns preserve frozen accepted and rejected syntax and tokens',()=>{
  for(const [accepted,cases] of [[true,parameterPatternCases],[false,parameterPatternCompileFailCases]]){
    for(const [,source,result] of cases){
      const tokens=freeze(tokenize(source)),tokenText=JSON.stringify(tokens);let ast;
      try{ast=freeze(parse(tokens));}catch(error){assert.equal(accepted,false);assert.equal(error.code,result);continue;}
      const syntax=JSON.stringify(ast);
      if(accepted)assert.equal(execute(compile('',{ast})),result);
      else assert.throws(()=>compile('',{ast}),{code:result});
      assert.equal(JSON.stringify(tokens),tokenText);assert.equal(JSON.stringify(ast),syntax);
    }
  }
});

test('parameter ABI indices remain distinct from source binding counts',()=>{
  const source='fn f((a,b):(i32,i32),r:&i32,(c,d):(i32,i32))->&i32{let sum=a+b+c+d;r}fn main(){let n=42;println!("{}",*f((1,2),&n,(3,4)));}';
  const artifact=compile(source),semantic=analyze(parse(tokenize(source)));
  const instance=semantic.instances.find(f=>f.name==='f');
  assert.deepEqual(instance.fn.params.map(p=>p.binding.slot),[0,1,2]);
  for(const name of ['a','b','c','d'])assert.ok(instance.locals.find(l=>l.name===name).slot>=3);
  assert.deepEqual(instance.referenceContract.sources,[1]);
  assert.equal(instance.fn.body.body.filter(s=>s.id?.endsWith(':entry')).length,2);
  assert.deepEqual(artifact.mir.find(f=>f.name==='f').params,[0,1,2]);
  assert.equal(execute(artifact),'42\n');
});

test('parameter prologues and projected loan reports replay actual cached typed HIR',()=>{
  const source='fn f((a,b):&mut(i32,i32)){*a+=*b;}fn main(){let mut p=(40,2);f(&mut p);println!("{}",p.0);}';
  const cache=new SemanticQueryCache();let reports;
  for(let i=0;i<3;i++){
    cache.beginBuild();const artifact=compile(source,{queryCache:cache});assert.equal(execute(artifact),'42\n');
    if(reports){assert.deepEqual(artifact.ownership,reports);for(const stage of ['type','ownership','mir'])assert.ok(artifact.queries.nodes.some(q=>q.stage===stage&&q.cacheHit));}
    else reports=structuredClone(artifact.ownership);
    const parameter=artifact.ownership.find(r=>r.instance==='f<>');
    assert.ok(parameter.patternWork>0);assert.ok(parameter.events.some(e=>(e.kind??e.action??'').endsWith('pattern loan')));
    cache.beginBuild();assert.throws(()=>compile(source.replace('*a+=*b;', 'let r=&*a;*a+=*b;println!("{}",*r);'),{queryCache:cache}),{code:'E0502'});
  }
});

test('parameter pattern edits invalidate callers independently of function bodies',()=>{
  const cache=new SemanticQueryCache();
  const first='fn f((a,b):(i32,i32))->i32{a-b}fn main(){println!("{}",f((40,2)));}';
  cache.beginBuild();assert.equal(execute(compile(first,{queryCache:cache})),'38\n');
  cache.beginBuild();const changed=compile(first.replace('f((a,b):','f((b,a):'),{queryCache:cache});
  assert.equal(execute(changed),'-38\n');
  assert.ok(changed.queries.nodes.some(n=>n.id==='type:main<>'&&!n.cacheHit));
});

test('parameter source metadata cannot forge local slots, copies or address authority',()=>{
  const source='fn f((a,b):&mut(i32,i32)){*a+=*b;}fn main(){let mut p=(40,2);f(&mut p);println!("{}",p.0);}';
  const ast=parse(tokenize(source));
  for(const node of [...walk(ast)])if(node.kind==='param'||node.kind?.endsWith('Pattern')){
    node.binding={slot:999999,name:'forged',mutable:true,type:'i32'};node.copy=true;
    node.patternStorage={slot:999999};node.patternBorrowed=true;node.autoDeref=true;
  }
  const serialized=JSON.stringify(ast);assert.equal(execute(compile('',{ast:freeze(ast)})),'42\n');assert.equal(JSON.stringify(ast),serialized);
  const invalid=parse(tokenize('fn f<T>((x,_):(T,T)){let a=x;let b=x;}fn main(){f((1,2));}'));
  for(const node of [...walk(invalid)])if(node.kind==='bindingPattern'){node.copy=true;node.binding={slot:0,type:'i32'};}
  assert.throws(()=>compile('',{ast:freeze(invalid)}),{code:'E0382'});
});

for(const [key,limit] of [['MAX_PARAMETERS',1],['MAX_PATTERN_NODES',1],['MAX_PATTERN_DEPTH',0]])test(`parameter ${key} fails and recovers`,()=>{
  const source='fn f((a,b):(i32,i32),c:i32)->i32{a+b+c}fn main(){println!("{}",f((30,10),2));}';
  const cache=new SemanticQueryCache(),old=ParameterPatterns[key];
  try{ParameterPatterns[key]=limit;assert.throws(()=>compile(source,{queryCache:cache}),{code:'F_OWNERSHIP_LIMIT'});}
  finally{ParameterPatterns[key]=old;}
  cache.beginBuild();assert.equal(execute(compile(source,{queryCache:cache})),'42\n');
});

test('malformed parameter pattern metadata is diagnosed',()=>{
  for(const mutate of [
    p=>{p.pattern.items=null;},p=>{p.name='forged';},p=>{p.pattern.items[0].name='not a name';},
    p=>{p.pattern.items[0]={kind:'unknown',span:p.span};}
  ]){
    const ast=parse(tokenize('fn f((a,b):(i32,i32)){}fn main(){f((1,2));}'));mutate(ast.items[0].params[0]);
    assert.throws(()=>compile('',{ast:freeze(ast)}),{code:'F_PARAMETER_PATTERN'});
  }
});

test('simple name-only parameter syntax stays backwards compatible',()=>{
  const fn=parse(tokenize('fn f(mut x:i32,y:i32)->i32{x+y}')).items[0];
  assert.deepEqual(fn.params.map(p=>[p.name,p.mutable,p.pattern]),[['x',true,undefined],['y',false,undefined]]);
});

test('uninstantiated generic body checking remains an explicit existing boundary',()=>{
  // Native Rust rejects this declaration before a call. Ferrite still checks
  // generic bodies on instantiation; do not count this as a native-valid case.
  const unused='fn invalid<T>((a,b):T){}fn main(){}';
  assert.doesNotThrow(()=>compile(unused));
  assert.throws(()=>compile(unused.replace('fn main(){}','fn main(){invalid((1,2));}')),{code:'E0308'});
});


test('parameter traversal rejects cyclic or shared graphs before recursive checking',()=>{
  const pattern={kind:'referencePattern',span:{start:0,end:1}};pattern.pattern=pattern;
  assert.throws(()=>ParameterPatterns.clean(pattern,{work:0}),{code:'F_PARAMETER_PATTERN'});
  const child={kind:'bindingPattern',name:'x',span:pattern.span};
  assert.throws(()=>ParameterPatterns.clean({kind:'tuplePattern',items:[child,child],span:pattern.span},{work:0}),{code:'F_PARAMETER_PATTERN'});
});

test('empty malformed parameter item lists report a source diagnostic after configuration filtering',()=>{
  const ast=parse(tokenize('fn f((a,b):(i32,i32)){}fn main(){f((1,2));}'));ast.items[0].params[0].pattern.items=[null];
  assert.throws(()=>compile('',{ast:freeze(ast)}),{code:'E0527'});
});

test('parameter guide is executable and matches the documented source',()=>{
  const source=readFileSync(new URL('../examples/14-parameter-patterns.rs',import.meta.url),'utf8');
  const doc=readFileSync(new URL('../docs/parameter-patterns.md',import.meta.url),'utf8');
  assert.equal(doc.split('```rust\n')[1].split('```')[0],source);
  assert.equal(execute(compile(source)),'42 44\n');
});

for(const [name,source,code] of parameterPatternRegionSafetyCases)test(`safety ${name}`,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),{code});
});
