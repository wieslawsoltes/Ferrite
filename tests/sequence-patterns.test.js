import {sequenceCases} from './fixtures/language-conformance.js';
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

for (const [name, source, expected] of sequenceCases) test(name, () => execute(source, expected));

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
