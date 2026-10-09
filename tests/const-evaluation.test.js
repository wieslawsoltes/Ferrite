import {constantCases} from './fixtures/language-conformance.js';
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

for (const [name, source, expected] of constantCases) test(name, () => execute(source, expected));

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
