import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, parse, tokenize} from '../src/engine.js';
import {ImplTypePattern} from '../src/compiler/ImplementationResolver.js';
import {TypeSystem as T} from '../src/compiler/TypeSystem.js';
import {SemanticAnalyzer} from '../src/compiler/SemanticAnalyzer.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

const run = build => new MirVirtualMachine(build.optimizedMir, {entry:build.entry}).run().output;
const variables = new Set(['T', 'U']);

test('impl matching agrees with a finite substitution oracle including invariant references', () => {
  const values = ['i32','bool','&i32','&mut i32','Vec<i32>','(u8,bool)'];
  const heads = ['Pair<T,U>','Pair<T,T>','Pair<T,Vec<U>>','Pair<Vec<T>,U>',
    'Pair<&T,&mut U>','Pair<(T,U),T>','Pair<[T;2],U>','Pair<fn(T)->U,T>'];
  let checks = 0;
  for (const head of heads) {
    const oracle = new Map();
    for (const t of values) for (const u of values) {
      const ground = T.substitute(head, new Map([['T',t],['U',u]]));
      if (!oracle.has(ground)) oracle.set(ground, {T:t,U:u});
    }
    const pattern = ImplTypePattern.parse(head, variables, 'definition:');
    for (const other of heads) for (const t of values) for (const u of values) {
      const ground = T.substitute(other, new Map([['T',t],['U',u]]));
      const result = ImplTypePattern.unify(pattern, ImplTypePattern.parse(ground));
      // The finite universe is only complete for results inside the value pool.
      // Verify every accepted binding by exact textual substitution (not TypeSystem.unify).
      if (result) {
        const substitution = new Map([...variables].map(name => [name,ImplTypePattern.render({variable:'definition:'+name},result)]));
        assert.equal(T.substitute(head,substitution),ground);
      }
      if (oracle.has(ground)) assert(result, head + ' failed to match ' + ground);
      if (result && [...variables].every(name => !head.includes(name) || values.includes(ImplTypePattern.render({variable:'definition:'+name},result))))
        assert(oracle.has(ground), head + ' differs from finite oracle for ' + ground);
      checks++;
    }
  }
  assert.equal(checks, 2304);
});

test('impl overlap alpha-renames variables and rejects recursive equations', () => {
  const pattern = (text,prefix) => ImplTypePattern.parse(text, variables, prefix);
  assert(ImplTypePattern.unify(pattern('Pair<T,T>','a:'),pattern('Pair<U,U>','b:')));
  assert.equal(ImplTypePattern.unify(pattern('Pair<T,T>','a:'),pattern('Pair<Vec<U>,U>','b:')),null);
  assert.equal(ImplTypePattern.unify(pattern('Pair<&mut T,T>','a:'),pattern('Pair<&U,U>','b:')),null);
  assert.equal(ImplTypePattern.unify(pattern('Pair<[T;2],T>','a:'),pattern('Pair<[U;3],U>','b:')),null);
});

test('impl side indexes do not mutate source declarations or instances', () => {
  const ast = parse(tokenize('struct Cell<T>(T);impl<T> Cell<T>{fn into(self)->T{self.0}}fn main(){let _=Cell(1).into();let _=Cell(true).into();}'));
  const before = JSON.stringify(ast), result = SemanticAnalyzer.analyze(ast);
  assert.equal(JSON.stringify(ast),before);
  assert.equal(result.instances.filter(instance => instance.fn.localName === 'into').length,2);
  assert.deepEqual(result.instances.filter(instance => instance.fn.localName === 'into').map(instance => instance.fn.owner).sort(),['Cell<bool>','Cell<i32>']);
});

test('method lookup excludes unrelated owners and unrelated member names', () => {
  const unrelated = Array.from({length:160},(_,i)=>`struct Type${i};impl Type${i}{fn get(&self)->i32{${i}}}`).join('\n');
  const build = compile(unrelated+'\nstruct Cell<T>(T);impl<T> Cell<T>{fn into(self)->T{self.0}}fn main(){println!("{}",Cell(7).into());}');
  assert.equal(run(build),'7\n');
  assert.equal(build.sem.implementations.candidatesExamined,1);
});

const project = () => ({
  'Cargo.toml':'[package]\nname="impl_queries"\nversion="0.1.0"',
  'src/main.rs':'mod cell;fn main(){println!("{}",cell::Cell(7).get());}',
  'src/cell.rs':'pub struct Cell<T>(pub T);impl<T:Copy> Cell<T>{pub fn get(&self)->T{self.0}}pub fn unrelated()->u32{1}',
});

test('generic methods replay immutably and body edits cannot reuse stale execution', () => {
  const files = project(), session = new CompilerSession();
  const first = session.compile(files), snapshot = JSON.stringify([first.hir,first.mir]);
  assert.equal(run(first),'7\n');
  assert.equal(run(session.compile(files)),'7\n');
  files['src/cell.rs'] = files['src/cell.rs'].replace('u32{1}','u32{2}');
  assert.equal(run(session.compile(files)),'7\n');
  files['src/cell.rs'] = files['src/cell.rs'].replace('self.0','{println!("changed");self.0}');
  assert.equal(run(session.compile(files)),'changed\n7\n');
  assert.equal(JSON.stringify([first.hir,first.mir]),snapshot);
});

test('impl method visibility, head and bound edits invalidate cached selection', () => {
  const original=project(),files={...original},session=new CompilerSession(); session.compile(files);
  files['src/cell.rs']=original['src/cell.rs'].replace('pub fn get','fn get');
  assert.throws(()=>session.compile(files),error=>error.code==='E0603');
  files['src/cell.rs']='pub struct Cell<T>(pub T);impl Cell<bool>{pub fn get(&self)->bool{self.0}}';
  assert.throws(()=>session.compile(files),error=>error.code==='E0599');
  files['src/cell.rs']=original['src/cell.rs'].replace('T:Copy','T:Copy+Missing');
  assert.throws(()=>session.compile(files),error=>['E0277','E0405'].includes(error.code));
  files['src/cell.rs']=original['src/cell.rs'];
  assert.equal(run(session.compile(files)),'7\n');
});

test('impl source relocation updates method spans without editing retained HIR', () => {
  const files=project(),session=new CompilerSession(),first=session.compile(files),snapshot=JSON.stringify(first.hir);
  files['src/cell.rs']='\n\n'+files['src/cell.rs'];
  const next=session.compile(files);
  assert.equal(run(next),'7\n');
  assert.equal(next.sem.instances.find(instance=>instance.name.endsWith('::get')).span.line,3);
  assert.equal(JSON.stringify(first.hir),snapshot);
});

test('cfg-filtered impls receive independent declaration and method lookup indexes', () => {
  const session=new CompilerSession(),files={'Cargo.toml':'[package]\nname="impl_cfg"\nversion="0.1.0"\n[features]\nextra=[]',
    'src/main.rs':'struct Cell<T>(T);#[cfg(feature="extra")]impl<T> Cell<T>{fn value(self)->i32{2}}#[cfg(not(feature="extra"))]impl<T> Cell<T>{fn value(self)->i32{1}}fn main(){println!("{}",Cell(true).value());}'};
  for (const [features,expected] of [[[],'1\n'],[['extra'],'2\n'],[[],'1\n']])
    assert.equal(run(session.compile(files,'check',{features})),expected);
});

test('generic implementation documentation examples execute', async () => {
  const {readFile}=await import('node:fs/promises');
  const text=await readFile(new URL('../docs/generic-impls.md',import.meta.url),'utf8');
  const examples=[...text.matchAll(/```rust\n([\s\S]*?)```/g)];
  assert.equal(examples.length,2);
  for(const [i,match] of examples.entries())for(const optimize of [false,true])
    assert.equal(run(compile(match[1],{optimize})),i===0?'7 9\n4294967296\n':'42 true\n');
});
