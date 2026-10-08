import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {compile} from '../src/engine.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';

function run(source, expected) {
  for (const optimize of [false, true]) {
    const result = compile(source, {optimize});
    const interpreted = new MirVirtualMachine(result.optimizedMir, {entry: result.entry}).run();
    let emitted;
    vm.runInNewContext(result.js, {postMessage: output => { emitted = output; }}, {timeout: 1000});
    assert.equal(interpreted.output, expected, 'MIR output');
    assert.equal(emitted, expected, 'generated JS output');
    assert.equal(result.verification.status, 'verified');
  }
}

test('if let binds tuple enum payloads and scopes the binding to the success branch', () => {
  run('fn main(){ let value: Option<i32> = Some(21); let doubled = if let Some(n) = value { n * 2 } else { 0 }; println!("{}", doubled); }', '42\n');
  assert.throws(() => compile('fn main(){let value: Option<i32>=Some(1); if let Some(n)=value {println!("{}",n);} println!("{}",n);}'), /Unresolved identifier/);
});

test('if let selects else-if-let and does not evaluate the wrong arm', () => {
  run('fn main(){let value: Option<i32> = None; if let Some(n) = value {panic!("wrong arm");} else if let Some(n) = Some(7) {println!("{}",n);} else {panic!("unreachable");}}', '7\n');
});

test('while let repeatedly evaluates a mutable Vec receiver and respects continue/break', () => {
  run('fn main(){let mut values=vec![1,2,3,4]; while let Some(n) = values.pop() {if n == 3 {continue;} if n == 1 {break;} println!("{}",n);} println!("left: {}",values.len());}', '4\n2\nleft: 0\n');
});

test('while let handles initial pattern failure', () => {
  run('fn main(){let mut values: Vec<i32> = Vec::new(); while let Some(n) = values.pop() {panic!("empty");} println!("done");}', 'done\n');
});

test('bitwise float and mutation through shared references are rejected before execution', () => {
  assert.throws(() => compile('fn main(){let x = 1.0f64 & 2.0f64;}'), /Bitwise operators require integer/);
  assert.throws(() => compile('fn bad(mut values: &Vec<i32>){values.push(3);} fn main(){}'), /shared reference/);
  assert.throws(() => compile('fn bad(mut s: &String){s.push_str("x");} fn main(){}'), /shared reference/);
});
