import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRust, runRust} from '../src/sdk/Ferrite.js';

test('Fn output constraints infer the concrete generic return type', () => {
  const source = 'fn make<T: Clone, F: Fn() -> T>(factory: F) -> T { factory() } fn main() -> i64 { make(|| 42i64) }';
  for (const backend of ['mir', 'javascript', 'wasm']) assert.equal(runRust(source, {backend}).value, 42n);
  assert.throws(() => compileRust('fn make<T: Clone, F: Fn() -> T>(f: F) -> T { f() } fn main() { let n: bool = make(|| 1i64); }'), e => e.code === 'E0308');
});
test('built-in PhantomData participates in nominal type identity and has zero fields', () => {
  const source = 'fn marker<T>(value: T) -> std::marker::PhantomData<T> { std::marker::PhantomData } fn main() { let m = marker(String::from("owned")); let a = m; let b = m; }';
  for (const backend of ['mir', 'javascript', 'wasm']) assert.equal(runRust(source, {backend}).value, null);
  assert.throws(() => compileRust('struct Unused<T> { value: u32 } fn main() {}'), e => e.code === 'E0392');
});
