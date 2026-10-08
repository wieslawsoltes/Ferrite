import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
const cases=[
 ['explicit parameters','fn main(){let add=|x:i32|x+1;println!("{}",add(4));}','5\n'],
 ['first-call inference','fn main(){let add=|x|x+1;println!("{}",add(4));}','5\n'],
 ['shared capture','fn main(){let n=8;let f=|x:i32|x+n;println!("{}",f(2));}','10\n'],
 ['mutable borrowed capture','fn main(){let mut n=1;let mut f=||{n+=1;n};println!("{} {}",f(),f());println!("{}",n);}','2 3\n3\n'],
 ['mutable moved capture is independent','fn main(){let mut n=1;let mut f=move||{n+=1;n};println!("{} {} {}",f(),f(),n);}','2 3 1\n'],
 ['Fn parameter context','fn apply<F:Fn(i32)->i32>(f:F,x:i32)->i32{f(x)} fn main(){let n=8;println!("{}",apply(|x|x+n,2));}','10\n'],
 ['FnMut parameter context','fn apply<F:FnMut(i32)->i32>(mut f:F)->i32{f(2)+f(3)} fn main(){let mut n=10;println!("{}",apply(|x|{n+=x;n}));}','27\n'],
 ['FnOnce ownership transfer','fn apply<F:FnOnce()->String>(f:F)->String{f()} fn main(){let s=String::from("own");println!("{}",apply(move||s));}','own\n'],
 ['escaping move closure','fn factory(x:i32)->impl Fn(i32)->i32 {move|y:i32|x+y} fn main(){let f=factory(40);println!("{}",f(2));}','42\n'],
 ['immediate closure invocation','fn main(){println!("{}",(|x:i32|x+1)(5));}','6\n'],
 ['nested lexical closure','fn main(){let x=5;let f=|v:i32|{let g=|z:i32|z+v+x;g(2)};println!("{}",f(1));}','8\n'],
 ['shadowed closure parameter','fn main(){let x=5;let f=|x:i32|{let x=x+1;x};println!("{} {}",f(1),x);}','2 5\n'],
 ['generated identifier isolation','struct __closure_0{x:i32} fn main(){let y=3;let f=|__environment:i32| __environment+y;println!("{}",f(4));}','7\n'],
 ['inferred early return','fn main(){let f=|x:i32| {if x>0{return 4;}return 9;};println!("{} {}",f(1),f(0));}','4 9\n']
];
for(const [name,source,expected] of cases)test(`closure: ${name} agrees across VM and JS`,()=>{
 const build=compile(source);assert.equal(new MirVirtualMachine(build.mir).run().output,expected);
 let actual;vm.runInNewContext(build.js,{postMessage:text=>actual=text},{timeout:1000});assert.equal(actual,expected);
 assert(build.sem.closures.length>0);
});
const errors=[
 ['FnMut requires mutable binding','fn main(){let mut n=1;let f=||{n+=1;};f();}',/immutable/],
 ['capture loan conflicts','fn main(){let mut n=1;let mut f=||{n+=1;n};n=7;println!("{}",f());}',/borrowed/],
 ['borrowed closure cannot escape','fn factory(x:i32)->impl Fn(i32)->i32 {|y:i32|x+y} fn main(){let f=factory(40);println!("{}",f(2));}',/reference to a local/],
 ['consumed closure is moved','fn main(){let s=String::from("own");let f=move||s;f();f();}',/moved/],
 ['moved capture is unavailable','fn main(){let s=String::from("own");let f=move||s;println!("{}",s);f();}',/moved/],
 ['call traits reject mutation under Fn','fn apply<F:Fn()->i32>(f:F)->i32{f()} fn main(){let mut n=0;apply(||{n+=1;n});}',/Trait obligation/],
 ['inferred parameters remain monomorphic','fn main(){let f=|x|x;f(1);f(true);}',/Type mismatch/],
 ['arity rejected','fn main(){let f=|x:i32|x;f();}',/expects/]
];
for(const [name,source,pattern] of errors)test('closure diagnostic: '+name,()=>assert.throws(()=>compile(source),pattern));
test('closure-related edits do not replay synthesized declarations from another build',()=>{
 const session=new CompilerSession(),files={'Cargo.toml':'[package]\nname="closures"\nversion="0.1.0"','src/main.rs':cases[0][1]};
 session.compile(files);files['src/main.rs']=cases[0][1].replace('x+1','x+2');
 const build=session.compile(files);assert.equal(new MirVirtualMachine(build.mir).run().output,'6\n');
 assert.equal(build.stages.find(s=>s.kind==='closures').data[0].trait,'Fn');
});
