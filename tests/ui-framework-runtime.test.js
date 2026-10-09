import test from 'node:test';
import assert from 'node:assert/strict';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

function setup() { const ui = createUIRuntime(), document = createDocument(), container = document.createElement('main'), errors = []; return {ui, document, container, errors, root: ui.createRoot(container, {onError: error => errors.push(error), throwErrors: true})}; }

test('keyed components retain DOM identity and hook state through reorder', () => {
  const {ui, root, container} = setup(); const setters = new Map();
  function Item({id}) { const [n, set] = ui.useState(0); setters.set(id, set); return ui.h('button', {id}, `${id}:${n}`); }
  const draw = keys => root.render(ui.h('div', null, keys.map(id => ui.h(Item, {key: id, id}))));
  draw(['a', 'b', 'c']); const [a, b, c] = elements(container, 'button');
  ui.flushSync(() => setters.get('b')(42)); draw(['c', 'b', 'a']);
  assert.deepEqual(elements(container, 'button'), [c, b, a]); assert.equal(b.textContent, 'b:42');
  draw(['b', 'd']); assert.equal(elements(container, 'button')[0], b); assert.equal(container.textContent, 'b:42d:0'); root.unmount();
});
test('functional state updates and reducer dispatch are batched once per event', () => {
  const {ui, root, container} = setup(); let renders = 0;
  function App() { renders++; const [n, set] = ui.useState(0), [sum, dispatch] = ui.useReducer((s, a) => s + a, 0); return ui.h('button', {onClick: () => { set(n => n + 1); set(n => n + 1); dispatch(3); }}, `${n}/${sum}`); }
  root.render(ui.h(App)); elements(container, 'button')[0].dispatchEvent(new Event('click')); assert.equal(container.textContent, '2/3'); assert.equal(renders, 2); root.unmount();
});
test('memoization propagates context updates and preserves stable memo values', () => {
  const {ui, root, container} = setup(), context = ui.createContext('default'); let computed = 0;
  const Child = ui.memo(function Child() { const value = ui.useContext(context), memo = ui.useMemo(() => ++computed, []); return ui.h('span', null, value + memo); });
  root.render(ui.h(context.Provider, {value: 'A'}, ui.h(Child))); root.render(ui.h(context.Provider, {value: 'B'}, ui.h(Child))); assert.equal(container.textContent, 'B1'); root.unmount();
});
test('effects clean up on dependency changes and unmount exactly once', () => {
  const {ui, root} = setup(), events = [];
  function App({n}) { ui.useLayoutEffect(() => { events.push('layout' + n); return () => events.push('unlayout' + n); }, [n]); ui.useEffect(() => { events.push('effect' + n); return () => events.push('uneffect' + n); }, [n]); return null; }
  root.render(ui.h(App, {n: 1})); root.flushEffects(); root.render(ui.h(App, {n: 2})); root.flushEffects(); root.unmount();
  assert.deepEqual(events, ['layout1', 'effect1', 'unlayout1', 'layout2', 'uneffect1', 'effect2', 'unlayout2', 'uneffect2']);
});
test('conditional hooks and duplicate keys fail rather than silently corrupt state', () => {
  const {ui, root} = setup(); function App({extra}) { ui.useState(0); if (extra) ui.useRef(null); return null; }
  root.render(ui.h(App, {extra: true})); assert.throws(() => root.render(ui.h(App, {extra: false})), /hooks/i);
  assert.throws(() => root.render([ui.h('div', {key: 'x'}), ui.h('div', {key: 'x'})]), /Duplicate/); root.unmount();
});
test('refs detach and portals are cleaned without deleting unrelated DOM', () => {
  const {ui, document, root, container} = setup(), portal = document.createElement('aside'), unrelated = document.createElement('i'), ref = {current: null}; portal.append(unrelated);
  root.render(ui.h('div', {ref}, ui.createPortal(ui.h('span', null, 'portal'), portal)));
  assert.equal(ref.current, elements(container, 'div')[0]); assert.equal(portal.textContent, 'portal'); root.unmount(); assert.equal(ref.current, null); assert.deepEqual(portal.childNodes, [unrelated]);
});
test('error boundary recovers and suspending components retry on resolution', async () => {
  const {ui, root, container} = setup(); function Broken() { throw Error('broken'); }
  root.render(ui.h(ui.ErrorBoundary, {fallback: error => ui.h('b', null, error.message)}, ui.h(Broken))); assert.equal(container.textContent, 'broken');
  let resolve; const promise = new Promise(r => { resolve = r; }); function Async() { return ui.h('span', null, ui.use(promise)); }
  root.render(ui.h(ui.Suspense, {fallback: 'waiting'}, ui.h(Async))); assert.equal(container.textContent, 'waiting'); resolve('ready'); await promise; await new Promise(r => setTimeout(r, 0)); assert.equal(container.textContent, 'ready'); root.unmount();
});
test('DOM injection, executable URLs, duplicate roots and render updates are rejected', () => {
  const {ui, root, container} = setup();
  for (const vnode of [ui.h('script'), ui.h('div', {innerHTML: '<img>'}), ui.h('a', {href: 'java\nscript:alert(1)'}), ui.h('div', {onclick: 'alert(1)'})]) assert.throws(() => root.render(vnode));
  assert.throws(() => ui.createRoot(container), /already/);
  function Bad() { const [, set] = ui.useState(0); set(1); return null; } assert.throws(() => root.render(ui.h(Bad)), /during render/); root.unmount();
});
test('style object updates remove old properties; events swap without duplicating listeners', () => {
  const {ui, root, container} = setup(); let a = 0, b = 0;
  root.render(ui.h('button', {style: {width: 10, opacity: .5}, onClick: () => a++}, 'A'));
  const button = elements(container, 'button')[0]; root.render(ui.h('button', {style: {height: 20}, onClick: () => b++}, 'B')); button.dispatchEvent(new Event('click'));
  assert.equal(button.style.width, ''); assert.equal(button.style.height, '20px'); assert.equal(a, 0); assert.equal(b, 1); root.unmount();
});

// Native-Wasm bindings deliberately bypass JSX's onChange/onFocus aliases.
test('explicit native DOM events retain exact names, replace listeners and reject strings', () => {
  const {ui, root, container} = setup(); const events = [];
  const draw = callback => root.render(ui.h('input', {'on:change': callback, 'on:focus': e => events.push(e.type)}));
  draw(e => events.push('old:' + e.type)); const input = elements(container, 'input')[0];
  input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('focusin'));
  assert.deepEqual(events, []); input.dispatchEvent(new Event('change'));
  draw(e => events.push('new:' + e.type)); input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('focus'));
  assert.deepEqual(events, ['old:change', 'new:change', 'focus']);
  draw(null); input.dispatchEvent(new Event('change')); assert.equal(events.length, 3);
  assert.throws(() => root.render(ui.h('input', {'on:change': 'execute()'})), /requires a function/);
  root.unmount();
});
