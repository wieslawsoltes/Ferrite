import {controlCases} from './fixtures/language-conformance.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';



for (const [name, source, output] of controlCases) test(name, () => {
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
