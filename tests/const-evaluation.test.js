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
    assert.equal(new MirVirtualMachine(result.optimizedMir, {entry: result.entry}).run().output, expected);
    assert.equal(new WebAssemblyRuntime(result.wasm).run().output, expected);
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout:2000});
    assert.equal(output, expected);
    assert(result.sem.constants.evaluations > 0);
    assert(!result.mir.some(fn => fn.instance.startsWith('$const$')), 'temporary CTFE entry points must not enter emitted code');
  }
}

for (const [name, source, expected] of [
  ['constant expressions in declaration order independent of dependencies', 'const A:u64=B*3;const B:u64=7;fn main(){println!("{} {}",A,A);}', '21 21\n'],
  ['constant names resolve in their declaration namespace', 'const BASE:i32=100;mod m{const BASE:i32=4;pub const VALUE:i32=BASE+2;}fn main(){println!("{} {}",BASE,m::VALUE);}', '100 6\n'],
  ['const fn runtime and compile-time calls share arithmetic', 'const fn square(x:u64)->u64{x*x}const N:u64=square(9);fn main(){println!("{} {}",N,square(5));}', '81 25\n'],
  ['recursive const fn and conditional execution', 'const fn fib(n:u32)->u32{if n<2{n}else{fib(n-1)+fib(n-2)}}const N:u32=fib(10);fn main(){println!("{}",N);}', '55\n'],
  ['mutable const locals and while', 'const fn sum(n:u32)->u32{let mut i=0u32;let mut s=0u32;while i<n{i+=1;s+=i;}s}const N:u32=sum(10);fn main(){println!("{}",N);}', '55\n'],
  ['loop break values at compile time', 'const N:i32={let mut n=0;loop{n+=1;if n==4{break n*3;}}};fn main(){println!("{}",N);}', '12\n'],
  ['compile-time tuple and array values', 'const PAIR:(i32,bool)=(2*3,true);const VALUES:[u8;3]=[1,2,3];fn main(){println!("{} {} {:?}",PAIR.0,PAIR.1,VALUES);}', '6 true [1, 2, 3]\n'],
  ['compile-time struct and enum values', '#[derive(Copy,Clone)]struct S{v:i32}enum E{V(i32),Empty}const S1:S=S{v:7*3};const E1:E=E::V(8);fn main(){println!("{} {}",S1.v,match E1{E::V(n)=>n,E::Empty=>0});}', '21 8\n'],
  ['array sizes accept const paths and expressions', 'const N:usize=3;fn f(a:[u8;N+1])->u8{a[3]}fn main(){let a:[u8;N+1]=[9;N+1];println!("{}",f(a));}', '9\n'],
  ['const fn returns an array used as an initializer', 'const fn make()->[i32;3]{let mut a=[0;3];a[1]=4;a[2]=8;a}const VALUES:[i32;3]=make();fn main(){println!("{:?}",VALUES);}', '[0, 4, 8]\n'],
  ['array length in transparent aliases', 'const N:usize=2;type A<T>=[T;N*2];fn main(){let a:A<u8>=[3;4];println!("{:?}",a);}', '[3, 3, 3, 3]\n'],
  ['inline const captures items but not runtime locals', 'const N:i32=4;fn main(){let x=const{let y=N+1;y*y};println!("{}",x);}', '25\n'],
  ['computed constants used in patterns and range endpoints', 'const LO:i32=1+1;const HI:i32=LO*4;fn main(){println!("{} {}",match 3{LO..=HI=>1,_=>0},match 8{HI=>9,_=>0});}', '1 9\n'],
  ['dead branches still type-check without executing invalid arithmetic', 'const N:i32=if true{5}else{1/0};const B:bool=false && 1/0==2;fn main(){println!("{} {}",N,B);}', '5 false\n'],
  ['generic const fn specialization', 'const fn identity<T:Copy>(x:T)->T{x}const N:u64=identity(7u64);fn main(){println!("{}",N);}', '7\n'],
  ['const methods', 'struct S{x:i32}impl S{const fn value(self)->i32{self.x}}const N:i32=S{x:8}.value();fn main(){println!("{}",N);}', '8\n'],
  ['literal punctuation in a const array-size expression', 'type A<T>=([T;"T,<>,;".len()],u8);fn main(){let a:A<u8>=([3;6],9);println!("{} {}",a.0[5],a.1);}', '3 9\n'],
  ['braced const comparisons do not break structural type delimiters', 'type A=([u8;if 1<2{3}else{4}],bool);fn main(){let a:A=([7;3],true);println!("{}",a.0[2]);}', '7\n'],
  ['qualified scalar constants in patterns', 'mod m{pub const N:i32=2*3;}fn main(){println!("{}",match 6{m::N=>8,_=>0});}', '8\n'],
  ['raw constant identifiers inside type lengths', 'const r#type:usize=3;fn main(){let a:[i32;r#type]=[4;r#type];println!("{:?}",a);}', '[4, 4, 4]\n'],
]) test(name, () => execute(source, expected));

for (const [name, source, codes] of [
  ['overflow in an unused constant', 'const BAD:u8=255+1;fn main(){}', ['E0080']],
  ['division by zero in an unused constant', 'const BAD:i32=1/0;fn main(){}', ['E0080']],
  ['out of bounds constant indexing', 'const BAD:i32=[1,2][3];fn main(){}', ['E0080']],
  ['constant reference cycles', 'const A:i32=B;const B:i32=A;fn main(){}', ['E0391']],
  ['non-const function calls', 'fn get()->i32{7}const N:i32=get();fn main(){}', ['E0015']],
  ['non-const calls in an unexecuted branch', 'fn get()->i32{7}const N:i32=if false{get()}else{4};fn main(){}', ['E0015']],
  ['invalid const function even when unused', 'const fn get(){println!("bad");}fn main(){}', ['E0015']],
  ['type mismatch in unused constant branch', 'const N:i32=if true{1}else{false};fn main(){}', ['E0308']],
  ['runtime-local array length', 'fn main(){let n=3;let a=[0;n];}', ['E0425']],
  ['runtime-local inline constant capture', 'fn main(){let n=3;let x=const{n+1};}', ['E0425']],
  ['non-usize repeat expression', 'const N:u8=3;fn main(){let a=[0;N];}', ['E0308']],
  ['negative array length', 'fn main(){let a:[u8;-1]=[];}', ['E0600', 'E0308', 'E_LITERAL']],
  ['non-const for loop lowering', 'const N:i32={let mut n=0;for i in 0..3{n+=i;}n};fn main(){}', ['E0015']],
  ['constant panic', 'const N:i32={panic!("failed");1};fn main(){}', ['E0080']],
]) test(`reject ${name}`, () => assert.throws(() => compile(source), error => codes.includes(error.code), source));

test('constant evaluation has instruction and recursion budgets', () => {
  assert.throws(() => compile('const N:i32=loop{};fn main(){}', {constEvaluation:{maxExpressionSteps:100}}), e => e.code === 'F_CONST_BUDGET');
  assert.throws(() => compile('const fn forever()->i32{forever()}const N:i32=forever();fn main(){}'), e => e.code === 'F_CONST_BUDGET');
});

test('constant function body changes invalidate callers and array type queries', () => {
  const session = new CompilerSession();
  const files = {'Cargo.toml':'[package]\nname="const_query"\nversion="0.1.0"', 'src/main.rs':'const fn size()->usize{2}fn main(){let a=[5;size()];println!("{:?}",a);}'};
  const first = session.compile(files);
  assert.equal(new MirVirtualMachine(first.optimizedMir, {entry:first.entry}).run().output, '[5, 5]\n');
  const second = session.compile({...files,'src/main.rs':files['src/main.rs'].replace('usize{2}', 'usize{3}')});
  assert.equal(new MirVirtualMachine(second.optimizedMir, {entry:second.entry}).run().output, '[5, 5, 5]\n');
});

test('repeated constant arrays remain compact in emitted MIR', () => {
  const result = compile('const A:[u8;10000]=[2;10000];fn main(){println!("{}",A[9999]);}');
  assert(result.mir.flatMap(fn => fn.blocks).flatMap(block => block.instructions).length < 20);
  assert.equal(new MirVirtualMachine(result.optimizedMir,{entry:result.entry}).run().output,'2\n');
});
