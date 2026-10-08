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

for (const [name, source, expected] of [
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
]) test(name, () => runAll(source, expected));

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
