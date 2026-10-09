import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile,parse,tokenize} from '../src/engine.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const run=build=>new MirVirtualMachine(build.optimizedMir,{entry:build.entry}).run().output;
const source='trait Value{fn value(&self)->i32{42}}struct C<T>(T);impl<T>Value for C<T>{}fn main(){println!("{}",C(true).value());}';

test('synthesized generic trait defaults never mutate input AST',()=>{
 const ast=parse(tokenize(source)),snapshot=JSON.stringify(ast);
 const result=SemanticAnalyzer.analyze(ast);
 assert.equal(JSON.stringify(ast),snapshot);
 assert(result.instances.some(instance=>instance.fn.defaultTrait==='Value'));
});

test('trait proof results exclude unrelated owners and are memoized',()=>{
 const declarations=Array.from({length:128},(_,i)=>`struct C${i};impl Mark for C${i}{}`).join('');
 const a=new SemanticAnalyzer(parse(tokenize(`trait Mark{}${declarations}fn main(){}`)));
 const solver=a.implementations.traits;
 const start=solver.candidatesExamined;
 for(let i=0;i<128;i++)assert.equal(a.hasBound(`C${i}`,'Mark'),true);
 assert.equal(solver.candidatesExamined-start,128);
 for(let i=0;i<128;i++)assert.equal(a.hasBound(`C${i}`,'Mark'),true);
 assert.equal(solver.candidatesExamined-start,128);
 assert(solver.hits>=128);
});

test('trait memoization has bounded entries and character retention',()=>{
 const a=new SemanticAnalyzer(parse(tokenize('trait Mark{}fn main(){}'))),solver=a.implementations.traits;
 for(let i=0;i<5000;i++)assert.equal(a.hasBound(`Unknown${i}`,'Mark'),false);
 assert.equal(solver.memo.size,4096);assert(solver.memoCharacters<=4000000);
 const before=solver.memo.size;solver.remember('x'.repeat(40000),false);assert.equal(solver.memo.size,before);
});

test('increasing trait recursion fails diagnostically instead of overflowing JS stack',()=>{
 assert.throws(()=>compile('trait Mark{}struct C<T>(T);impl<T>Mark for T where C<T>:Mark{}fn accept<T:Mark>(v:T){}fn main(){accept(1);}'),error=>['E0275','F_IMPL_BOUND_LIMIT'].includes(error.code));
});

const files=()=>({'Cargo.toml':'[package]\nname="trait_cache"\nversion="0.1.0"',
 'src/main.rs':'mod api;use api::Value;fn main(){println!("{}",api::C(true).value());}',
 'src/api.rs':'pub trait Value{fn value(&self)->i32{42}}pub struct C<T>(pub T);impl<T>Value for C<T>{}'});

test('default bodies and contracts invalidate immutable cached callers',()=>{
 const project=files(),session=new CompilerSession(),first=session.compile(project),snapshot=JSON.stringify(first.hir);
 assert.equal(run(first),'42\n');assert.equal(run(session.compile(project)),'42\n');
 project['src/api.rs']=project['src/api.rs'].replace('{42}','{43}');
 assert.equal(run(session.compile(project)),'43\n');
 project['src/api.rs']=project['src/api.rs'].replace('i32{43}','bool{true}');
 assert.equal(run(session.compile(project)),'true\n');
 assert.equal(JSON.stringify(first.hir),snapshot);
});

test('trait import removal invalidates cached method selection',()=>{
 const project=files(),session=new CompilerSession();assert.equal(run(session.compile(project)),'42\n');
 project['src/main.rs']=project['src/main.rs'].replace('use api::Value;','');
 assert.throws(()=>session.compile(project),error=>error.code==='E0599');
 project['src/main.rs']=files()['src/main.rs'];assert.equal(run(session.compile(project)),'42\n');
});

test('trait impl and predicate edits cannot reuse positive obligation proofs',()=>{
 const project=files(),session=new CompilerSession();assert.equal(run(session.compile(project)),'42\n');
 project['src/api.rs']=project['src/api.rs'].replace('impl<T>Value','impl<T:Copy>Value');assert.equal(run(session.compile(project)),'42\n');
 project['src/main.rs']=project['src/main.rs'].replace('C(true)','C(String::from("owned"))');
 assert.throws(()=>session.compile(project),error=>error.code==='E0277');
});

test('trait default source relocation updates spans without changing retained results',()=>{
 const project=files(),session=new CompilerSession(),first=session.compile(project),snapshot=JSON.stringify(first.hir);
 project['src/api.rs']='\n\n'+project['src/api.rs'];const next=session.compile(project);
 assert.equal(run(next),'42\n');assert.equal(JSON.stringify(first.hir),snapshot);
 assert.equal(next.sem.instances.find(instance=>instance.name.includes('::__trait')).span.line,3);
});

test('private traits cannot be named from another module',()=>{
 assert.throws(()=>compile('mod api{trait Mark{}}struct C;impl api::Mark for C{}fn main(){}'),error=>error.code==='E0603');
});

test('dependency orphan rules reject a foreign trait on foreign owner',()=>{
 const a=parse(tokenize('pub trait Mark{}pub struct C;'));
 a.items=a.items.map(item=>({...item,module:'dep',crateRoot:'dep',dependency:true}));
 const b=parse(tokenize('impl dep::Mark for dep::C{}fn main(){}'));
 assert.throws(()=>SemanticAnalyzer.analyze({...b,items:[...a.items,...b.items]}),error=>error.code==='E0117');
});

test('generic trait documentation examples execute on all backends',async()=>{
 const {readFile}=await import('node:fs/promises'),{WebAssemblyRuntime}=await import('../src/runtime/WebAssemblyRuntime.js'),vm=await import('node:vm');
 const text=await readFile(new URL('../docs/generic-traits.md',import.meta.url),'utf8');
 const examples=[...text.matchAll(/```rust\n([\s\S]*?)```/g)];assert.equal(examples.length,2);
 for(const [i,match] of examples.entries())for(const optimize of [false,true]){
  const build=compile(match[1],{optimize}),expected=i===0?'42\n':'7\n';
  assert.equal(run(build),expected);assert.equal(new WebAssemblyRuntime(build.wasm).run().output,expected);
  let out;vm.runInNewContext(build.js,{postMessage:value=>out=value},{timeout:2000});assert.equal(out,expected);
 }
});

test('standard library trait implementations retain an explicit unsupported diagnostic',()=>{
 assert.throws(()=>compile('struct C;impl Clone for C{fn clone(&self)->Self{C}}fn main(){}'),error=>error.code==='F_TRAIT_EXTERNAL');
});
