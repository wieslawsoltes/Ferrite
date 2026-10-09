import test from 'node:test';
import assert from 'node:assert/strict';
import {compileRust, runRust, compileUI, UISession, createUIRuntime} from '../src/sdk/Ferrite.js';
import {uiGenericCases, uiGenericCompileFailCases} from './fixtures/ui-generic-integration.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

for (const [name, source, output] of uiGenericCases) test(name, () => {
  for (const optimize of [false, true]) for (const backend of ['mir', 'javascript', 'wasm'])
    assert.equal(runRust(source, {optimize, backend}).output, output);
});
for (const [name, source, code] of uiGenericCompileFailCases) test(name, () => {
  for (const optimize of [false, true]) assert.throws(() => compileRust(source, {optimize}), error => error.code === code);
});

for (const backend of ['mir', 'javascript', 'wasm']) test(`${backend}: inherent generic mapping and output-inferred memo retain owned UI state`, () => {
  const source = `#[derive(Clone)] struct Model<T> { value: T }
impl<T: Copy> Model<T> {
  fn new(value: T) -> Self { Self { value } }
  fn map<R: Clone, F: Fn(T) -> R>(self, f: F) -> Model<R> { Model { value: f(self.value) } }
}
fn app() -> ui::Node {
  let state = ui::state(Model::new(40i64)); let model = ui::read(state);
  let label = ui::memo_with(|| String::from("value"), (model.value, true));
  view! { <button on:click={move || ui::modify(state, |m: Model<i64>| m.map(|v: i64| v + 2))}>{label}{model.value}</button> }
}`;
  const container = createDocument().createElement('main'), errors = [];
  const session = new UISession(compileUI(source), {backend, runtime: createUIRuntime(), onError: e => errors.push(e)}).mount(container);
  try {
    assert.equal(container.textContent, 'value40');
    elements(container, 'button')[0].dispatchEvent(new Event('click'));
    assert.equal(container.textContent, 'value42');
    assert.deepEqual(session.inspect().states[0].value, {value: '42'});
    assert.deepEqual(errors, []);
  } finally { session.dispose(); }
  assert.equal(container.textContent, '');
});
