import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {compile,parse,tokenize} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {Runtime} from '../src/runtime/Runtime.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {PatternOwnership} from '../src/compiler/ownership/PatternOwnership.js';
import {patternReferenceCases,patternReferenceCompileFailCases,patternReferenceGuide} from './fixtures/pattern-references.js';
const output=artifact=>new MirVirtualMachine(JSON.parse(JSON.stringify(artifact.optimizedMir)),{entry:artifact.entry}).run().output;
for(const [name,source,expected] of patternReferenceCases)test(`reference pattern: ${name}`,()=>{
  for(const optimize of [false,true]){
    const artifact=compile(source,{optimize});assert.equal(output(artifact),expected);
    assert.equal(new WebAssemblyRuntime(artifact.wasm).run().output,expected);
    const context=vm.createContext({});vm.runInContext(artifact.js,context,{timeout:3000});assert.equal(vm.runInContext('r.output',context),expected);
  }
});
for(const [name,source,code] of patternReferenceCompileFailCases)test(`reference pattern rejects: ${name}`,()=>{
  for(const optimize of [false,true])assert.throws(()=>compile(source,{optimize}),error=>{
    assert.equal(error.code,code,error.stack);assert.ok(error.span.end>error.span.start);return true;
  });
});
const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;};
test('reference binding plans preserve accepted and rejected frozen source ASTs',()=>{
  for(const [accepted,cases]of[[true,patternReferenceCases],[false,patternReferenceCompileFailCases]])for(const[,source,expected]of cases){
    const ast=freeze(parse(tokenize(source))),before=JSON.stringify(ast);
    if(accepted)assert.equal(output(compile('',{ast})),expected);else assert.throws(()=>compile('',{ast}),{code:expected});
    assert.equal(JSON.stringify(ast),before);
  }
});
test('reference pattern origins and source-linked loans replay through real semantic queries',()=>{
  const cache=new SemanticQueryCache(),source=patternReferenceCases.find(([name])=>name==='tuple mutable sibling loans remain disjoint')[1];let expected;
  for(let i=0;i<3;i++){
    cache.beginBuild();const artifact=compile(source,{queryCache:cache});assert.equal(output(artifact),'3 5\n');
    if(expected){assert.deepEqual(artifact.ownership,expected);for(const stage of ['type','ownership','mir'])assert.ok(artifact.queries.nodes.some(node=>node.stage===stage&&node.cacheHit));}
    else expected=structuredClone(artifact.ownership);
    const report=artifact.ownership.find(r=>r.instance==='main<>');
    assert.deepEqual(report.events.filter(e=>e.kind==='mutable pattern loan').map(e=>report.places[e.place].name),['p.0','p.1']);
    assert.deepEqual(JSON.parse(JSON.stringify(report)),report);
    cache.beginBuild();assert.throws(()=>compile(source.replace('*a+=2;','p.0+=2;*a+=2;'),{queryCache:cache}),{code:'E0502'});
  }
});
test('pattern work budget failure is atomic and recovers with ref bindings',()=>{
  const previous=PatternOwnership.MAX_NODES,cache=new SemanticQueryCache();
  try{PatternOwnership.MAX_NODES=0;assert.throws(()=>compile(patternReferenceCases.find(([name])=>name==='tuple mutable sibling loans remain disjoint')[1],{queryCache:cache}),{code:'F_OWNERSHIP_LIMIT'});}
  finally{PatternOwnership.MAX_NODES=previous;}
  cache.beginBuild();assert.equal(output(compile(patternReferenceCases.find(([name])=>name==='tuple mutable sibling loans remain disjoint')[1],{queryCache:cache})),'3 5\n');
});
test('injected pattern binding modes cannot smuggle truthy non-boolean modifiers',()=>{
  const ast=parse(tokenize('fn main(){let mut x=1;let ref r=x;}'));ast.items[0].body.body[1].pattern.refMutable='yes';
  assert.throws(()=>compile('',{ast}),{code:'F_PATTERN_BINDING_MODE'});
});
test('source AST storage annotations cannot redirect a pattern to another local',()=>{
  const ast=parse(tokenize('fn main(){let mut a=1;let mut b=2;let ref mut r=a;*r=7;println!("{} {}",a,b);}'));
  ast.items[0].body.body[2].value.patternStorage={slot:1,type:'i32'};ast.items[0].body.body[2].value.patternBorrow=true;
  assert.equal(output(compile('',{ast})),'7 2\n');
});
test('enum payload place projection validates variant and bounds at runtime',()=>{
  const runtime=new Runtime(),cells=runtime.cells(1);cells[0].value=runtime.aggregate('enum',[1],[],'P::A');
  const project=(variant,index)=>runtime.reference(cells,0,[{kind:'payload',variant,index}]);
  runtime.write(runtime.borrow(project('P::A',0)),2);assert.equal(cells[0].value.values[0],2);
  for(const [variant,index]of[['P::B',0],['P::A',-1],['P::A',1],['P::A',0.5]])assert.throws(()=>runtime.borrow(project(variant,index)),{code:'R_REFERENCE'});
});
test('MIR verifier rejects malformed payload-place metadata',()=>{
  const artifact=compile(patternReferenceCases.find(([name])=>name==='match mutable enum payload updates original enum')[1],{optimize:false});
  for(const patch of [{index:-1},{variant:null},{index:0.5}]){
    const mir=structuredClone(artifact.optimizedMir),instruction=mir.flatMap(f=>f.blocks).flatMap(b=>b.instructions).find(i=>i.op==='borrow'&&i.place.path.some(p=>p.kind==='payload'));
    Object.assign(instruction.place.path.find(p=>p.kind==='payload'),patch);assert.throws(()=>MirVerifier.verify(mir),{code:'F_MIR'});
  }
});
// These are known native-valid capabilities not implemented by this increment;
// they are intentionally NOT part of the native compile-fail corpus.
for(const[name,source,code]of[
 ['borrowed array rest','fn main(){let a=[1,2,3];let[ref first,ref rest @ ..]=a;println!("{} {:?}",*first,rest);}','F_PATTERN_BORROW_REST'],
 ['iteration storage','fn main(){for ref x in 0..3{println!("{}",*x);}}','F_PATTERN_BORROW_SOURCE'],
 ['mutable reference-valued storage','fn main(){let x=1;let mut r=&x;let ref mut s=r;println!("{}",**s);}','F_PATTERN_REFERENCE_MUTATION'],
 ['untracked aggregate reference storage','fn main(){let x=1;let t=(&x,);let ref r=t;println!("{}",*r.0);}','F_PATTERN_REFERENCE_CARRIER'],
 ['untracked reference-valued field','fn main(){let x=1;let t=(&x,);let(ref r,)=t;println!("{}",**r);}','F_PATTERN_REFERENCE'],
 ['promotion of match temporary','fn main(){let r=match Some(1){Some(ref a)=>a,_=>panic!("bad")};println!("{}",*r);}','E0597'],
])test(`explicit native-valid capability boundary: ${name}`,()=>assert.throws(()=>compile(source),{code}));

test('reference pattern documentation and sample preserve the exact native fixture',()=>{
  assert.equal(readFileSync(new URL('../examples/12-pattern-references.rs',import.meta.url),'utf8'),patternReferenceGuide);
  const guide=readFileSync(new URL('../docs/pattern-references.md',import.meta.url),'utf8');
  assert.ok(guide.includes('```rust\n'+patternReferenceGuide+'```'));
});

test('injected source matched types cannot rewrite projection register types',()=>{
  const ast=parse(tokenize('fn main(){let p=(1,2);let(ref a,b)=p;println!("{} {}",*a,b);}'));
  ast.items[0].body.body[1].pattern.items[1].matchedType='&mut String';
  assert.equal(output(compile('',{ast})),'1 2\n');
});
test('reference modifiers cannot be attached to non-binding source patterns',()=>{
  const ast=parse(tokenize('fn main(){let(_,b)=(1,2);}'));
  ast.items[0].body.body[0].pattern.items[0].byRef=true;
  assert.throws(()=>compile('',{ast}),{code:'F_PATTERN_BINDING_MODE'});
});
