import test from 'node:test';
import assert from 'node:assert/strict';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UISession} from '../src/ui-framework/UISession.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {UI_SAMPLES} from '../src/ui-framework/Samples.js';
import {ViewSyntax, rustString} from '../src/ui-framework/ViewSyntax.js';
import {exportHTML, scriptJSON} from '../src/ui-framework/Export.js';
import {createDocument, elements} from './fixtures/ui-dom.js';

for (const backend of ['mir', 'wasm', 'javascript']) {
  test(`${backend}: real typed Rust counter, functional updates and handle cleanup`, () => {
    const ui = createUIRuntime(), container = createDocument().createElement('main'), errors = [];
    const artifact = UICompiler.compile(UI_SAMPLES.counter), session = new UISession(artifact, {backend, runtime: ui, onError: e => errors.push(e)}).mount(container);
    assert.equal(elements(container, 'output')[0]?.textContent, '0'); const buttons = elements(container, 'button');
    for (let i = 0; i < 10; i++) buttons[1].dispatchEvent(new Event('click'));
    assert.equal(elements(container, 'output')[0]?.textContent, '10'); assert.equal(session.handles.size, 1); assert.equal(errors.length, 0);
    session.setState(session.inspect().states[0].handle, '9223372036854775807'); assert.equal(elements(container, 'output')[0].textContent, '9223372036854775807');
    assert.throws(() => session.setState(session.inspect().states[0].handle, '9223372036854775808'), /bounds/);
    session.dispose(); assert.equal(container.textContent, ''); assert.equal(session.handles.size, 0);
  });
  test(`${backend}: controlled strings, ref focus and multiple component instances`, () => {
    const ui = createUIRuntime(), document = createDocument(), container = document.createElement('main'), errors = [];
    let session = new UISession(UICompiler.compile(UI_SAMPLES.form), {backend, runtime: ui, onError: e => errors.push(e)}).mount(container);
    const input = elements(container, 'input')[0]; input.value = 'Ferrite'; input.dispatchEvent(new Event('input'));
    assert.equal(elements(container, 'h1')[0].textContent, 'Hello, Ferrite!'); elements(container, 'button')[0].dispatchEvent(new Event('click')); assert.equal(document.activeElement, input); session.dispose();
    session = new UISession(UICompiler.compile(UI_SAMPLES.components), {backend, runtime: ui, onError: e => errors.push(e)}).mount(container);
    const buttons = elements(container, 'button'); buttons[0].dispatchEvent(new Event('click')); assert.equal(buttons[0].textContent, '2'); assert.equal(buttons[1].textContent, '10'); assert.equal(errors.length, 0); session.dispose();
  });
}

test('MIR event debugger steps an owned callback and releases temporary handles', () => {
  const ui = createUIRuntime(), container = createDocument().createElement('main');
  const session = new UISession(UICompiler.compile(UI_SAMPLES.counter), {runtime: ui}).mount(container);
  session.armDebugger(); elements(container, 'button')[1].dispatchEvent(new Event('click'));
  assert.ok(session.debugger.vm); assert.equal(elements(container, 'output')[0].textContent, '0');
  const step = session.debug('step'); assert.ok(step.state); session.debug('continue'); assert.equal(elements(container, 'output')[0].textContent, '1');
  assert.equal(session.handles.size, 1); session.debug('stop'); session.dispose();
});
test('retained borrowed captures, wrong callback types and entry signatures reject', () => {
  assert.throws(() => UICompiler.compile('fn app() -> ui::Node { let n = 1; view! { <button on:click={|| println!("{}", n)}>Click</button> } }'), e => e.code === 'F_UI_LIFETIME');
  assert.throws(() => UICompiler.compile('fn app() -> ui::Node { view! { <button on:click={42}>Click</button> } }'));
  assert.throws(() => UICompiler.compile('fn app(n: i64) -> ui::Node { ui::text("bad") }'));
  assert.throws(() => UICompiler.compile('fn app() -> i64 { 1 }'), e => e.code === 'F_UI_ENTRY');
  for (const maxSteps of [0, NaN, Infinity, -1, 2000001]) assert.throws(() => UICompiler.compile(UI_SAMPLES.counter, {maxSteps}), e => e.code === 'F_UI_BUDGET');
});
test('view frontend ignores comments and raw strings; maps expressions to original spans', () => {
  const source = '// view! { <broken> }\nconst S: &str = r#"view! { <bad> }"#;\nfn app() -> ui::Node { view! { <p>{1 + 2}</p> } }';
  const expansion = new ViewSyntax(source).expand(); assert.equal(expansion.macros.length, 1);
  const offset = expansion.source.indexOf('1 + 2'); assert.equal(expansion.mapSpan({start: offset, end: offset + 5}).start, source.indexOf('1 + 2'));
  assert.ok(UICompiler.compile(source).optimizedMir.length);
});
test('nested view expressions and lists remain typed nodes', () => {
  const source = 'fn app() -> ui::Node { let children = vec![view! { <b>A</b> }, view! { <i>B</i> }]; view! { <div>{children}{Some(view! { <u>C</u> })}</div> } }';
  const ui = createUIRuntime(), container = createDocument().createElement('main'); const session = new UISession(UICompiler.compile(source), {runtime: ui}).mount(container);
  assert.equal(container.textContent, 'ABC'); session.dispose();
});
test('single-file export escapes hostile source/title/CSS and carries no module dependencies', () => {
  const source = 'fn app() -> ui::Node { ui::text("</script><script>bad()</script>\\u{2028}") }';
  const artifact = UICompiler.compile(source);
  for (const backend of ['mir', 'wasm', 'javascript']) {
    const html = exportHTML(artifact, {backend, title: '</title><script>bad()</script>', css: '/* </script> */'});
    assert.equal((html.match(/<script>/gi) ?? []).length, 1); assert.equal((html.match(/<\/script>/gi) ?? []).length, 1);
    assert.ok(html.includes("connect-src 'none'")); assert.ok(!html.includes('type="module"')); assert.ok(!html.includes('<script src='));
    new Function(html.match(/<script>([\s\S]*)<\/script>/)[1]);
  }
  assert.equal(JSON.parse(scriptJSON('<&\u2028')), '<&\u2028'); assert.equal(rustString('\u0001'), '"\\u{1}"');
});

test('a failed initial mount throws, reports the panic, and releases its hooks and root', () => {
  const ui = createUIRuntime(), container = createDocument().createElement('main'), errors = [];
  const artifact = UICompiler.compile('fn app() -> ui::Node { let n = ui::use_state(1); if ui::get(n) == 1 { panic!("bad app"); } ui::text("ready") }');
  for (const backend of ['mir', 'wasm', 'javascript']) {
    const session = new UISession(artifact, {runtime: ui, backend, onError: e => errors.push(e)});
    assert.throws(() => session.mount(container), /bad app/); assert.equal(session.disposed, true); assert.equal(session.handles.size, 0);
  }
  assert.equal(errors.length, 3);
  const valid = new UISession(UICompiler.compile(UI_SAMPLES.counter), {runtime: ui}).mount(container); valid.dispose();
});
