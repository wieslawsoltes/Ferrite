import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compile, tokenize, parse} from '../src/engine.js';
import {MirVerifier} from '../src/compiler/MirVerifier.js';
import {Runtime} from '../src/runtime/Runtime.js';

test('MIR rejects unknown instructions, unknown terminators and duplicate functions', () => {
  const original = compile('fn main(){println!("hello");}').mir;
  const mutate = action => {const functions = structuredClone(original); action(functions); return functions;};
  assert.throws(() => MirVerifier.verify(mutate(f => {f[0].blocks[0].instructions[0].op = 'invented';})), /Unknown operation/);
  assert.throws(() => MirVerifier.verify(mutate(f => {f[0].blocks[0].terminator.kind = 'invented';})), /Unknown terminator/);
  assert.throws(() => MirVerifier.verify([...original, ...original]), /Duplicate MIR function/);
});

test('MIR validates call arity and destination/return types', () => {
  const original = compile('fn twice(x:i32)->i32{x*2} fn main(){println!("{}",twice(3));}').mir;
  let functions = structuredClone(original);
  functions.flatMap(f=>f.blocks).flatMap(b=>b.instructions).find(i=>i.op==='call').args = [];
  assert.throws(() => MirVerifier.verify(functions), /Argument count mismatch/);
  functions = structuredClone(original);
  functions[0].blocks[0].instructions.find(i=>i.dest!==null).type = 'invented';
  assert.throws(() => MirVerifier.verify(functions), /Destination type/);
});

test('contextual generic closer splitting preserves the public token stream', () => {
  const tokens = tokenize('fn main(){let value: Option<i32>=Some(1); println!("{:?}", value);}');
  const copy = JSON.stringify(tokens);
  parse(tokens); assert.equal(JSON.stringify(tokens), copy);
  assert(tokens.some(t=>t.value==='>='));
  assert.equal(compile('fn main(){let value: Option<i32>=Some(1); assert!(2>=1);}').verification.status, 'verified');
});

test('checked integer bounds are reused without changing overflow semantics', () => {
  const runtime = new Runtime();
  assert.equal(runtime.bounds('i32'), runtime.bounds('i32'));
  assert(Object.isFrozen(runtime.bounds('i32')));
  assert.equal(runtime.binary('/', 7n, 2n, 'i32'), 3n);
  assert.throws(() => runtime.binary('+', 127n, 1n, 'i8'), /overflow/);
});
