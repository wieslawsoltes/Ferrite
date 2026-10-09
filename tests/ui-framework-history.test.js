import test from 'node:test';
import assert from 'node:assert/strict';
import {ExecutionSnapshot} from '../src/runtime/ExecutionSnapshot.js';
import {MirVirtualMachine} from '../src/runtime/MirVirtualMachine.js';
import {compileRust, compileUI, UISession, createUIRuntime} from '../src/sdk/Ferrite.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

test('identity snapshots restore cycles, aliases, deleted fields and sparse array lengths', () => {
  const cell = {value: [1n, , 3n]}, reference = {__ref: true, cell, path: []};
  const root = {cell, aliases: [reference, reference]}; root.self = root;
  const point = new ExecutionSnapshot(root);
  cell.value[0] = 99n; cell.value.length = 1; root.cell = {value: null}; root.extra = true;
  reference.cell = {value: 'wrong'};
  point.restore();
  assert.equal(root.cell, cell); assert.equal(root.self, root); assert.equal(root.aliases[0], root.aliases[1]);
  assert.equal(reference.cell, cell); assert.deepEqual(cell.value, [1n, , 3n]); assert.equal('extra' in root, false);
  assert.throws(() => new ExecutionSnapshot({x: 'x'.repeat(2000)}, {maxBytes: 1024}), /budget/);
  assert.throws(() => new ExecutionSnapshot({get x() { throw Error('must not execute'); }}), /accessors/);
});

test('MIR reverse execution restores calls, mutable references, return frames and output', () => {
  const source = 'fn bump(x: &mut i64) { *x = *x + 1; } fn main() -> i64 { let mut n = 40_i64; bump(&mut n); println!("{}", n); n + 1 }';
  const artifact = compileRust(source), vm = new MirVirtualMachine(artifact.optimizedMir, {entry: artifact.entry, history: true});
  const states = [vm.snapshot()]; while (!vm.done) { vm.step(); states.push(vm.snapshot()); }
  assert.equal(vm.result, 42n); assert.equal(vm.runtime.output, '41\n');
  const plain = ({history, ...state}) => state;
  for (let i = states.length - 2; i >= 0; i--) assert.deepEqual(plain(vm.stepBack()), plain(states[i]));
  assert.equal(vm.runtime.output, ''); assert.equal(vm.runtime.steps, 0);
  assert.throws(() => vm.stepBack(), e => e.code === 'R_HISTORY_BOUNDARY');
  vm.run(); assert.equal(vm.result, 42n); assert.equal(vm.runtime.output, '41\n');
});

test('MIR bounded history evicts old snapshots and records explicit irreversible boundaries', () => {
  const artifact = compileRust('fn main() -> i64 { let mut n = 0_i64; while n < 10 { n += 1; } n }');
  const vm = new MirVirtualMachine(artifact.optimizedMir, {entry: artifact.entry, maxTrace: 0, history: {maxSnapshots: 3, maxBytes: 32768}});
  vm.run(); assert.equal(vm.historyInfo().available, 3); assert.ok(vm.historyInfo().dropped > 0);
  vm.historyBarrier('test host effect'); assert.throws(() => vm.stepBack(), /test host effect/);
});

test('MIR panic is reversible to the exact pre-instruction state', () => {
  const artifact = compileRust('fn main() { println!("before"); panic!("test panic"); }');
  const vm = new MirVirtualMachine(artifact.optimizedMir, {entry: artifact.entry, history: true});
  assert.throws(() => vm.run(), /test panic/); const steps = vm.runtime.steps;
  vm.stepBack(); assert.equal(vm.runtime.steps, steps - 1); assert.equal(vm.runtime.output, 'before\n');
  assert.throws(() => vm.step(), /test panic/);
});

for (const backend of ['mir', 'wasm', 'javascript']) {
  test(`${backend}: reverse UI instructions and owned staged state without committing the DOM`, () => {
    const source = `#[derive(Clone)] struct Model { total: i64, values: Vec<i64> }
fn app() -> ui::Node {
  let state = ui::state(Model { total: 1, values: vec![2_i64] });
  view! { <button on:click={move || { let mut m = ui::read(state); m.total += 1; m.values.push(3); ui::write(state, m); }}>{ui::read(state).total}</button> }
}`;
    const runtime = createUIRuntime(), container = createDocument().createElement('main');
    const session = new UISession(compileUI(source), {backend, runtime}).mount(container);
    session.armDebugger(); elements(container, 'button')[0].dispatchEvent(new Event('click'));
    const initial = session.inspectDebugger(); let limit = 500;
    while (!session.debugger.vm.done && --limit) session.debug('step');
    assert.ok(limit); assert.equal(elements(container, 'button')[0].textContent, '1');
    assert.equal(session.inspectDebugger().stagedStates[0].value.total, '2');
    session.debug('restart'); assert.equal(session.inspectDebugger().state.steps, initial.state.steps);
    assert.equal(session.inspectDebugger().stagedStates[0].value.total, '1');
    assert.throws(() => session.setState(session.inspect().states[0].handle, {}), /paused event/);
    session.debug('continue'); assert.equal(elements(container, 'button')[0].textContent, '2');
    assert.equal(session.debugger.vm, null); session.dispose();
  });
}

test('external event emission establishes a reverse boundary and is never undone or replayed implicitly', () => {
  const runtime = createUIRuntime(), container = createDocument().createElement('main'), events = [];
  const artifact = compileUI('fn app() -> ui::Node { let n = ui::use_state(0); view! { <button on:click={move || { ui::set(n, 1); ui::emit("saved", ui::get(n)); ui::set(n, 2); }}>Run</button> } }');
  const session = new UISession(artifact, {runtime, onEvent: (...args) => events.push(args)}).mount(container);
  session.armDebugger(); elements(container, 'button')[0].dispatchEvent(new Event('click'));
  let limit = 200; while (!events.length && --limit) session.debug('step');
  assert.ok(limit); assert.deepEqual(events, [['saved', '1']]);
  assert.equal(session.inspect().states[0].value, '1');
  assert.throws(() => session.debug('back'), /Host operation ui::emit/);
  session.debug('continue'); assert.equal(events.length, 1); assert.equal(session.inspect().states[0].value, '2');
  session.dispose();
});
