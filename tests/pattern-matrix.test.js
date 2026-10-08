import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {CompilerSession} from '../src/project/CompilerSession.js';

function execute(source, expected) {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(result.optimizedMir, {entry: result.entry}).run().output, expected, 'register MIR');
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 1000});
    assert.equal(output, expected, 'generated JavaScript');
    assert.equal(new WebAssemblyRuntime(result.wasm).run().output, expected, 'WebAssembly');
    assert.equal(result.verification.status, 'verified');
  }
}

const cases = [
  ['or alternatives bind the selected enum payload', 'enum Either { Left(i32), Right(i32) } fn get(v: Either)->i32{ match v { Either::Left(n) | Either::Right(n) => n } } fn main(){println!("{} {}",get(Either::Left(5)),get(Either::Right(9)));}', '5 9\n'],
  ['numeric pattern intervals and boolean products', 'fn f(x:u8)->i32 {match x {0..=127=>1,128..=255=>2}} fn main(){println!("{} {}",f(3),f(200)); let v=(true,false); println!("{}",match v {(true,true)=>0,(true,false)=>1,(false,_)=>2});}', '1 2\n1\n'],
  ['nested Option coverage enumerates payload constructors', 'fn f(v:Option<bool>)->i32{match v {None=>0,Some(true)=>1,Some(false)=>2}} fn main(){println!("{}",f(Some(false)));}', '2\n'],
  ['struct field patterns and rest ignore omitted fields', 'struct P{x:i32,y:i32} fn main(){let p=P{x:6,y:8}; let P{x,..}=p; println!("{}",x); let q=P{x:4,y:2}; println!("{}",match q {P{x:0,y:_}=>0,P{x,y}=>x+y});}', '6\n6\n'],
  ['let-else success and return have correct scope and control flow', 'fn f(v:Option<i32>)->i32{let Some(n)=v else{return 7;}; n*2} fn main(){println!("{} {}",f(Some(5)),f(None));}', '10 7\n'],
  ['let-else in a for loop continues through the increment', 'fn main(){let values=[Some(1),None,Some(3)]; for value in values {let Some(n)=value else{continue;};println!("{}",n);}}', '1\n3\n'],
  ['constant names take precedence over binding patterns', 'const ZERO:i32=0; fn main(){println!("{}",match 9 {ZERO=>1,_=>2});}', '2\n'],
  ['unit and mutable grouped patterns', 'fn main(){let ()=(); let (mut n)=1; n+=1; println!("{}",n);}', '2\n'],
  ['negative and character ranges', 'fn f(n:i8)->i32{match n{-128..=-1=>1,0..=127=>2}} fn main(){println!("{} {}",f(-5),match \'m\'{\'a\'..=\'z\'=>3,_=>4});}', '1 3\n'],
  ['or-pattern predicates short-circuit wrong payload extraction', 'fn main(){let value:Option<i32>=None; println!("{}",match value{Some(0 | 2)=>1,Some(_)=>2,None=>3});}', '3\n'],
];
for (const [name, source, expected] of cases) test(name, () => execute(source, expected));

for (const [name, source, code] of [
  ['partial enum payload coverage', 'fn f(v:Option<i32>)->i32{match v{Some(0)=>1,None=>0}} fn main(){}', 'E0004'],
  ['partial tuple coverage', 'fn main(){let n=match (true,false){(true,true)=>1};}', 'E0004'],
  ['refutable let', 'fn main(){let Some(n)=Some(1);}', 'E0005'],
  ['refutable tuple let', 'fn main(){let (true,n)=(true,1);}', 'E0005'],
  ['refutable for', 'fn main(){for Some(n) in [Some(1)] {println!("{}",n);}}', 'E0005'],
  ['duplicate destructuring names', 'fn main(){let (n,n)=(1,2);}', 'E0416'],
  ['inconsistent or bindings', 'fn main(){let v:Option<i32>=None;let a=match v{Some(n)|None=>1};}', 'E0408'],
  ['inconsistent or binding modes', 'fn main(){let n=match (1,2){(mut a,_)|(_,a)=>a};}', 'E0409'],
  ['let-else must diverge', 'fn main(){let Some(n)=Some(1) else{println!("bad");};}', 'E0308'],
  ['let-else binding absent in failure arm', 'fn main(){let Some(n)=Some(1) else{println!("{}",n);return;};}', 'E0425'],
  ['uncovered numeric interval', 'fn f(x:u8)->i32{match x{0..=126=>1,128..=255=>2}} fn main(){}', 'E0004'],
  ['empty range', 'fn main(){let n=match 1{9..2=>0,_=>1};}', 'E0030'],
  ['guards do not prove coverage', 'fn main(){let n=match true{true if true=>1,false=>2};}', 'E0004'],
  ['missing struct fields', 'struct P{x:i32,y:i32}fn main(){let P{x}=P{x:1,y:2};}', 'E0027'],
]) test(`reject ${name}`, () => assert.throws(() => compile(source), error => error.code === code));

test('coverage witnesses identify the missing constructor and reports survive cached queries', () => {
  assert.throws(() => compile('fn main(){let n=match Some(false){Some(true)=>1,None=>0};}'), /Some\(false\)/);
  const session = new CompilerSession();
  const files = {'Cargo.toml': '[package]\nname="coverage"\nversion="0.1.0"', 'src/main.rs': 'fn main(){let x=1;println!("{}",x);}'};
  const first = session.compile(files);
  const second = session.compile({...files, 'unused.txt': 'changes do not affect semantic bodies'});
  assert(first.sem.patterns.length > 0);
  assert.deepEqual(second.sem.patterns, first.sem.patterns);
  assert(second.queries.hits > 0);
});
