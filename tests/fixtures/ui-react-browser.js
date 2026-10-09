/** Runs against actual pinned React/ReactDOM/Radix, never mocks. */
export async function uiReactBrowserTests(F, reference) {
  const {React: R, ReactDOM: D, ReactDOMClient: C, ReactDOMServer: S, Dialog} = reference;
  const checks = [], failures = [], h = R.createElement;
  const assert = (value, message) => { if (!value) throw Error(message); };
  const adapter = F.createReactAdapter({React: R, ReactDOM: D, ReactDOMClient: C, ReactDOMServer: S});
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  const act = R.act, container = () => document.body.appendChild(document.createElement('div'));
  const code = `#[derive(Clone)] struct Props {initial:i64, step:i64}
    fn app(p:Props)->ui::Node {
      let n=ui::state(p.initial); let step=p.step; let input=ui::use_ref();
      ui::effect(move || ui::emit("setup",ui::read(n)),move || ui::emit("cleanup",ui::read(n)),"once");
      view!{<section style="display: flex; gap: 4px"><input ref={input} value="ok" readOnly/><button on:click={move || {ui::modify(n,|v|v+step);ui::focus(input);ui::emit("change",ui::read(n));}}>{ui::read(n)}</button></section>}
    }`;
  const artifact = F.compileUI(code, {entryProps: true});
  for (const backend of ['javascript', 'mir', 'wasm']) {
    const node = container(), events = [], next = [], ref = R.createRef(), Rust = adapter.createComponent(artifact, {backend});
    const root = C.createRoot(node), render = (props, onEvent) => h(R.StrictMode, null, h(Rust, {value: props, onEvent, ref}));
    await act(() => root.render(render({initial: '4', step: '2'}, (...v) => events.push(v))));
    assert(events.filter(e => e[0] === 'setup').length === 2 && events.filter(e => e[0] === 'cleanup').length === 1, 'real StrictMode effect replay');
    await act(() => node.querySelector('button').click());
    assert(node.querySelector('button').textContent === '6' && document.activeElement === node.querySelector('input'), 'state and ref survive StrictMode');
    await act(() => root.render(render({initial: '900', step: '3'}, (...v) => next.push(v))));
    await act(() => node.querySelector('button').click());
    assert(node.querySelector('button').textContent === '9' && next.some(e => e[0] === 'change' && e[1] === '9'), 'prop refresh and committed emitter');
    const state = ref.current.inspect().states.find(s => s.type === 'i64');
    await act(() => ref.current.setState(state.handle, '20'));
    assert(node.querySelector('button').textContent === '20', 'live inspection edits real React component');
    await act(() => root.unmount()); node.remove();
    assert(events.filter(e => e[0] === 'cleanup').length === 2, 'final cleanup follows mount capture');
    checks.push(`real React StrictMode, owned state, props, refs, cleanup and events: ${backend}`);
  }
  {
    const node = container(), events = [], Rust = adapter.createComponent(artifact, {backend: 'wasm'}), root = C.createRoot(node);
    const render = mode => h(R.Activity, {mode}, h(Rust, {value: {initial: '1', step: '1'}, onEvent: (...v) => events.push(v)}));
    await act(() => root.render(render('visible'))); await act(() => node.querySelector('button').click());
    await act(() => root.render(render('hidden'))); await act(() => root.render(render('visible')));
    await act(() => node.querySelector('button').click());
    assert(node.querySelector('button').textContent === '3', 'Activity keeps Rust hook identities through effect teardown');
    await act(() => root.unmount()); node.remove(); checks.push('Activity hide/reveal retains Rust state and restores effects');
  }
  {
    const node = container(), events = [], root = C.createRoot(node), Context = R.createContext('missing');
    class ClassLabel extends R.Component { render() { return h('span', {'data-class': true}, this.props.children); } }
    function Bridge(props) { return h(ClassLabel, null, R.useContext(Context), props.children); }
    const a = F.compileUI('fn app()->ui::Node {ui::external("Bridge", "{}", vec![ui::text(" Rust")])}');
    const Rust = adapter.createComponent(a, {components: {Bridge}});
    await act(() => root.render(h(Context.Provider, {value: 'React'}, h(Rust))));
    assert(node.textContent === 'React Rust' && node.querySelector('[data-class]'), 'real context/class interop');
    // The Rust node is slotted into a genuine Radix trigger; Radix supplies the
    // portal, accessibility, focus management and dismissal implementation.
    const button = adapter.createComponent(F.compileUI('fn app()->ui::Node {view!{<button>Open dialog</button>}}'));
    const DialogApp = () => h(Dialog.Root, null,
      h(Dialog.Trigger, {asChild: true}, h('span', null, h(button))),
      h(Dialog.Portal, null, h(Dialog.Content, null, h(Dialog.Title, null, 'Real Radix'), h(Dialog.Description, null, 'Hosted React ecosystem'), h(Dialog.Close, null, 'Close'))));
    await act(() => root.render(h(DialogApp))); await act(() => node.querySelector('button').click());
    assert(document.querySelector('[role=dialog]')?.textContent.includes('Real Radix'), 'Radix portal opened');
    await act(() => document.querySelector('[role=dialog] button').click());
    assert(!document.querySelector('[role=dialog]'), 'Radix portal dismissed');
    await act(() => root.unmount()); node.remove(); checks.push('real React context, class components and Radix Dialog portal');
  }
  {
    const node = container(), root = C.createRoot(node); let navigate, release, ready = false;
    const pending = new Promise(resolve => { release = () => { ready = true; resolve(); }; });
    const emissions = [], Rust = adapter.createComponent(artifact);
    function Gate({page}) { if (page === 'next' && !ready) throw pending; return h('span', {'data-page': page}, page); }
    function App() { const [page, setPage] = R.useState('old'); navigate = () => R.startTransition(() => setPage('next')); return h(R.Suspense, {fallback: 'Loading'}, h(Rust, {value: {initial: '2', step: page === 'old' ? '1' : '10'}, onEvent: (name, value) => emissions.push([page, name, value])}), h(Gate, {page})); }
    await act(() => root.render(h(App))); await act(() => navigate());
    assert(node.querySelector('[data-page=old]'), 'React transition retains old committed content');
    await act(() => node.querySelector('button').click());
    assert(emissions.some(e => e[0] === 'old' && e[1] === 'change' && e[2] === '3'), 'suspended props do not leak into committed Rust callback');
    await act(async () => { release(); await pending; }); await act(() => node.querySelector('button').click());
    assert(node.querySelector('[data-page=next]') && emissions.some(e => e[0] === 'next' && e[1] === 'change' && e[2] === '13'), 'transition commit updates props without state loss');
    await act(() => root.unmount()); node.remove(); checks.push('real Suspense/concurrent transitions preserve committed Rust callback bindings');
  }
  {
    const node = container(), Rust = adapter.createComponent(artifact, {backend: 'wasm'}), tree = h(Rust, {value: {initial: '8', step: '2'}, onEvent: () => {}});
    node.innerHTML = adapter.renderToString(tree, {identifierPrefix: 'react-test'}); const before = node.querySelector('button');
    let root; await act(() => { root = C.hydrateRoot(node, tree, {identifierPrefix: 'react-test', onRecoverableError: error => failures.push(error.message)}); });
    assert(node.querySelector('button') === before, 'real React hydration adopts server node');
    await act(() => before.click()); assert(before.textContent === '10', 'hydrated Wasm event handler');
    await act(() => root.unmount()); node.remove();
    const stream = await adapter.renderToReadableStream(tree); await stream.allReady;
    assert((await new Response(stream).text()).includes('>8<'), 'real React stream contains Rust rendered content');
    checks.push('real React SSR, hydration identity and streaming with compiled Wasm components');
  }
  {
    const node = container(); let session;
    await act(() => { session = adapter.mount(F.compileUI('fn app()->ui::Node {view!{<button>Owned root</button>}}'), node); });
    assert(node.textContent === 'Owned root' && session.inspect().root.renderer === 'react', 'owned real React root and Profiler');
    await act(() => session.dispose()); assert(session.handles.size === 0 && !node.textContent, 'owned root explicitly disposed'); node.remove();
    checks.push('owned React root has explicit deterministic disposal and public Profiler inspection');
  }
  assert(!failures.length, failures.join('\n')); return checks;
}
