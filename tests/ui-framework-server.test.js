import test from 'node:test';
import assert from 'node:assert/strict';
import {UI, createUIRuntime} from '../src/ui-framework/Runtime.js';
import {ServerDocument} from '../src/ui-framework/ServerDocument.js';
import {renderToString, renderToStaticMarkup, renderUIToString, exportHydratedHTML} from '../src/ui-framework/ServerRenderer.js';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UI_SAMPLES} from '../src/ui-framework/Samples.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

function copyTree(from, document) {
  if (from.nodeType === 3) return document.createTextNode(from.data);
  if (from.nodeType === 8) return document.createComment(from.data);
  const node = document.createElementNS(from.namespaceURI, from.localName);
  for (const [key, value] of from.attributes) node.setAttribute(key, value);
  node.style.cssText = from.style.cssText;
  for (const child of from.childNodes) node.append(copyTree(child, document)); return node;
}

test('server rendering escapes data, serializes CSS/forms/SVG, and omits events', () => {
  const html = renderToString(UI.h('section', {title: '<&"'},
    UI.h('input', {defaultValue: '<&', defaultChecked: true, onClick: () => assert.fail('event'), style: {width: 20, opacity: 0.5, '--accent': 'red'}}),
    UI.h('textarea', {value: '\n<&'}), UI.h('select', {value: 'b'}, UI.h('option', {value: 'a'}, 'A'), UI.h('option', {value: 'b'}, 'B')),
    UI.h('svg', {viewBox: '0 0 10 10'}, UI.h('circle', {cx: 5})), UI.h('pre', null, '\nstart')));
  assert.match(html, /title="&lt;&amp;&quot;"/); assert.match(html, /width: 20px; opacity: 0.5; --accent: red;/);
  assert.match(html, /value="&lt;&amp;" checked=""/); assert.match(html, /<textarea>\n\n&lt;&amp;<\/textarea>/);
  assert.match(html, /<option value="b" selected="">B/); assert.match(html, /viewBox="0 0 10 10"/);
  assert.match(html, /<pre>\n\nstart/); assert.doesNotMatch(html, /onclick/i);
});
test('server hooks use server snapshots; effects, subscriptions, refs and cleanup never run', () => {
  let setups = 0, subscribed = 0; const refs = [];
  function App() {
    UI.useEffect(() => { setups++; return () => setups++; }, []); UI.useLayoutEffect(() => { setups++; }, []);
    const data = UI.useSyncExternalStore(() => { subscribed++; }, () => 'client', () => 'server');
    return UI.h('p', {id: UI.useId(), ref: node => refs.push(node)}, data);
  }
  const a = renderToString(UI.h(App), {identifierPrefix: 'root-'});
  const b = renderToString(UI.h(App), {identifierPrefix: 'root-'});
  assert.equal(a, b); assert.match(a, /id=":root-f1-/); assert.match(a, />server<\/p>/);
  assert.equal(setups, 0); assert.equal(subscribed, 0); assert.deepEqual(refs, []);
  assert.doesNotMatch(renderToStaticMarkup(UI.h(App)), /<!--/);
  assert.throws(() => renderToString(UI.h(() => UI.useSyncExternalStore(() => {}, () => 1))), /getServerSnapshot/);
});
test('hydration reuses elements, reconstructs empty/coalesced text, and commits refs before effects', () => {
  const ui = createUIRuntime(), server = new ServerDocument(), box = server.createElement('main');
  let change, ref, effects = 0;
  function App() {
    const [value, set] = ui.useState('x'); change = set;
    ui.useLayoutEffect(() => { assert.equal(ref.parentNode, actual); effects++; }, []);
    return ui.h('button', {ref: node => { ref = node; }, onClick: () => set('y')}, '', value, 'z');
  }
  const ssr = ui.createRoot(box, {server: true}); ssr.render(ui.h(App)); assert.equal(effects, 0);
  const document = createDocument(), actual = copyTree(box, document); ssr.unmount();
  const button = elements(actual, 'button')[0]; button.replaceChildren(document.createTextNode('xz'));
  const root = ui.hydrateRoot(actual, ui.h(App), {throwErrors: true});
  assert.equal(elements(actual, 'button')[0], button); assert.equal(effects, 1); assert.equal(ref, button);
  assert.equal(button.childNodes.length, 3); button.dispatchEvent(new Event('click')); assert.equal(button.textContent, 'yz');
  ui.flushSync(() => change('again')); assert.equal(button.textContent, 'againz'); root.unmount(); assert.equal(ref, null);
});
test('hydration mismatches recover as a single replacement, not a partially adopted tree', () => {
  const ui = createUIRuntime(), document = createDocument(), box = document.createElement('main'), old = document.createElement('i'); box.append(old);
  const errors = []; let ref;
  const root = ui.hydrateRoot(box, ui.h('b', {ref: n => { ref = n; }}, 'new'), {onRecoverableError: e => errors.push(e)});
  assert.equal(errors.length, 1); assert.equal(errors[0].code, 'R_UI_HYDRATION'); assert.equal(old.parentNode, null);
  assert.equal(ref, box.firstChild); assert.equal(box.textContent, 'new'); root.unmount();
});
for (const backend of ['mir', 'javascript', 'wasm']) test(`${backend}: Rust SSR and complete offline hydrated export`, () => {
  const artifact = UICompiler.compile(UI_SAMPLES.counter);
  const html = renderUIToString(artifact, {backend}); assert.match(html, /<output[^>]*>0<\/output>/);
  const exported = exportHydratedHTML(artifact, {backend, title: '<Rust>'});
  assert.ok(exported.includes(`<main id="app">${html}</main>`)); assert.ok(exported.includes('hydrate:true'));
  assert.ok(!exported.includes('<script src=')); new Function(exported.match(/<script>([\s\S]*)<\/script>/)[1]);
});
test('server limits and ambiguous DOM structures fail explicitly', () => {
  assert.throws(() => renderToString(UI.h('p', null, 'big'), {maxLength: 2}), /budget/);
  assert.throws(() => renderToString(UI.h('input', null, 'child')), /Void element/);
  assert.throws(() => renderToString(UI.h('textarea', {value: 'x'}, 'y')), /cannot also have children/);
  assert.throws(() => renderToString(UI.h('title', null, UI.h('span', null, 'bad'))), /primitive text/);
  assert.throws(() => renderToString(UI.createPortal(UI.h('b'), createDocument().createElement('div'))), /Portals/);
  assert.throws(() => renderToString(UI.h('p', {'bad name': 'injection'})), /attribute/);
});
