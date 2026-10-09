import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {performance} from 'node:perf_hooks';
import {Ferrite, compileUI, mountUI, runRust, runScripts, UI} from 'ferrite-compiler';
import React, {useState, useRef, useContext, use, createContext, memo, forwardRef, Children} from 'ferrite-compiler/react';
import {createRoot, flushSync} from 'ferrite-compiler/react-dom/client';
import {jsx, jsxs, Fragment} from 'ferrite-compiler/jsx-runtime';
import {jsxDEV} from 'ferrite-compiler/jsx-dev-runtime';
import {createDocument, elements} from './fixtures/ui-dom.js';
import {UI_SAMPLES} from '../src/ui-framework/Samples.js';

const source = UI_SAMPLES.counter;
function setup() { const doc = createDocument(); return {doc, container: doc.createElement('div')}; }

test('package JSX, component and DOM entry points share one dispatcher and keyed state', () => {
  assert.equal(React, UI);
  const {container} = setup(), context = createContext('fallback'), refs = [], setters = [];
  const Input = forwardRef((props, ref) => jsx('input', {...props, ref}));
  const Counter = memo(function Counter({initial}) {
    const [n, set] = useState(initial), ref = useRef(null), label = useContext(context);
    setters.push(set); refs.push(ref);
    return jsxs(Fragment, {children: [jsx(Input, {ref, value: label}), jsx('button', {onClick: () => set(n => n + 1), children: n})]});
  });
  const root = createRoot(container, {throwErrors: true});
  root.render(jsxDEV(context.Provider, {value: 'provided', children: jsx(Counter, {initial: 3}, 'counter')}, undefined, false));
  assert.equal(elements(container, 'input')[0].value, 'provided');
  assert.equal(refs[0].current, elements(container, 'input')[0]);
  elements(container, 'button')[0].dispatchEvent(new Event('click'));
  assert.equal(container.textContent, '4');
  assert.equal(setters[0], setters.at(-1));
  root.unmount(); assert.equal(refs[0].current, null);
});
test('conditional use(context) does not consume a hook slot; ordinary hooks remain ordered', () => {
  const {container} = setup(), context = createContext('X'); let update;
  function App({read}) { const [n, set] = useState(2); update = set; const text = read ? use(context) : '-'; const ref = useRef('stable'); return `${text}${n}${ref.current}`; }
  const root = createRoot(container, {throwErrors: true});
  root.render(jsx(App, {read: false})); root.render(jsx(App, {read: true})); flushSync(() => update(3));
  assert.equal(container.textContent, 'X3stable'); root.unmount();
  assert.throws(() => use(context), /render/i);
});
test('Children APIs preserve primitives and element identity without normalizing them into text nodes', () => {
  const element = jsx('b', {children: 'bold'}), children = ['text', [0, null, false, 7n], element];
  assert.deepEqual(Children.toArray(children), ['text', 0, 7n, element]);
  assert.equal(Children.count(children), 6); assert.equal(Children.count(null), 0);
  const visited = []; Children.forEach(children, (child, i) => visited.push([i, child]));
  assert.equal(visited[2][1], null); assert.equal(visited[3][1], null);
  assert.deepEqual(Children.map(['a', 'b'], (value, i) => [i, value]), [0, 'a', 1, 'b']);
  assert.equal(Children.map(null, () => 1), null); assert.equal(Children.only(element), element);
  assert.throws(() => Children.only([element])); assert.throws(() => Children.toArray({not: 'a child'}));
});
for (const backend of ['mir', 'wasm', 'javascript']) {
  test(`SDK executes general Rust and mounts source with an isolated runtime: ${backend}`, () => {
    const result = runRust('fn main() -> i64 { println!("Rust"); 6 * 7 }', {backend});
    assert.equal(result.value, 42n); assert.ok(result.output.includes('Rust'));
    const {container} = setup(), runtime = Ferrite.createUIRuntime();
    const session = mountUI(source, container, {backend, runtime});
    assert.equal(elements(container, 'output')[0].textContent, '0');
    elements(container, 'button').at(-1).dispatchEvent(new Event('click'));
    assert.equal(elements(container, 'output')[0].textContent, '1'); session.dispose();
    assert.throws(() => runRust('fn main() { loop {} }', {backend, maxSteps: 100}), /budget|steps|limit/i);
  });
}
test('inline scripts execute only explicitly and once; failed targets can be repaired and retried', () => {
  const {doc, container} = setup(), script = doc.createElement('script');
  script.dataset = {target: 'app'}; script.textContent = source;
  doc.querySelectorAll = () => [script]; doc.getElementById = () => null;
  const errors = [], first = runScripts({document: doc, onError: e => errors.push(e.message)});
  assert.equal(first.length, 1); assert.equal(errors.length, 1);
  doc.getElementById = () => container;
  const second = runScripts({document: doc}); assert.ok(second[0].result); assert.equal(runScripts({document: doc}).length, 0);
  second[0].result.dispose();
  const remote = doc.createElement('script'); remote.dataset = {}; remote.setAttribute('src', 'https://example.invalid/app.rs');
  doc.querySelectorAll = () => [remote]; assert.throws(() => runScripts({document: doc}), /inline-only/);
});
test('classic-script bundle is self-contained and performs the same three Rust executions', () => {
  const sandbox = {console, performance, queueMicrotask, structuredClone, TextEncoder, TextDecoder, WebAssembly};
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL('../src/sdk/ferrite.bundle.js', import.meta.url), 'utf8'), sandbox);
  const sdk = sandbox.Ferrite;
  assert.equal(typeof sdk.SourceDesigner, 'function'); assert.equal(typeof sdk.UI.createRef, 'function');
  for (const backend of ['mir', 'wasm', 'javascript']) assert.equal(sdk.runRust('fn main() -> i64 { 21 * 2 }', {backend}).value, 42n);
  assert.equal(sdk.compileUI(source).format, compileUI(source).format);
});
