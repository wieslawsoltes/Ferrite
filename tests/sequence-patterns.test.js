import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';

function execute(source, expected) {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(result.optimizedMir, {entry: result.entry}).run().output, expected, 'MIR');
    assert.equal(new WebAssemblyRuntime(result.wasm).run().output, expected, 'WebAssembly');
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 2000});
    assert.equal(output, expected, 'generated JavaScript');
    assert.equal(result.verification.status, 'verified');
  }
}

for (const [name, source, expected] of [
  ['array prefix and suffix projections', 'fn main(){let [first,..,last]=[2,3,5,7];println!("{} {}",first,last);}', '2 7\n'],
  ['bound array rest has its own array type', 'fn main(){let [first,mut middle @ ..,last]=[2,3,5,7];middle[0]=11;println!("{} {:?} {}",first,middle,last);}', '2 [11, 5] 7\n'],
  ['empty array and zero-length rest', 'fn main(){let []:[i32;0]=[];let [a,rest @ ..,b]=[4,9];println!("{} {:?} {}",a,rest,b);}', '4 [] 9\n'],
  ['rest-only tuple and array', 'fn main(){let (..)=(1,true,3);let [rest @ ..]=[6,7];println!("{:?}",rest);}', '[6, 7]\n'],
  ['tuple rest binds suffix positions', 'fn main(){let (first,..,mut last)=(1,true,4u64);last+=1;println!("{} {}",first,last);}', '1 5\n'],
  ['variant rest and whole scalar binding', 'enum E{V(i32,bool,i32)}fn main(){println!("{}",match E::V(2,true,9){E::V(x,..,y)=>x+y});let x=7;println!("{}",match x{v @ 1..10=>v,_=>0});}', '11\n7\n'],
  ['at with nested or alternatives', 'fn main(){println!("{}",match Some(8){all @ (Some(8)|Some(9))=>all.unwrap(),Some(n)=>n,None=>0});}', '8\n'],
  ['leading or in match', 'fn main(){println!("{}",match 3 {| 2|3=>4,_=>5});}', '4\n'],
  ['unbounded integer ranges cover complete type domains', 'fn f(x:i8)->i32{match x{..0=>1,0.. =>2}}fn main(){println!("{} {}",f(-128),f(127));}', '1 2\n'],
  ['unbounded byte and character ranges', 'fn f(x:u8)->i32{match x{..=127=>1,128.. =>2}}fn main(){println!("{} {} {}",f(255),match \'🦀\'{..=\'z\'=>0,\'{\'.. =>1},match b\'a\'{b\'a\'..=b\'z\'=>2,_=>3});}', '2 1 2\n'],
  ['nested array constructor coverage', 'fn f(a:[bool;2])->i32{match a{[true,_]=>1,[false,true]=>2,[false,false]=>3}}fn main(){println!("{}",f([false,false]));}', '3\n'],
  ['if let arrays and let else', 'fn f(a:[i32;3])->i32{let [0,n,..]=a else{return -1;};n}fn main(){if let [1,n,..]=[1,2,3]{println!("{}",n);}println!("{} {}",f([0,4,9]),f([1,4,9]));}', '2\n4 -1\n'],
  ['copy aggregates in at patterns do not alias', 'fn main(){let whole @ (mut part,..)=((1,),2);part.0=3;println!("{} {}",whole.0.0,part.0);}', '1 3\n'],
  ['bound rest remains independent of whole Copy array', 'fn main(){let whole @ [mut head @ ..,last]=[[1],[2],[3]];head[0][0]=8;println!("{} {} {}",whole[0][0],head[0][0],last[0]);}', '1 8 3\n'],
  ['non-Copy whole with only Copy sub-bindings', 'struct Pair{count:i32,text:String}fn main(){let whole @ Pair{count,..}=Pair{count:9,text:String::from("value")};println!("{} {}",count,whole.text);}', '9 value\n'],
]) test(name, () => execute(source, expected));

for (const [name, source, code] of [
  ['multiple rest positions', 'fn main(){let [a,..,..]=[1,2,3];}', 'E0528'],
  ['too many projections', 'fn main(){let [a,b,..]=[1];}', 'E0527'],
  ['wrong fixed arity', 'fn main(){let [a,b]=[1,2,3];}', 'E0527'],
  ['non-array scrutinee', 'fn main(){let [a,b]=(1,2);}', 'E0529'],
  ['standalone rest', 'fn main(){let .. = 1;}', 'E0797'],
  ['bound tuple rest', 'fn main(){let (a,tail @ ..)=(1,2,3);}', 'E0308'],
  ['incomplete array coverage', 'fn main(){let n=match [true,false]{[true,true]=>1};}', 'E0004'],
  ['refutable array let', 'fn main(){let [0,n]=[1,2];}', 'E0005'],
  ['inconsistent rest alternative bindings', 'fn main(){let n=match [1,2]{[a,rest @ ..]|[_,rest @ ..]=>a};}', 'E0408'],
  ['duplicate at bindings', 'fn main(){let n @ (n,_)=(1,2);}', 'E0416'],
  ['overlapping non-Copy moves', 'fn main(){let whole @ (part,_)=(String::from("x"),2);}', 'E0382'],
  ['missing inclusive endpoint', 'fn main(){let n=match 1{2..==>3,_=>4};}', 'E0586'],
]) test(`reject ${name}`, () => assert.throws(() => compile(source), error => error.code === code, source));

test('large unconstrained rests do not consume coverage recursion or emit a branch per ignored element', () => {
  const result = compile('fn f(x:[u8;1024])->u8{match x{[0,..]=>1,[1..,..]=>2}}fn main(){println!("{}",f([0;1024]));}');
  assert.equal(new MirVirtualMachine(result.optimizedMir, {entry:result.entry}).run().output, '1\n');
  const fn = result.mir.find(fn => fn.name === 'f' || fn.key === 'f');
  assert(fn.blocks.length < 30, `${fn.blocks.length} blocks for two explicit predicates`);
});

test('array coverage diagnostics include an uncovered array witness', () => {
  assert.throws(() => compile('fn main(){let n=match [true,false]{[true,true]=>1};}'), /\[false,/);
});
