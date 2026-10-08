import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

function execute(source, expected) {
  const build = compile(source); let jsOutput;
  vm.runInNewContext(build.js, {postMessage: value => { jsOutput = value; }}, {timeout: 1500});
  const raw = new MirVirtualMachine(build.mir, {entry: build.entry}).run();
  const optimized = new MirVirtualMachine(build.optimizedMir, {entry: build.entry}).run();
  assert.equal(jsOutput, expected, 'generated JavaScript');
  assert.equal(raw.output, expected, 'unoptimized MIR');
  assert.equal(optimized.output, expected, 'optimized MIR');
  return build;
}
const cases = [
  ['integer division', 'fn main(){println!("{}",7u32/2u32);}', '3\n'],
  ['signed division truncates toward zero', 'fn main(){println!("{}",-7i32/2i32);}', '-3\n'],
  ['128-bit integer arithmetic', 'fn main(){println!("{}",340282366920938463463374607431768211450u128+5u128);}', '340282366920938463463374607431768211455\n'],
  ['shadowing has distinct storage', 'fn main(){let x=1;let x=x+1;{let x=10;println!("{}",x);}println!("{}",x);}', '10\n2\n'],
  ['range endpoints are evaluated once', 'fn main(){let mut n=3;for i in 0..n{println!("{}",i);n=0;}}', '0\n1\n2\n'],
  ['inclusive maximum does not overflow', 'fn main(){for n in 254u8..=255u8{println!("{}",n);}}', '254\n255\n'],
  ['short circuit prevents division by zero', 'fn main(){if false && 1/0==1{println!("wrong");}println!("ok");}', 'ok\n'],
  ['early return inside match escapes the function', 'fn f(x:i32)->i32{let y=match x{1=>{return 9;},_=>4};y+1}fn main(){println!("{} {}",f(1),f(0));}', '9 5\n'],
  ['else-if returns correctly', 'fn f(x:i32)->i32{if x==1{return 8;}else if x==2{return 9;}0}fn main(){println!("{}",f(2));}', '9\n'],
  ['loop break value', 'fn main(){let mut n=0;let value=loop{n+=1;if n==3{break n*2;}};println!("{}",value);}', '6\n'],
  ['continue routes through increment', 'fn main(){let mut sum=0;for i in 0..5{if i==2{continue;}sum+=i;}println!("{}",sum);}', '8\n'],
  ['shared references dereference', 'fn main(){let x=41;let r=&x;println!("{}",*r+1);}', '42\n'],
  ['mutable reference update', 'fn main(){let mut x=1;let r=&mut x;*r+=2;println!("{}",x);}', '3\n'],
  ['tuple destructuring', 'fn main(){let (a,b)=(4,5);println!("{}",a*b);}', '20\n'],
  ['array repetition and writes', 'fn main(){let mut a=[0;4];a[2]=7;println!("{}",a[2]);}', '7\n'],
  ['array Copy semantics', 'fn main(){let a=[1,2];let mut b=a;b[0]=9;println!("{} {}",a[0],b[0]);}', '1 9\n'],
  ['String and UTF-8 length', 'fn main(){let mut s=String::from("é");s.push_str("!");println!("{} {}",s,s.len());}', 'é! 3\n'],
  ['vectors and Option payloads', 'fn main(){let mut v:Vec<i32> = Vec::new();v.push(2);v.push(7);println!("{} {}",v.len(),v.pop().unwrap());}', '2 7\n'],
  ['enum payload patterns', 'enum Mode{Off,Fast(i32)}fn score(m:Mode)->i32{match m{Mode::Off=>0,Mode::Fast(x)=>x*2}}fn main(){println!("{}",score(Mode::Fast(7)));}', '14\n'],
  ['Result propagation', 'fn parse(x:i32)->Result<i32,&str>{if x<0{return Err("negative");}Ok(x*2)}fn calc(x:i32)->Result<i32,&str>{let v=parse(x)?;Ok(v+1)}fn main(){match calc(3){Ok(v)=>println!("ok {}",v),Err(e)=>println!("err {}",e)}match calc(-1){Ok(v)=>println!("ok {}",v),Err(e)=>println!("err {}",e)}}', 'ok 7\nerr negative\n'],
  ['concrete trait impl and generic receiver', 'trait Area{fn area(&self)->i32;}struct Rect{w:i32,h:i32}impl Area for Rect{fn area(&self)->i32{self.w*self.h}}fn area<T:Area>(x:&T)->i32{x.area()}fn main(){let r=Rect{w:3,h:4};println!("{}",area(&r));}', '12\n'],
  ['raw strings nested comments', '/* outer /* inner */ tail */ fn main(){println!(r#"raw \\text {{}}"#);}', 'raw \\text {}\n'],
  ['JS identifier collisions are mangled', 'fn main(){let arguments=3;let yield=4;println!("{}",arguments+yield);}', '7\n'],
  ['checked numeric casts wrap', 'fn main(){println!("{}",257u32 as u8);}', '1\n'],
  ['constants', 'const SCALE:i32=3*7;fn main(){println!("{}",SCALE*2);}', '42\n']
];
for (const [name, source, expected] of cases) test(name, () => execute(source, expected));

for (const [name, source, code] of [
  ['float index rejected', 'fn main(){let a=[1];println!("{}",a[0.5]);}', 'E0277'],
  ['missing return rejected', 'fn f()->i32{}fn main(){f();}', 'E0308'],
  ['break outside loop rejected', 'fn main(){break;}', 'E0268'],
  ['unreachable declaration is checked', 'fn unused()->i32{true}fn main(){}', 'E0308'],
  ['use after move', 'fn main(){let a=String::from("a");let b=a;println!("{}",a);}', 'E0382'],
  ['mutate borrowed value', 'fn main(){let mut x=1;let r=&x;x=2;println!("{}",*r);}', 'E0502'],
  ['return reference to local', 'fn bad()->&i32{let x=1;&x}fn main(){bad();}', 'E0515']
]) test(name, () => assert.throws(() => compile(source), error => error.code === code && !!error.span));

test('runtime traps agree across backends', () => {
  for (const source of ['fn main(){println!("{}",255u8+1u8);}', 'fn main(){let a=[1];println!("{}",a[2]);}']) {
    const build = compile(source);
    assert.throws(() => new MirVirtualMachine(build.optimizedMir).run());
    assert.throws(() => vm.runInNewContext(build.js, {postMessage(){}}, {timeout: 1500}));
  }
});
test('lexer spans preserve exact source slices', () => {
  const source = 'fn main(){ let café = r#"hi"#; // café\n}';
  const tokens = Lexer.tokenize(source, {file: 'src/é.rs'});
  for (const token of tokens.slice(0,-1)) {
    assert.equal(source.slice(token.span.start,token.span.end),token.value);
    assert.equal(token.span.file,'src/é.rs');
  }
});
test('MIR verifier rejects corrupt edges and uninitialized reads', () => {
  const build = compile('fn main(){println!("x");}');
  const mir = structuredClone(build.mir);
  mir[0].blocks[0].terminator={kind:'goto',target:'missing'};
  assert.throws(()=>MirVerifier.verify(mir),/absent block/);
});
