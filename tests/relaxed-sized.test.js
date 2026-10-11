import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {Parser} from '../src/compiler/Parser.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {SemanticQueryCache} from '../src/compiler/SemanticQueryCache.js';
import {SizedTypes} from '../src/compiler/SizedTypes.js';
import {ImplObligations} from '../src/compiler/ImplObligations.js';
import {TraitMethodScope} from '../src/compiler/TraitMethodScope.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {relaxedSizedCases, relaxedSizedCompileFailCases, relaxedSizedSyntaxFailCases} from './fixtures/relaxed-sized.js';

const execute = compiled => new MirVirtualMachine(JSON.parse(JSON.stringify(compiled.optimizedMir)), {entry: compiled.entry}).run().output;
const analyzer = source => new SemanticAnalyzer(Parser.parse(Lexer.tokenize(source)));
for (const [name, source, output] of relaxedSizedCases) test(name, () => {
  for (const optimize of [false, true]) {
    const compiled=compile(source,{optimize});
    assert.equal(execute(compiled),output);
    assert.equal(new WebAssemblyRuntime(compiled.wasm).run().output,output);
    const context=vm.createContext({});
    vm.runInContext(compiled.js,context,{timeout:3000});
    assert.equal(vm.runInContext('r.output',context),output);
  }
});
for (const [name, source, code] of [...relaxedSizedCompileFailCases,...relaxedSizedSyntaxFailCases]) test(name, () => {
  for (const optimize of [false,true]) assert.throws(()=>compile(source,{optimize}),error=>{
    assert.equal(error.code,code,error.stack);
    assert.ok(error.span,'a declaration or use-site diagnostic must retain its source');
    return true;
  });
});

test('relaxed bounds keep original syntax and source spans in a frozen AST', () => {
  const source='fn f<T:(?Sized)>(_:&T)->i32 where T:?Sized{7}fn main(){}';
  const ast=Parser.parse(Lexer.tokenize(source)),generic=ast.items[0].generics[0];
  assert.deepEqual(generic.bounds,[]);
  assert.equal(generic.relaxedBounds[0].bound,'Sized');
  assert.ok(generic.relaxedBounds[0].span.start<generic.relaxedBounds[0].span.end);
  assert.equal(ast.items[0].predicates[0].relaxedBounds[0].bound,'Sized');
  const accepted=Parser.parse(Lexer.tokenize(source.replace(' where T:?Sized','')));
  const before=JSON.stringify(accepted);
  const freeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}};
  freeze(accepted);
  for(const optimize of[false,true])assert.equal(execute(compile('',{ast:accepted,optimize})), '');
  assert.equal(JSON.stringify(accepted),before);
});

test('Sized and Copy evidence is declaration-local, including phantom storage', () => {
  const a=analyzer('fn loose<T:?Sized>(){}fn strict<T>(){}fn restored<T:?Sized+Copy>(){}fn main(){}');
  for(let i=0;i<4;i++)for(const[name,expected]of[['loose',false],['strict',true],['restored',true]]) {
    const fn=a.index.functions.get(name),scope=new TraitMethodScope(a,fn,new Map([['T','i32']]));
    assert.equal(scope.sizedOrigin('T'),expected);
    assert.equal(scope.sizedOrigin('&T'),true);
    const proof=new ImplObligations(a,{target:null,impl:fn},fn);
    assert.equal(proof.prove('std::marker::PhantomData<T>','core::marker::Sized'),true);
    assert.equal(proof.prove('std::marker::PhantomData<T>','core::marker::Copy'),true);
    assert.equal(proof.prove('(T,)','core::marker::Sized'),expected);
  }
});

test('storage traversal follows actual fields, not every type argument', () => {
  const a=analyzer('struct Tail<T:?Sized>(u8,T);struct Phantom<T:?Sized>(std::marker::PhantomData<T>);struct FnSlot<T:?Sized>(fn(&T)->i32);struct W<T>(T);fn main(){}');
  for(let i=0;i<4;i++)for(const[type,expected]of[
    ['str',false],['&str',true],['Tail<str>',false],['&Tail<str>',true],
    ['Phantom<str>',true],['FnSlot<str>',true],['W<W<u8>>',true],['(u8,str)',false]
  ]) assert.equal(a.hasTrait(type,'Sized'),expected,type);
  assert.equal(a.index.sizedTypes.active.size,0);
  assert.ok(a.index.sizedTypes.snapshot().storageFields>0);
});

test('concrete well-formedness cache is bounded and never caches failed obligations', () => {
  const a=analyzer('struct S<T>(std::marker::PhantomData<T>);fn main(){}');
  const service=new SizedTypes(a.index,{maxEntries:2,maxCharacters:16});
  for(let i=0;i<4;i++)for(const type of['u8','S<u16>','(bool,u8)','std::marker::PhantomData<str>']) {
    service.checkConcrete(type,a,a.index.functions.get('main'));
    assert.ok(service.concrete.size<=2);
    assert.ok(service.characters<=16);
    assert.equal(service.characters,[...service.concrete].reduce((sum,t)=>sum+t.length,0));
  }
  assert.throws(()=>service.checkConcrete('S<str>',a),e=>e.code==='E0277');
  assert.equal(service.concrete.has('S<str>'),false);
  service.checkConcrete('S<u8>',a);
  const none=new SizedTypes(a.index,{maxEntries:0});none.checkConcrete('u8',a);
  assert.equal(none.characters,0);assert.equal(none.concrete.size,0);
});

test('storage proof budgets unwind active edges and allow explicit recovery', () => {
  const a=analyzer('struct W<T>(T);fn main(){}');
  for(const options of[{maxQueries:0},{maxDepth:0},{maxTypeCharacters:2}]) {
    const service=new SizedTypes(a.index,options),prove=t=>service.structural(t,prove);
    assert.throws(()=>prove('W<W<u8>>'),e=>e.code==='F_SIZED_LIMIT');
    assert.equal(service.active.size,0);
    service.maxQueries=1000;service.maxDepth=128;service.maxTypeCharacters=1000;
    assert.equal(prove('W<W<u8>>'),true);
  }
  for(const field of['maxQueries','maxDepth','maxTypeCharacters','maxEntries','maxCharacters'])
    for(const value of[-1,NaN,Infinity,0.5])assert.throws(()=>new SizedTypes(a.index,{[field]:value}),RangeError);
});

test('real semantic-query replay invalidates relaxed bounds and recovers after failure', () => {
  const cache=new SemanticQueryCache();
  const source='fn f<T:?Sized>(_:&T)->i32{7}fn main(){println!("{}",f::<str>("hi"));}';
  for(let i=0;i<2;i++) {
    cache.beginBuild();const r=compile(source,{queryCache:cache});assert.equal(execute(r),'7\n');
    if(i)assert.ok(r.queries.hits>0,'must replay checked HIR, not only parser output');
  }
  cache.beginBuild();assert.throws(()=>compile(source.replace('T:?Sized','T'),{queryCache:cache}),e=>e.code==='E0277');
  cache.beginBuild();assert.equal(execute(compile(source,{queryCache:cache})),'7\n');
  cache.beginBuild();assert.equal(execute(compile(source.replace('i32{7}','i32{9}'),{queryCache:cache})),'9\n');
});

test('metadata is refreshed when indexed trait contracts replace generic arrays', () => {
  const a=analyzer('fn f<T>(){}fn main(){}'),d={generics:[{name:'T',bounds:[]}],predicates:[]};
  const service=a.index.sizedTypes;
  assert.equal(service.requiresParameter(d,'T'),true);
  d.generics=[{name:'T',bounds:[],relaxedBounds:[{bound:'Sized'}]}];
  assert.equal(service.requiresParameter(d,'T'),false);
  d.generics=[{name:'T',bounds:[]}];
  assert.equal(service.requiresParameter(d,'T'),true);
  d.predicates=[{type:'T',bounds:[],relaxedBounds:[{bound:'Sized'}]}];
  assert.equal(service.requiresParameter(d,'T'),false);
});

test('relaxed syntax and source proof identities never reach executable MIR types', () => {
  const source='trait Text{fn count(&self)->usize;}impl Text for str{fn count(&self)->usize{self.len()}}fn len<T:?Sized+Text>(x:&T)->usize{x.count()}fn main(){println!("{}",len::<str>("café"));}';
  const compiled=compile(source);
  assert.equal(execute(compiled),'5\n');
  for(const fn of compiled.optimizedMir)for(const type of[fn.returnType,...fn.registers.map(r=>r.type)]) {
    assert.ok(!type.includes('?Sized'),type);
    assert.ok(!/\bT\b/.test(type),type);
  }
  assert.ok(compiled.sem.sizedTypes.queries>0);
  assert.ok(compiled.sem.sizedTypes.checkedDeclarations>0);
});
