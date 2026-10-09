import {primitiveCases} from './fixtures/language-conformance.js';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile, tokenize} from '../src/engine.js';
import {Lexer} from '../src/compiler/Lexer.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../src/runtime/WebAssemblyRuntime.js';
import {Runtime} from '../src/runtime/Runtime.js';

export function runAll(source, expected) {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    assert.equal(new MirVirtualMachine(result.optimizedMir, {entry: result.entry}).run().output, expected);
    assert.equal(new WebAssemblyRuntime(result.wasm).run().output, expected);
    let output;
    vm.runInNewContext(result.js, {postMessage: value => { output = value; }}, {timeout: 2000});
    assert.equal(output, expected);
  }
}

for (const [name, source, expected] of primitiveCases) test(name, () => runAll(source, expected));

for (const source of [
  'fn main(){let a=1f32 << 2;}', 'fn main(){let a=1u8 << 1f32;}',
  'fn main(){let a=1.0 & 2.0;}', 'fn main(){let mut a=true;a+=false;}',
  'fn main(){let a=0u32;let b=-a;}', 'fn main(){let a=3u32 as char;}',
  'fn main(){let a=true as f32;}', 'fn main(){let a=65 as bool;}',
]) test(`reject invalid primitive operation: ${source}`, () => assert.throws(() => compile(source), error => /^E\d+$/.test(error.code)));

for (const literal of ['"\\u{d800}"', '"\\u{110000}"', '"\\xFF"', '"\\u{_41}"', '"\\q"', "'ab'", "b'é'", "b'\\u{41}'", '"a\rZ"', '0b012', '1.0u99', '0x____', '1e_'])
  test(`reject malformed literal ${JSON.stringify(literal)}`, () => assert.throws(() => tokenize(literal), error => error.code?.startsWith('E')));

test('escapes, continuations and byte strings decode without losing source spans', () => {
  assert.equal(Lexer.decode('"a\\\n  \t b"'), 'ab');
  assert.equal(Lexer.decode('"\\u{1_f980}"'), '🦀');
  assert.equal(Lexer.decode('br#"abc"#'), 'abc');
  assert.equal(Lexer.decode('b"\\xff\\0"'), '\xff\0');
  const tokens = tokenize('r#type >>= 1', {file:'ops.rs'});
  assert.equal(tokens[0].value, 'type'); assert.equal(tokens[0].span.end, 6);
  assert.equal(tokens[1].value, '>>='); assert.equal(tokens[1].span.start, 7);
});

test('bounds failures are preserved by constant folding and all execution backends', () => {
  for (const expression of ['1u8 << 8', '1i128 >> -1', '-128i8 / -1', '-128i8 % -1']) {
    for (const optimize of [false, true]) {
      const result = compile(`fn main(){println!("{}",${expression});}`, {optimize});
      assert.throws(() => new MirVirtualMachine(result.optimizedMir, {entry:result.entry}).run(), error => error.code === 'R_OVERFLOW');
      assert.throws(() => new WebAssemblyRuntime(result.wasm).run(), error => error.code === 'R_OVERFLOW');
      assert.throws(() => vm.runInNewContext(result.js, {postMessage(){}}, {timeout:2000}), error => error.code === 'R_OVERFLOW');
    }
  }
});

test('unchecked arithmetic still traps MIN / -1 and MIN % -1, while shift counts mask', () => {
  const runtime = new Runtime({overflow:'wrapping'});
  assert.equal(runtime.binary('<<', 1n, 9n, 'u8'), 2n);
  assert.equal(runtime.binary('>>', 128n, -1n, 'u8'), 1n);
  for (const operator of ['/', '%']) assert.throws(() => runtime.binary(operator, -128n, -1n, 'i8'), e => e.code === 'R_OVERFLOW');
});

test('raw identifiers reject reserved self paths and underscore', () => {
  for (const name of ['self', 'Self', 'crate', 'super', '_']) assert.throws(() => tokenize(`r#${name}`));
});
