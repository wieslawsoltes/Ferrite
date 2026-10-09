/** Runs against real DOM parsing, CSSStyleDeclaration, input properties and event dispatch. */
export async function uiRenderingBrowserTests(api) {
  const {UI: ui, renderToString, renderUIToString, compileUI} = api;
  const check = (value, message) => { if (!value) throw Error(message); };
  const container = document.createElement('main'); document.body.append(container); const results = [];
  let effectCount = 0, subscribeCount = 0, ref, update;
  const subscribe = () => { subscribeCount++; return () => subscribeCount--; };
  function App() {
    const [count, set] = ui.useState(1); update = set;
    const value = ui.useSyncExternalStore(subscribe, () => 'client', () => 'server');
    ui.useLayoutEffect(() => { check(ref?.isConnected, 'ref must refer to adopted live DOM'); effectCount++; return () => effectCount--; }, []);
    return ui.h('section', {id: ui.useId(), style: {width: 220, opacity: 0.9}},
      ui.h('button', {ref: n => { ref = n; }, onClick: () => set(n => n + 1)}, '', count, ' count'),
      ui.h('input', {defaultValue: 'uncontrolled'}), ui.h('input', {value: 'controlled'}),
      ui.h('input', {type: 'checkbox', defaultChecked: true}), ui.h('textarea', {value: '\n<&'}),
      ui.h('select', {value: 'b'}, ui.h('option', {value: 'a'}, 'A'), ui.h('option', {value: 'b'}, 'B')),
      ui.h('output', null, value), ui.h('svg', {viewBox: '0 0 10 10'}, ui.h('circle', {cx: 5})), ui.h('pre', null, '\nline'));
  }
  const html = renderToString(ui.h(App), {identifierPrefix: 'browser-'});
  check(effectCount === 0 && subscribeCount === 0 && !ref, 'SSR executed effects, subscriptions or refs');
  container.innerHTML = html;
  const section = container.querySelector('section'), button = container.querySelector('button'), input = container.querySelector('input');
  input.value = 'typed before hydration'; const errors = [];
  const root = ui.hydrateRoot(container, ui.h(App), {identifierPrefix: 'browser-', onRecoverableError: e => errors.push(e.message), throwErrors: true});
  check(errors.length === 0, 'matching HTML rejected: ' + errors.join('; '));
  check(container.querySelector('section') === section && container.querySelector('button') === button && ref === button, 'hydration replaced matching elements');
  check(container.querySelector('input') === input && input.value === 'typed before hydration', 'uncontrolled pre-hydration input lost');
  check(container.querySelector('textarea').value === '\n<&', 'textarea value mismatch');
  check(container.querySelector('select').value === 'b', 'select value mismatch');
  ui.flushSync(); check(container.querySelector('output').textContent === 'client', 'external store did not transition from server snapshot');
  button.click(); check(button.textContent === '2 count', 'hydrated click failed');
  ui.flushSync(() => update(8)); check(button.textContent === '8 count', 'coalesced text run did not update');
  check(effectCount === 1 && subscribeCount === 1, 'hydration effect lifecycle incorrect');
  root.unmount(); check(effectCount === 0 && subscribeCount === 0 && ref === null, 'hydration cleanup leaked');
  results.push('server hooks, real HTML parser hydration, controlled/uncontrolled forms, IDs, SVG and DOM identity');
  container.innerHTML = '<b>wrong tree</b>'; const old = container.firstChild, mismatch = [];
  const replacement = ui.hydrateRoot(container, ui.h('p', null, 'right tree'), {onRecoverableError: e => mismatch.push(e)});
  check(mismatch.length === 1 && old.parentNode === null && container.textContent === 'right tree', 'hydration mismatch did not recover');
  replacement.unmount(); results.push('reported hydration mismatch replaces the whole staged tree');
  const source = 'fn app()->ui::Node { let n=ui::state(4_i64); view! {<button on:click={move || ui::modify(n,|v|v+1)}>{ui::read(n)}</button>} }';
  const artifact = compileUI(source);
  for (const backend of ['javascript', 'mir', 'wasm']) {
    container.innerHTML = renderUIToString(artifact, {backend}); const original = container.querySelector('button');
    const session = api.mountUI(artifact, container, {backend, hydrate: true, onRecoverableError: e => { throw e; }});
    check(container.querySelector('button') === original, backend + ' replaced server DOM');
    original.click(); check(original.textContent === '5', backend + ' Rust hydrated click failed'); session.dispose();
  }
  results.push('all three Rust backends hydrate the original server nodes and execute typed events');
  container.remove(); return results;
}
