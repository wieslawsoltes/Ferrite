import {callableCases,callableCompileFailCases,callablePanicCases} from './callable-items.js';
import {enumRecordCases, enumRecordCompileFailCases, enumRecordPanicCases} from './enum-records.js';
import {nominalCases, nominalCompileFailCases, nominalPanicCases} from './nominal-constructors.js';
import {destructuringCases, destructuringCompileFailCases, destructuringPanicCases} from './destructuring-conformance.js';
import {floatCases, floatPanicCases, floatCompileFailCases} from './float-conformance.js';
// Shared deterministic programs: Node backends and installed-rustc conformance.


export const controlCases = [
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

export const constantCases = [
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
];

export const primitiveCases = [
  ['different shift operand types and precedence', 'fn main(){let x=3u64 << 2u8 + 1u8;println!("{} {}",x,128u8 >> 6i16);}', '24 2\n'],
  ['checked shifts truncate bits without arithmetic overflow', 'fn main(){println!("{} {} {}",128u8 << 1,64i8 << 1,-64i8 >> 3);}', '0 -128 -8\n'],
  ['all integer bitwise assignments', 'fn main(){let mut x=12u32;x^=10;x&=7;x|=16;x<<=2u8;x>>=1i16;println!("{}",x);}', '44\n'],
  ['eager boolean operations', 'fn yes()->bool{print!("y");true}fn main(){let mut x=false & yes();x|=true;x^=false;println!("{} {}",x,true ^ true);}', 'ytrue false\n'],
  ['primitive bool char and numeric casts', "fn main(){println!(\"{} {} {} {}\",true as u128,'🦀' as u32,65u8 as char,b'\\xff');}", '1 129408 A 255\n'],
  ['negative base literals at signed minimum', 'fn main(){println!("{} {}",-0x80i8,-0b1000_0000i8);}', '-128 -128\n'],
  ['raw names and nested generic closing punctuation', 'fn main(){let r#type:Option<Option<i32>>=Some(Some(9));println!("{}",r#type.unwrap().unwrap());}', '9\n'],
  ['Unicode identifier normalization', 'fn main(){let café=7;println!("{}",cafe\u0301);}', '7\n'],
  ['raw strings including zero hashes', 'fn main(){println!(r"{}",r#"a\"b"#);}', 'a"b\n'],
  ['decimal floating suffix and exponent', 'fn main(){println!("{} {} {}",1f64,1.,12.5e1f32);}', '1 1 125\n'],
];

export const sequenceCases = [
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
];

export const compileFailCases = [
  ['unknown label', "fn main(){loop{break 'missing;}}"],
  ['label across closure', "fn main(){'out:loop{let f=||{break 'out;};f();}}"],
  ['continue block', "fn main(){'b:{continue 'b;}}"],
  ['unlabeled break in labeled block', "fn main(){loop{'b:{break;}}}"],
  ['while break value', 'fn main(){while true{break ();}}'],
  ['for break value', 'fn main(){for i in 0..3{break i;}}'],
  ['loop body value', 'fn main(){loop{1}}'],
  ['immutable assignment expression', 'fn main(){let x=3;let y=(x=4);}'],
  ['non-Copy at overlap', 'fn main(){let whole @ (part,_)=(String::from("x"),2);}'],
  ['incomplete fixed-array match', 'fn main(){let n=match [true,false]{[true,true]=>1};}'],
  ['different or-pattern bindings', 'fn main(){match [1,2]{[a,rest @ ..]|[_,rest @ ..]=>a};}'],
  ['duplicate bindings', 'fn main(){let n @ (n,_)=(1,2);}'],
  ['non-array pattern', 'fn main(){let [a,b]=(1,2);}'],
  ['wrong pattern length', 'fn main(){let [a,b]=[1,2,3];}'],
  ['const overflow', 'const BAD:u8=255+1;fn main(){}'],
  ['const division by zero', 'const BAD:i32=1/0;fn main(){}'],
  ['const dependency cycle', 'const A:i32=B;const B:i32=A;fn main(){}'],
  ['non-const callee', 'fn get()->i32{7}const N:i32=get();fn main(){}'],
  ['non-const dead callee', 'fn get()->i32{7}const N:i32=if false{get()}else{4};fn main(){}'],
  ['inline const cannot capture local', 'fn main(){let n=3;let x=const{n+1};}'],
  ['array length local', 'fn main(){let n=3;let a=[0;n];}'],
  ['const repeat requires usize', 'const N:u8=3;fn main(){let a=[0;N];}'],
  ['return local reference through block', "fn leak(r:&i32)->&i32{'b:{let x=1;break 'b &x;}}fn main(){}"],
  ['return local reference through match', 'fn leak(r:&i32)->&i32{let x=1;match true{true=>return &x,false=>r}}fn main(){}'],
  ['repeated loop move', 'fn take(s:String){}fn main(){let s=String::from("x");loop{take(s);}}'],
  ['invalid bool arithmetic', 'fn main(){let mut a=true;a+=false;}'],
  ['invalid unsigned negation', 'fn main(){let a=0u32;let b=-a;}'],
  ['invalid char cast', 'fn main(){let a=3u32 as char;}'],
];
export const runtimePanicCases = [
  ['left shift overflow', 'fn main(){println!("{}",1u8 << 8);}', 'R_OVERFLOW'],
  ['negative shift count', 'fn main(){println!("{}",1i128 >> -1);}', 'R_OVERFLOW'],
  ['signed minimum division', 'fn main(){println!("{}",-128i8 / -1);}', 'R_OVERFLOW'],
  ['signed minimum remainder', 'fn main(){println!("{}",-128i8 % -1);}', 'R_OVERFLOW'],
  ['integer division by zero', 'fn main(){let x=0;println!("{}",1/x);}', 'R_DIV_ZERO'],
  ['array bounds', 'fn main(){let a=[1,2];let n=3;println!("{}",a[n]);}', 'R_BOUNDS'],
  ['explicit panic', 'fn main(){panic!("expected");}', 'R_PANIC'],
];
export const languageCases = [
  ...primitiveCases, ...sequenceCases, ...constantCases, ...controlCases, ...floatCases, ...destructuringCases, ...nominalCases, ...enumRecordCases, ...callableCases,
].map(([name,source,output])=>({name,source,output,kind:'run'})).concat(
  [...compileFailCases, ...floatCompileFailCases, ...destructuringCompileFailCases, ...nominalCompileFailCases, ...enumRecordCompileFailCases, ...callableCompileFailCases].map(([name,source])=>({name,source,kind:'compile-fail'})),
  [...runtimePanicCases, ...floatPanicCases, ...destructuringPanicCases, ...nominalPanicCases, ...enumRecordPanicCases, ...callablePanicCases].map(([name,source,code,output])=>({name,source,code,output,kind:'panic'})),
);
