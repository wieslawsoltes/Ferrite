import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';

export const controls = [
  ['outer label with a typed break through nested loops', `fn main(){let n:u16='outer:loop{for i in 0u16..5{if i==3{break 'outer i*2;}}};println!("{}",n);}`, '6\n'],
  ['continue an enclosing for loop', `fn main(){let mut n=0;'outer:for i in 0..4{for j in 0..3{if j==1{continue 'outer;}n+=i;}}println!("{}",n);}`, '6\n'],
  ['continue an enclosing while loop', `fn main(){let mut i=0;let mut n=0;'outer:while i<4{i+=1;loop{if i==2{continue 'outer;}n+=i;break;}}println!("{}",n);}`, '8\n'],
  ['label shadowing resolves lexically', `fn main(){'a:loop{'a:loop{print!("i");break 'a;}print!("o");break 'a;}}`, 'io'],
  ['labeled block joins break operands and tail', `fn choose(b:bool)->u8{'value:{if b{break 'value 7;}9}}fn main(){println!("{} {}",choose(true),choose(false));}`, '7 9\n'],
  ['labeled block exit through a nested loop', `fn main(){let n='b:{loop{break 'b 5;}};println!("{}",n);}`, '5\n'],
  ['while and for are unit expressions', `fn main(){let _:()=while false{};let _:()=for _ in 0..2{};println!("ok");}`, 'ok\n'],
  ['return expressions in match arms', `fn f()->i32{let x=match 2{1=>3,_=>return 9};x}fn main(){println!("{}",f());}`, '9\n'],
  ['break and continue expressions in match arms', `fn main(){let mut n=0;let x=loop{n+=1;match n{1=>continue,2=>break 7,_=>break 3};};println!("{}",x);}`, '7\n'],
  ['assignment is right associative and has unit value', `fn main(){let mut a=();let mut b=3;let c=(a=(b=4));println!("{} {:?} {:?}",b,a,c);}`, '4 () ()\n'],
  ['assignment evaluates RHS before assignee exactly once', `fn index()->usize{print!("l");0}fn rhs()->i32{print!("r");7}fn main(){let mut a=[1];a[index()]=rhs();a[index()]+=rhs();println!(" {}",a[0]);}`, 'rlrl 14\n'],
  ['primitive compound assignment reads destination after RHS', `fn main(){let mut x=1;x+={x=10;2};println!("{}",x);}`, '12\n'],
  ['a diverging break operand does not create an exit edge', `fn f()->u8{loop{break return 11;}}fn main(){println!("{}",f());}`, '11\n'],
  ['an early return does not resurrect later argument control flow', `fn pair(a:i32,b:i32){}fn f()->i32{pair(return 5,if true{1}else{2});3}fn main(){println!("{}",f());}`, '5\n'],
  ['a diverging match scrutinee does not create a live merge', `fn f()->i32{match return 8{_=>9}}fn main(){println!("{}",f());}`, '8\n'],
  ['a diverging while condition returns before its body', `fn f()->i32{while {return 3;true}{}9}fn main(){println!("{}",f());}`, '3\n'],
  ['a diverging array element does not lower later effects', `fn f()->i32{let a=[return 2,{print!("bad");3}];5}fn main(){println!("{}",f());}`, '2\n'],
  ['never return types verify without a return instruction', `fn fail()->!{panic!("bad")}fn main(){println!("ok");}`, 'ok\n'],
  ['labeled compile-time blocks and loops', `const N:u32='b:{let mut x=0u32; 'l:loop{x+=1;if x<4{continue 'l;}break 'b x*2;}};fn main(){println!("{}",N);}`, '8\n'],
];

for (const [name, source, output] of controls) test(name, () => {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(result.optimizedMir, {entry:result.entry}).run().output, output);
    assert.equal(new WebAssemblyRuntime(result.wasm).run().output, output);
    let actual;
    vm.runInNewContext(result.js, {postMessage:value=>{actual=value;}}, {timeout:2000});
    assert.equal(actual,output);
  }
});

for (const [name, source, code] of [
  ['unknown label', `fn main(){loop{break 'missing;}}`, 'E0426'],
  ['label cannot cross a closure boundary', `fn main(){'out:loop{let f=||{break 'out;};f();}}`, 'E0426'],
  ['continue cannot target a labeled block', `fn main(){'b:{continue 'b;}}`, 'E0696'],
  ['unlabeled break cannot leave a labeled block', `fn main(){loop{'b:{break;}}}`, 'E0695'],
  ['while cannot break with explicit unit value', `fn main(){while true{break ();}}`, 'E0571'],
  ['for cannot break with a value', `fn main(){for i in 0..3{break i;}}`, 'E0571'],
  ['labeled block break types must agree', `fn main(){let n='b:{if true{break 'b 3;}false};}`, 'E0308'],
  ['a loop body must be unit', `fn main(){loop{1}}`, 'E0308'],
  ['anonymous lifetime is not a label', `fn main(){'_:loop{}}`, 'E0262'],
  ['assignment in expression still needs a mutable place', `fn main(){let x=3;let y=(x=4);}`, 'E0596'],
]) test(`reject ${name}`, () => assert.throws(() => compile(source), e => e.code === code));

for (const source of [
  `fn leak(r:&i32)->&i32{'b:{let x=1;break 'b &x;}}fn main(){}`,
  `fn leak(r:&i32)->&i32{let x=1;match true{true=>return &x,false=>r}}fn main(){}`,
  `fn take(s:String){}fn main(){let s=String::from("x");loop{take(s);}}`,
  `struct S{x:String}fn take(s:S){}fn main(){let mut s=S{x:String::from("a")};take(s);s.x=String::from("b");}`,
]) test(`ownership rejects invalid expression control flow: ${source}`, () => {
  assert.throws(()=>compile(source),e=>['E0515','E0382'].includes(e.code));
});

test('returning a caller-owned reference through a labeled block is allowed', () => {
  const result=compile(`fn select(r:&i32)->&i32{'b:{break 'b r;}}fn main(){let a=7;println!("{}",*select(&a));}`);
  assert.equal(new MirVirtualMachine(result.optimizedMir,{entry:result.entry}).run().output,'7\n');
});
