import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {CompilerSession} from '../src/project/CompilerSession.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {TypeSystem as T} from '../src/compiler/TypeSystem.js';

function run(source, expected) {
  for (const optimize of [false, true]) {
    const built = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(built.optimizedMir, {entry: built.entry}).run().output, expected);
    let output; vm.runInNewContext(built.js, {postMessage: value => { output = value; }}, {timeout: 1000});
    assert.equal(output, expected);
    assert.equal(new WebAssemblyRuntime(built.wasm).run().output, expected);
  }
}
for (const [name, source, expected] of [
  ['transparent tuple alias with argument inference', 'type Pair<T>=(T,T);fn sum<T>(p:Pair<T>)->T where T:Copy {p.0}fn main(){let p:Pair<u32>=(7,8);println!("{}",sum(p));}', '7\n'],
  ['arrays structurally infer generic element', 'fn first<T:Copy>(v:[T;2])->T{v[0usize]}fn main(){println!("{} {}",first([3u32,4u32]),first([true,false]));}', '3 true\n'],
  ['nested alias definition namespace and imported alias', 'mod types {pub struct Point{pub x:i32}pub type P=Point;pub type Boxed<T>=Option<T>;}use types::P;fn main(){let P{x}=P{x:4};let v:types::Boxed<i32>=Some(x);println!("{}",v.unwrap());}', '4\n'],
  ['generic record alias constructor', 'struct Record<T>{value:T}type R<T>=Record<T>;fn main(){let n=R::<u32>{value:42};println!("{}",n.value);}', '42\n'],
  ['alias enum variant and pattern', 'type Outcome=Result<u32,i32>;fn main(){let n=Outcome::Ok(9);println!("{}",match n{Outcome::Ok(v)=>v,Outcome::Err(_)=>0});}', '9\n'],
  ['where predicates include concrete composites', 'fn show<T>(x:T)where T:Display+Copy,Option<T>:Copy {println!("{}",x);}fn main(){show(12u32);}', '12\n'],
  ['where callable bound preserves closure behavior', 'fn apply<F>(f:F)->i32 where F:Fn(i32)->i32 {f(4)}fn main(){println!("{}",apply(|n|n+1));}', '5\n'],
  ['type grouping differs from a one-element tuple', 'type Number=(u32);type Single=(u32,);fn main(){let n:Number=4;let t:Single=(n,);println!("{}",t.0);}', '4\n'],
  ['alias type parameter shadows an existing nominal type', 'struct T{x:i32}type Pair<T>=(T,T);fn first<T>(x:Pair<T>)->T where T:Copy{x.0}fn main(){println!("{}",first((3u32,4u32)));}', '3\n'],
]) test(name, () => run(source, expected));

for (const [name, source, code] of [
  ['direct alias cycle', 'type A=A;fn main(){}', 'E0391'],
  ['mutually recursive aliases', 'type A=Option<B>;type B=&A;fn main(){}', 'E0391'],
  ['generic alias cycle', 'type A<T>=Option<A<T>>;fn main(){}', 'E0391'],
  ['missing alias arguments', 'type A<T>=(T,T);fn f(x:A){}fn main(){}', 'E0107'],
  ['excess alias arguments', 'type A=i32;fn f(x:A<i32>){}fn main(){}', 'E0107'],
  ['unknown alias target', 'type A=Missing;fn main(){}', 'E0412'],
  ['duplicate type namespace', 'struct P{x:i32}type P=i32;fn main(){}', 'E0428'],
  ['failed where predicate', 'fn f<T>(x:T)where T:Missing {}fn main(){f(1);}', 'E0277'],
  ['different tuple elements for one type variable', 'fn f<T:Copy>(x:(T,T)){}fn main(){f((1u32,true));}', 'E0308'],
  ['wrong fixed array length', 'fn f<T>(x:[T;2]){}fn main(){f([1u32,2u32,3u32]);}', 'E0308'],
]) test(`reject ${name}`, () => assert.throws(() => compile(source), error => error.code === code));

test('alias and predicate edits invalidate semantic queries while untouched bodies remain exact', () => {
  const session = new CompilerSession();
  const files = {'Cargo.toml':'[package]\nname="aliases"\nversion="0.1.0"','src/main.rs':'type Number=u32;fn number()->Number{7}fn main(){println!("{}",number());}'};
  const first = session.compile(files);
  const changed = session.compile({...files,'src/main.rs':files['src/main.rs'].replace('Number=u32','Number=i32')});
  assert.equal(first.sem.instances.find(i=>i.name==='number').returnType, 'u32');
  assert.equal(changed.sem.instances.find(i=>i.name==='number').returnType, 'i32');
  assert(changed.sem.typeResolution.entries > 0);
  assert(first.sem.typeResolution.aliases.some(a=>a.alias==='Number'&&a.expanded==='u32'));
});

test('qualified identifiers are not rewritten by bare generic substitution', () => {
  assert.equal(T.substitute('(T,types::T,Vec<T>)',new Map([['T','u32']])), '(u32,types::T,Vec<u32>)');
  const mappings = new Map([['T',null]]); T.unify('[Option<T>;2]', '[Option<u32>;2]', mappings);
  assert.equal(mappings.get('T'), 'u32');
});


test('type expansion uses bounded storage and rejects malformed/deep declarations', () => {
  assert.throws(() => compile('type Bad=Option<i32,i32>;fn main(){}'), error => error.code === 'E0107');
  assert.throws(() => compile('type Deep=' + '& '.repeat(140) + 'u32;fn main(){}'), error => error.code === 'F_TYPE_DEPTH');
  let target = 'u32'; for (let i=0;i<20;i++) target = 'Pair<' + target + '>';
  assert.throws(() => compile('type Pair<T>=(T,T);type Huge=' + target + ';fn main(){}'), error => error.code === 'F_TYPE_SIZE');
});
