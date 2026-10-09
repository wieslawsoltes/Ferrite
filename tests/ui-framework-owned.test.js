import test from 'node:test';
import assert from 'node:assert/strict';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UISession} from '../src/ui-framework/UISession.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {OwnedValues} from '../src/ui-framework/OwnedValues.js';
import {SourceDesigner} from '../src/ui-framework/SourceDesigner.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

const model = `#[derive(Clone)] struct Model { label: String, count: i64, flags: Vec<bool> }
fn app() -> ui::Node {
  let state = ui::state(Model { label: String::from("hello"), count: 0, flags: vec![true, false] });
  let value = ui::read(state);
  view! { <button on:click={move || ui::modify(state, |m: Model| Model { label: m.label.clone(), count: m.count + 1, flags: m.flags.clone() })}>{value.count}</button> }
}`;
function mount(artifact, backend) {
  const runtime = createUIRuntime(), container = createDocument().createElement('main'), errors = [];
  const session = new UISession(artifact, {runtime, backend, onError: e => errors.push(e)}).mount(container);
  return {session, container, errors};
}
for (const backend of ['mir', 'javascript', 'wasm']) {
  test(`${backend}: generic owned struct state uses isolated clones and lossless edits`, () => {
    const {session, container, errors} = mount(UICompiler.compile(model), backend);
    for (let i = 0; i < 3; i++) elements(container, 'button')[0].dispatchEvent(new Event('click'));
    const state = session.inspect().states[0];
    assert.deepEqual(state.value, {label: 'hello', count: '3', flags: [true, false]});
    state.value.flags[0] = false; assert.equal(session.inspect().states[0].value.flags[0], true);
    session.setState(state.handle, {label: 'edited', count: '9007199254740993', flags: []});
    assert.equal(container.textContent, '9007199254740993');
    assert.throws(() => session.setState(state.handle, {label: 'bad', count: 3, flags: []}), /BigInt/);
    assert.throws(() => session.setState(state.handle, {label: 'bad', count: '9223372036854775808', flags: []}), /bounds/);
    assert.throws(() => session.setState(state.handle, {label: 'bad', count: '1'}), /fields/);
    assert.equal(errors.length, 0); session.dispose(); assert.equal(session.handles.size, 0);
  });
  test(`${backend}: structured keyboard/pointer events carry typed snapshots and cancel synchronously`, () => {
    const source = `fn app() -> ui::Node { let s = ui::use_string("");
      view! { <section><input on_event:keydown={move |e: ui::Event| { if e.ctrl_key { ui::prevent_default(); ui::stop_propagation(); } ui::set_string(s, e.key); }} /><output>{ui::get_string(s)}</output></section> } }`;
    const {session, container, errors} = mount(UICompiler.compile(source), backend);
    const event = new Event('keydown', {cancelable: true});
    Object.defineProperties(event, {key: {value: 'Enter'}, ctrlKey: {value: true}});
    elements(container, 'input')[0].dispatchEvent(event);
    assert.equal(event.defaultPrevented, true); assert.equal(elements(container, 'output')[0].textContent, 'Enter');
    assert.equal(errors.length, 0); session.dispose();
  });
  test(`${backend}: generic memo/effect dependencies are structural, not object identity`, () => {
    const source = `fn app() -> ui::Node {
      let s = ui::state(0i64); let n = ui::read(s);
      let label = ui::memo_with(|| String::from("memo"), (n, true));
      ui::effect_with(move || println!("setup"), move || println!("cleanup"), (n, false));
      view! { <button on:click={move || ui::modify(s, |v: i64| v + 1)}>{label}{n}</button> }
    }`;
    const {session, container, errors} = mount(UICompiler.compile(source), backend);
    session.root.flushEffects(); assert.equal(container.textContent, 'memo0');
    elements(container, 'button')[0].dispatchEvent(new Event('click')); session.root.flushEffects();
    assert.equal(container.textContent, 'memo1'); assert.equal(errors.length, 0); session.dispose();
  });
  test(`${backend}: external modules retain distinct node IDs and original diagnostics`, () => {
    const files = {'src/app.rs': 'mod card; fn app() -> ui::Node { view! { <card::Card /> } }',
      'src/card.rs': 'pub fn Card() -> ui::Node { let s = ui::state(7i64); view! { <button on:click={move || ui::modify(s, |v: i64| v + 1)}>{ui::read(s)}</button> } }'};
    const artifact = UICompiler.compile(files['src/app.rs'], {file: 'src/app.rs', files});
    assert.equal(artifact.modules[0].to, 'src/card.rs'); assert.equal(new Set(artifact.nodes.map(n => n.id)).size, artifact.nodes.length);
    const {session, container} = mount(artifact, backend); elements(container, 'button')[0].dispatchEvent(new Event('click')); assert.equal(container.textContent, '8'); session.dispose();
    const designer = new SourceDesigner(files['src/card.rs'], {file: 'src/card.rs', entryFile: 'src/app.rs', files});
    const button = designer.nodes.find(n => n.tag === 'button');
    assert.ok(designer.apply({op: 'setAttribute', node: button.id, name: 'className', value: 'changed'}, 0).source.includes('changed'));
    assert.throws(() => UICompiler.compile(files['src/app.rs'], {file: 'src/app.rs', files: {...files, 'src/card.rs': 'pub fn Card() -> ui::Node { view! { <p>{unknown}</p> } }'}}), e => e.span.file === 'src/card.rs');
  });
}

test('borrowed references, closure values and render-local handles cannot become generic state', () => {
  for (const value of ['&n', 'ui::text("bad")', 'ui::use_ref()']) {
    assert.throws(() => UICompiler.compile(`fn app() -> ui::Node { let n = 1i64; let s = ui::state(${value}); ui::text("no") }`), e => e.code === 'F_UI_STATE_TYPE' || e.code === 'E0277');
  }
  assert.throws(() => UICompiler.compile('enum E { Node(ui::Node) } fn app() -> ui::Node { let n = E::Node(ui::text("bad")); ui::component(move || { match &n { _ => {} } ui::text("bad") }) }'), e => e.code === 'F_UI_LIFETIME' || e.code === 'F_PATTERN');
});

test('schema transfers reject cycles, getters, malformed enums and enforce budgets', () => {
  const schemas = {i128: {kind: 'integer', bits: 128, signed: true}, bool: {kind: 'bool'}, V: {kind: 'sequence', item: 'bool'}, E: {kind: 'enum', variants: [{tag: 'E::A', fields: ['i128']}]}};
  const values = new OwnedValues(schemas);
  assert.deepEqual(values.decode('E', {tag: 'E::A', values: ['170141183460469231731687303715884105727']}), {tag: 'E::A', values: [(1n << 127n) - 1n]});
  assert.throws(() => values.decode('E', {tag: 'E::B', values: []}), /variant/);
  assert.throws(() => values.decode('E', {get tag() { throw Error('must not execute'); }, values: []}), /accessors/);
  assert.throws(() => new OwnedValues(schemas, {maxNodes: 1}).clone('V', [true]), /budget/);
  const array = [true]; Object.defineProperty(array, 0, {get() { throw Error('must not execute'); }});
  assert.throws(() => values.clone('V', array), /accessors/);
});
