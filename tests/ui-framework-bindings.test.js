import {test} from 'node:test';
import assert from 'node:assert/strict';
import {compileUI, mountUI, UI, renderUIToString, exportHydratedHTML} from '../src/sdk/Ferrite.js';
import {createDocument, elements} from './fixtures/ui-dom.js';
const source = `#[derive(Clone)] struct Props { initial: i64, step: i64 }
fn app(props: Props) -> ui::Node {
 let n = ui::state(props.initial); let step = props.step;
 view!{<button on:click={move || { ui::modify(n, |v|v+step); ui::emit("changed", ui::read(n)); }}>{ui::read(n)}</button>}
}`;
for (const backend of ['mir', 'javascript', 'wasm']) test(`typed entry props and emitted events use committed bindings: ${backend}`, () => {
  const artifact = compileUI(source, {entryProps: true}), doc = createDocument(), container = doc.createElement('div'), oldEvents = [], events = [];
  const session = mountUI(artifact, container, {backend, props: {initial: '5', step: '2'}, onEvent: (...v) => oldEvents.push(v)});
  elements(container, 'button')[0].dispatchEvent(new Event('click')); UI.flushSync();
  assert.equal(container.textContent, '7'); assert.deepEqual(oldEvents, [['changed', '7']]);
  session.updateProps({initial: '999', step: '3'}, {onEvent: (...v) => events.push(v)});
  elements(container, 'button')[0].dispatchEvent(new Event('click')); UI.flushSync();
  assert.equal(container.textContent, '10'); assert.deepEqual(events, [['changed', '10']]);
  assert.throws(() => session.updateProps({initial: 1, step: '3'}), /requires a BigInt/);
  session.dispose(); assert.equal(session.handles.size, 0);
});
test('typed UI entries require an explicit owned argument contract', () => {
  assert.throws(() => compileUI(source), /Entry point must not take parameters|UI entry/);
  assert.throws(() => compileUI('fn app(x:&i64)->ui::Node { view!{<p/>} }', {entryProps: true}), /owned UI data/);
  const artifact = compileUI(source, {entryProps: true});
  assert.match(renderUIToString(artifact, {props: {initial: '4', step: '1'}}), />4</);
  assert.match(exportHydratedHTML(artifact, {props: {initial: '4', step: '1'}}), />4</);
});
test('external components require an explicit registry and checked props', () => {
  const artifact = compileUI('fn app()->ui::Node {ui::external("Card", r#"{"title":"Hello"}"#, vec![ui::text("child")])}');
  assert.throws(() => renderUIToString(artifact), /not registered/);
  const Card = ({title, children}) => UI.h('article', {title}, children);
  assert.match(renderUIToString(artifact, {components: {Card}}), /title="Hello">child/);
  const bad = compileUI('fn app()->ui::Node {ui::external("Card", r#"{"onClick":"bad"}"#, vec![])}');
  assert.throws(() => renderUIToString(bad, {components: {Card}}), /Unsafe external/);
});
test('host effects cannot be emitted during component render', () => {
  const artifact = compileUI('fn app()->ui::Node {ui::emit("bad",1_i64); view!{<p/>}}');
  assert.throws(() => renderUIToString(artifact), /during render/);
});
