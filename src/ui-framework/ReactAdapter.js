import {UISession} from './UISession.js';
import {UI} from './Runtime.js';
import {CanvasLayout} from './CanvasLayout.js';

/**
 * Inject one real React installation. React owns reconciliation, scheduling,
 * contexts, classes, Suspense, Activity, DevTools and third-party components.
 * No React internals, dependency aliases or second hook dispatcher are used.
 */
export function createReactAdapter({React, ReactDOMClient = null, ReactDOM = null, ReactDOMServer = null} = {}) {
  for (const name of ['createElement', 'cloneElement', 'useState', 'useEffect', 'useMemo', 'useSyncExternalStore', 'forwardRef', 'useImperativeHandle']) {
    if (typeof React?.[name] !== 'function') throw Error(`The real React adapter requires React.${name}`);
  }
  if (typeof WeakRef !== 'function') throw Error('The React adapter requires WeakRef for abandoned-render hook ownership');
  const roots = new WeakMap();
  const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link']);
  const blockedProps = new Set(['innerHTML', 'outerHTML', 'dangerouslySetInnerHTML', 'srcdoc', 'srcDoc']);
  const checkType = type => { if (typeof type === 'string' && (!/^[A-Za-z][\w:.-]*$/.test(type) || blockedTags.has(type.toLowerCase()))) throw Error(`Unsafe Rust DOM tag ${type}`); };
  function styleObject(style) {
    if (typeof style !== 'string') return style;
    const result = {};
    for (const part of CanvasLayout.declarations(style)) {
      const value = style.slice(part.valueStart, part.valueEnd).trim();
      if (/!\s*important\s*$/i.test(value)) throw Error('Use a stylesheet for !important rules in the React adapter');
      const name = part.name.startsWith('--') ? part.name : part.name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()).replace(/^Ms/, 'ms');
      result[name] = value;
    }
    return result;
  }
  function propsFor(type, input) {
    const props = {...input};
    if (Object.hasOwn(props, '__source')) { props['data-ferrite-source'] = props.__source; delete props.__source; }
    for (const [name, value] of Object.entries(props)) {
      if (blockedProps.has(name) || /^on/i.test(name) && value != null && typeof value !== 'function') throw Error(`Unsafe Rust DOM prop ${name}`);
      if (['href', 'src', 'action', 'formAction', 'xlinkHref'].includes(name) && typeof value === 'string' && /^(?:(?:javascript|vbscript):|data:text\/html(?:[;,]|$))/i.test(value.replace(/[\u0000-\u0020]/g, ''))) throw Error('Executable DOM URLs are forbidden');
      if (typeof type === 'string' && name === 'style') props.style = styleObject(value);
    }
    return props;
  }
  function h(type, props, ...children) { checkType(type); return React.createElement(type, propsFor(type, props), ...children); }
  function cloneElement(element, props, ...children) { checkType(element.type); return React.cloneElement(element, propsFor(element.type, props), ...children); }
  function useCell(initial, {kind = 'state'} = {}) {
    const [cell] = React.useState(() => {
      const value = typeof initial === 'function' ? initial() : initial;
      const listeners = new Set();
      const cell = {kind, value, initial: value, dispose: null};
      cell.subscribe = listener => { listeners.add(listener); return () => listeners.delete(listener); };
      cell.snapshot = () => cell.value;
      cell.serverSnapshot = () => cell.initial;
      cell.set = update => {
        const next = typeof update === 'function' ? update(cell.value) : update;
        if (!Object.is(next, cell.value)) { cell.value = next; for (const listener of [...listeners]) listener(); }
      };
      return cell;
    });
    if (cell.kind !== kind) throw Error('Rust hook order/type changed in a React component');
    React.useSyncExternalStore(cell.subscribe, cell.snapshot, cell.serverSnapshot);
    // Do not dispose on an effect cleanup: Strict Mode and Activity retain these
    // cells across effect teardown. The fiber owns them; session handles are weak.
    return cell;
  }
  function createRoot(container, options = {}) {
    if (!ReactDOMClient?.createRoot || !ReactDOMClient?.hydrateRoot) throw Error('Inject react-dom/client to mount a React root');
    if (roots.has(container)) throw Error('A React adapter root already owns this container');
    let native = null, disposed = false, commits = 0;
    const listeners = new Set(), timeline = [];
    const observe = (id, phase, actualDuration, baseDuration, startTime, commitTime) => {
      const event = {type: 'commit', renderer: 'react', id, phase, actualDuration, baseDuration, startTime, commitTime, commit: ++commits};
      timeline.push(event); if (timeline.length > 500) timeline.shift();
      for (const listener of listeners) { try { listener(event); } catch { /* Observers cannot interrupt a commit. */ } }
    };
    const root = {
      render(node) {
        if (disposed) throw Error('React root is unmounted');
        const tree = React.createElement(React.Profiler, {id: 'Ferrite', onRender: observe}, node);
        if (!native && options.hydrate) native = ReactDOMClient.hydrateRoot(container, tree, options);
        else { native ??= ReactDOMClient.createRoot(container, options); native.render(tree); }
        return root;
      },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      inspect() { return {renderer: 'react', commits, timeline: timeline.slice(), boundary: 'React Profiler observations; use React DevTools for React component internals.'}; },
      flushEffects() { throw Error('React controls effect scheduling; use React act in tests'); },
      unmount() { if (!disposed) { disposed = true; native?.unmount(); listeners.clear(); roots.delete(container); } }
    };
    roots.set(container, root); return root;
  }
  const runtime = Object.freeze({
    renderer: 'react', weakHookHandles: true, h, createElement: h, cloneElement,
    Fragment: React.Fragment, Suspense: React.Suspense, createRoot,
    _useCell: useCell, _safeValue: UI._safeValue,
    useState: React.useState, useEffect: React.useEffect, useMemo: React.useMemo,
    flushSync: callback => ReactDOM?.flushSync ? ReactDOM.flushSync(callback ?? (() => {})) : callback?.()
  });
  function createComponent(artifact, options = {}) {
    const Component = React.forwardRef(function CompiledRust({value = options.props, onEvent = options.onEvent, components = options.components} = {}, ref) {
      const [session] = React.useState(() => new UISession(artifact, {...options, runtime}));
      React.useImperativeHandle(ref, () => Object.freeze({inspect: () => session.inspect(), setState: (handle, v) => session.setState(handle, v), armDebugger: v => session.armDebugger(v), debug: command => session.debug(command)}), [session]);
      return session.render(session.validateBindings({props: value, onEvent, components}));
    });
    Component.displayName = `Rust(${artifact.entry})`; return Component;
  }
  function mount(artifact, container, options = {}) { return new UISession(artifact, {...options, runtime}).mount(container, options); }
  function renderToString(node, options = {}) {
    if (!ReactDOMServer?.renderToString) throw Error('Inject react-dom/server to render React HTML');
    return ReactDOMServer.renderToString(node, options);
  }
  function renderToReadableStream(node, options = {}) {
    if (!ReactDOMServer?.renderToReadableStream) throw Error('This react-dom/server build does not support readable streams');
    return ReactDOMServer.renderToReadableStream(node, options);
  }
  function renderToPipeableStream(node, options = {}) {
    if (!ReactDOMServer?.renderToPipeableStream) throw Error('This react-dom/server build does not support pipeable streams');
    return ReactDOMServer.renderToPipeableStream(node, options);
  }
  return Object.freeze({runtime, createComponent, mount, renderToString, renderToReadableStream, renderToPipeableStream,
    boundary: 'Rust signals use useSyncExternalStore and update synchronously. React components retain the real React scheduler; Rust store mutations are not non-blocking transitions.'});
}
