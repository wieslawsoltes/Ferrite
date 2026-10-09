/**
 * Independent, synchronous React-shaped DOM runtime. No React internals or globals.
 * The factory is deliberately self-contained: exported applications serialize it.
 */
export function createUIRuntime() {
  const ELEMENT = Symbol.for('ferrite.ui.element');
  const Fragment = Symbol.for('ferrite.ui.fragment');
  const Suspense = Symbol.for('ferrite.ui.suspense');
  const ErrorBoundary = Symbol.for('ferrite.ui.error-boundary');
  const EMPTY = Symbol('empty'), TEXT = Symbol('text'), PORTAL = Symbol('portal');
  const roots = new WeakMap(), promises = new WeakMap();
  const blockedTags = new Set(['script', 'iframe', 'object', 'embed', 'base', 'meta', 'link']);
  const booleanProps = new Set('disabled checked selected multiple muted required readOnly autoFocus hidden open controls loop reversed noValidate formNoValidate allowFullScreen inert'.split(' '));
  const unitless = new Set('animationIterationCount aspectRatio borderImageOutset borderImageSlice borderImageWidth columnCount flex flexGrow flexShrink fontWeight gridArea gridColumn gridColumnEnd gridColumnStart gridRow gridRowEnd gridRowStart lineHeight opacity order orphans scale tabSize widows zIndex zoom fillOpacity strokeOpacity strokeWidth'.split(' '));
  let current = null, nextId = 1, batchDepth = 0;
  const scheduled = new Set();
  const fail = message => { throw new Error(message); };
  const isElement = value => !!value && value.$$typeof === ELEMENT;
  const equalDeps = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const shallowEqual = (a, b) => a === b || !!a && !!b && Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(k => Object.hasOwn(b, k) && Object.is(a[k], b[k]));
  const sameContext = (a, b) => a === b || a.size === b.size && [...a].every(([key, value]) => b.has(key) && Object.is(value, b.get(key)));

  function createElement(type, props, ...children) {
    if (!(typeof type === 'string' || typeof type === 'function' || [Fragment, Suspense, ErrorBoundary, PORTAL].includes(type) || type?.$$kind)) fail('Invalid UI element type');
    const input = props ?? {}, result = {...input};
    const key = input.key == null ? null : String(input.key);
    delete result.key;
    if (children.length) result.children = children.length === 1 ? children[0] : children;
    return {$$typeof: ELEMENT, type, key, props: result};
  }
  function normalize(value) {
    if (isElement(value)) return value;
    if (value == null || typeof value === 'boolean') return {$$typeof: ELEMENT, type: EMPTY, key: null, props: {}};
    if (Array.isArray(value)) return createElement(Fragment, null, ...value);
    if (['string', 'number', 'bigint'].includes(typeof value)) return {$$typeof: ELEMENT, type: TEXT, key: null, props: {value: String(value)}};
    fail('A component must return an element, text, an array, or null');
  }
  function childrenOf(value, result = [], depth = 0) {
    if (depth > 128 || result.length > 20000) fail('UI child budget exceeded');
    if (Array.isArray(value)) for (const child of value) childrenOf(child, result, depth + 1);
    else if (value !== undefined) result.push(normalize(value));
    return result;
  }
  function hook(kind, initialize) {
    if (!current) fail(`${kind} must be called while rendering a function component`);
    const fiber = current, index = fiber.cursor++;
    let cell = fiber.hooks[index];
    if (cell && cell.kind !== kind) fail(`Hook order changed in ${nameOf(fiber.type)} at hook ${index}`);
    if (!cell) {
      if (fiber.rendered) fail(`More hooks rendered in ${nameOf(fiber.type)}`);
      cell = initialize(fiber); cell.kind = kind; cell.owner = fiber; fiber.hooks[index] = cell;
    }
    return cell;
  }
  function invalidate(fiber) {
    if (!fiber.mounted || fiber.root.disposed) return;
    for (let f = fiber; f; f = f.parent) f.dirty = true;
    const root = fiber.root;
    scheduled.add(root);
    if (!batchDepth && !root.queued) {
      root.queued = true;
      queueMicrotask(() => { root.queued = false; if (scheduled.delete(root) && !root.disposed) root.perform(); });
    }
  }
  function useCell(initial, {kind = 'state', dispose = null} = {}) {
    return hook(kind, owner => {
      const cell = {value: typeof initial === 'function' ? initial() : initial, dispose};
      cell.set = next => {
        if (!owner.mounted) return;
        if (current) fail('State updates during render are not supported');
        const value = typeof next === 'function' ? next(cell.value) : next;
        if (!Object.is(value, cell.value)) { cell.value = value; invalidate(owner); }
      };
      return cell;
    });
  }
  function useState(initial) { const cell = useCell(initial); return [cell.value, cell.set]; }
  function useReducer(reducer, initialArg, init) {
    const cell = hook('reducer', owner => {
      const value = init ? init(initialArg) : initialArg;
      const state = {value, reducer};
      state.dispatch = action => {
        if (!owner.mounted) return;
        if (current) fail('Reducer dispatch during render is not supported');
        const next = state.reducer(state.value, action);
        if (!Object.is(state.value, next)) { state.value = next; invalidate(owner); }
      };
      return state;
    });
    cell.reducer = reducer; return [cell.value, cell.dispatch];
  }
  function useRef(initial = null) { return hook('ref', () => ({ref: {current: initial}})).ref; }
  function useMemo(factory, deps) {
    if (deps !== undefined && !Array.isArray(deps)) fail('Hook dependencies must be an array');
    const cell = hook('memo', () => ({initialized: false}));
    if (!cell.initialized || !equalDeps(cell.deps, deps)) { cell.value = factory(); cell.deps = deps?.slice(); cell.initialized = true; }
    return cell.value;
  }
  function useCallback(callback, deps) { return useMemo(() => callback, deps); }
  function effect(kind, setup, deps) {
    if (typeof setup !== 'function' || deps !== undefined && !Array.isArray(deps)) fail('Invalid effect');
    const cell = hook(kind, () => ({initialized: false, cleanup: null, pending: null}));
    if (!cell.initialized || !equalDeps(cell.deps, deps)) {
      cell.pending = {setup, deps: deps?.slice()};
      current.root[kind === 'layout' ? 'layouts' : 'effects'].add(cell);
    }
  }
  function useEffect(setup, deps) { effect('effect', setup, deps); }
  function useLayoutEffect(setup, deps) { effect('layout', setup, deps); }
  function assignRef(ref, value) { if (typeof ref === 'function') ref(value); else if (ref && typeof ref === 'object') ref.current = value; }
  function useImperativeHandle(ref, create, deps) {
    useLayoutEffect(() => { assignRef(ref, create()); return () => assignRef(ref, null); }, deps === undefined ? undefined : [...deps, ref]);
  }
  function createContext(defaultValue) {
    const context = {$$kind: 'provider', defaultValue, displayName: 'Context'};
    context.Provider = context;
    context.Consumer = props => props.children(useContext(context));
    return context;
  }
  function useContext(context) {
    if (context?.$$kind !== 'provider') fail('Invalid context');
    const cell = hook('context', () => ({})); cell.context = context;
    return current.context.has(context) ? current.context.get(context) : context.defaultValue;
  }
  function useId() { return hook('id', owner => ({value: `:f${owner.root.id}-${owner.id}-${owner.cursor}:`})).value; }
  function useSyncExternalStore(subscribe, getSnapshot, _getServerSnapshot) {
    const [value, force] = useState(() => ({snapshot: getSnapshot()}));
    const snapshot = getSnapshot();
    useLayoutEffect(() => {
      const check = () => { const next = getSnapshot(); force(previous => Object.is(previous.snapshot, next) ? previous : {snapshot: next}); };
      const unsubscribe = subscribe(check); check();
      return typeof unsubscribe === 'function' ? unsubscribe : undefined;
    }, [subscribe, getSnapshot]);
    void value; return snapshot;
  }
  function memo(type, compare = shallowEqual) { return {$$kind: 'memo', type, compare}; }
  function forwardRef(render) { return {$$kind: 'forwardRef', render}; }
  function use(value) {
    if (value?.$$kind === 'provider') return useContext(value);
    if (!value || typeof value.then !== 'function') fail('use expects a Promise or context');
    let record = promises.get(value);
    if (!record) { record = {status: 'pending'}; promises.set(value, record); value.then(result => Object.assign(record, {status: 'fulfilled', value: result}), error => Object.assign(record, {status: 'rejected', error})); }
    if (record.status === 'fulfilled') return record.value;
    if (record.status === 'rejected') throw record.error;
    throw value;
  }
  function lazy(load) {
    let promise;
    return function Lazy(props) { promise ??= Promise.resolve().then(load); const module = use(promise); return createElement(module.default ?? module, props); };
  }
  function nameOf(type) {
    return typeof type === 'string' ? type : typeof type === 'function' ? type.displayName || type.name || 'Anonymous' :
      type === Fragment ? 'Fragment' : type === Suspense ? 'Suspense' : type === ErrorBoundary ? 'ErrorBoundary' : type === TEXT ? '#text' : type === EMPTY ? '#empty' : type === PORTAL ? 'Portal' : type?.displayName ?? type?.$$kind ?? 'Unknown';
  }
  function safeValue(value, depth = 0, seen = new Set()) {
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value === 'symbol') return String(value);
    if (!value || typeof value !== 'object') return value;
    if (depth > 3 || seen.has(value)) return '[Object]'; seen.add(value);
    if (value.nodeType) return `[DOM ${value.nodeName}]`;
    const out = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value).slice(0, 40)) if (key !== 'owner' && key !== 'children') out[key] = safeValue(value[key], depth + 1, seen);
    return out;
  }
  function moveRange(parent, fiber, before) {
    if (fiber.last.nextSibling === before && fiber.first.parentNode === parent) return;
    let node = fiber.first;
    while (node) { const next = node.nextSibling; parent.insertBefore(node, before); if (node === fiber.last) break; node = next; }
  }
  function removeRange(fiber) {
    let node = fiber.first;
    while (node) { const next = node.nextSibling; node.parentNode?.removeChild(node); if (node === fiber.last) break; node = next; }
  }
  function cleanup(cell, root) {
    const fn = cell.cleanup; cell.cleanup = null;
    if (typeof fn === 'function') { try { fn(); } catch (error) { root.report(error); } }
  }
  function dispose(fiber, remove = true) {
    if (!fiber) return;
    fiber.mounted = false; fiber.waitVersion++;
    for (const child of fiber.children) dispose(child, false);
    for (const cell of fiber.hooks) cleanup(cell, fiber.root);
    for (const cell of fiber.hooks) if (typeof cell.dispose === 'function') { try { cell.dispose(cell.value); } catch (error) { fiber.root.report(error); } }
    if (fiber.element) {
      assignRef(fiber.props.ref, null);
      for (const listener of fiber.listeners.values()) fiber.element.removeEventListener(listener.event, listener.handler, listener.capture);
    }
    if (fiber.portalStart) {
      let node = fiber.portalStart;
      while (node) { const next = node.nextSibling; node.parentNode?.removeChild(node); if (node === fiber.portalEnd) break; node = next; }
    }
    fiber.root.fibers.delete(fiber.id);
    if (remove) removeRange(fiber);
  }
  function eventName(key, element) {
    let name = key.slice(2), capture = false;
    if (name.endsWith('Capture')) { name = name.slice(0, -7); capture = true; }
    const aliases = {DoubleClick: 'dblclick', Focus: 'focusin', Blur: 'focusout'};
    let event = aliases[name] ?? name.toLowerCase();
    if (name === 'Change') event = element.localName === 'select' || ['checkbox', 'radio'].includes(element.type) ? 'change' : 'input';
    return {event, capture};
  }
  function safeUrl(value) {
    const normalized = String(value).replace(/[\u0000-\u0020\u007f]+/g, '').toLowerCase();
    if (/^(javascript|vbscript):/.test(normalized) || /^data:/.test(normalized) && !/^data:image\/(png|jpeg|gif|webp|avif);/i.test(normalized)) fail('Unsafe UI URL');
    return String(value);
  }
  function setStyle(element, value, previous) {
    if (typeof value === 'string') { element.style.cssText = value; return; }
    if (typeof previous === 'string') element.style.cssText = '';
    if (value != null && typeof value !== 'object') fail('style must be a CSS string or object');
    for (const name of new Set([...Object.keys(previous && typeof previous === 'object' ? previous : {}), ...Object.keys(value ?? {})])) {
      let next = value?.[name];
      if (next == null || next === false) next = '';
      else if (typeof next === 'number' && next !== 0 && !unitless.has(name) && !name.startsWith('--')) next = `${next}px`;
      if (name.includes('-')) element.style.setProperty(name, String(next)); else element.style[name] = String(next);
    }
  }
  function updateProps(fiber, next) {
    const element = fiber.element, previous = fiber.props ?? {};
    // Input type is needed before onChange chooses its native event.
    if (Object.hasOwn(next, 'type') && element.localName === 'input') element.setAttribute('type', String(next.type));
    for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
      const value = next[key];
      if (['children', 'key', 'ref', '__source'].includes(key)) continue;
      if (/^on[A-Z]/.test(key)) {
        const spec = eventName(key, element), existing = fiber.listeners.get(key);
        if (existing && (value == null || existing.event !== spec.event || existing.capture !== spec.capture)) {
          element.removeEventListener(existing.event, existing.handler, existing.capture); fiber.listeners.delete(key);
        }
        if (value != null) {
          if (typeof value !== 'function') fail(`Event ${key} requires a function`);
          let listener = fiber.listeners.get(key);
          if (!listener) {
            listener = {...spec, callback: value};
            listener.handler = event => {
              if (!fiber.mounted) return;
              batchDepth++;
              try { listener.callback(event); } catch (error) { fiber.root.report(error); }
              finally { batchDepth--; if (!batchDepth) flushSync(); }
            };
            fiber.listeners.set(key, listener); element.addEventListener(spec.event, listener.handler, spec.capture);
          }
          listener.callback = value;
        }
        continue;
      }
      if (/^on/i.test(key) || ['innerHTML', 'outerHTML', 'dangerouslySetInnerHTML', 'srcdoc'].includes(key)) fail(`Unsafe or unsupported DOM property ${key}`);
      if (key === 'style') { setStyle(element, value, previous.style); continue; }
      const name = ({className: 'class', htmlFor: 'for', tabIndex: 'tabindex'})[key] ?? key;
      if (['value', 'checked', 'selected', 'muted'].includes(key) && key in element) {
        if (value !== undefined && value !== null) {
          const converted = key === 'value' ? String(value) : !!value;
          if (element[key] !== converted) element[key] = converted;
        } else if (Object.hasOwn(previous, key)) element[key] = key === 'value' ? '' : false;
        continue;
      }
      if (key === 'defaultValue') { if (!fiber.rendered && value != null) element.defaultValue = String(value); continue; }
      if (key === 'defaultChecked') { if (!fiber.rendered && value != null) element.defaultChecked = !!value; continue; }
      if (booleanProps.has(key)) { if (value) element.setAttribute(name, ''); else element.removeAttribute(name); continue; }
      if (value == null || value === false && !name.startsWith('aria-') && !name.startsWith('data-')) element.removeAttribute(name);
      else element.setAttribute(name, ['href', 'src', 'action', 'formAction', 'xlink:href'].includes(key) ? safeUrl(value) : String(value));
    }
    if (next.__source) element.setAttribute('data-ferrite-source', String(next.__source)); else element.removeAttribute('data-ferrite-source');
    if (previous.ref !== next.ref) { assignRef(previous.ref, null); assignRef(next.ref, element); }
    fiber.props = {...next, ...(next.style && typeof next.style === 'object' ? {style: {...next.style}} : {})};
  }
  function reconcileChildren(parent, owner, values, before, context, depth) {
    const next = childrenOf(values), keyed = new Map(), used = new Set();
    for (const child of owner.children) if (child.key !== null) keyed.set(child.key, child);
    const duplicate = new Set();
    for (const value of next) if (value.key !== null) { if (duplicate.has(value.key)) fail(`Duplicate sibling key: ${value.key}`); duplicate.add(value.key); }
    const children = [];
    // Left-to-right component evaluation, then range movement right-to-left.
    for (let i = 0; i < next.length; i++) {
      const value = next[i];
      const old = value.key !== null ? keyed.get(value.key) : owner.children[i]?.key === null ? owner.children[i] : null;
      if (old) used.add(old);
      const child = reconcile(parent, old, value, before, context, owner, depth + 1);
      children.push(child);
      // Keep partially created trees reachable for deterministic failure cleanup.
      owner.pendingChildren = children;
    }
    for (const old of owner.children) if (!used.has(old)) dispose(old);
    let cursor = before;
    for (let i = children.length - 1; i >= 0; i--) { moveRange(parent, children[i], cursor); cursor = children[i].first; }
    owner.children = children; owner.pendingChildren = null;
  }
  function reconcile(parent, old, vnode, before, context, owner, depth) {
    const root = owner.root;
    if (++root.visits > root.maxNodes || depth > 128) fail('UI render budget exceeded');
    if (old && old.type !== vnode.type) { dispose(old); old = null; }
    let fiber = old;
    if (!fiber) {
      fiber = {id: nextId++, type: vnode.type, key: vnode.key, root, parent: owner, hooks: [], cursor: 0, children: [], props: {}, context,
        dirty: true, mounted: true, rendered: false, waitVersion: 0, listeners: new Map()};
      root.fibers.set(fiber.id, fiber);
      const document = parent.ownerDocument;
      if (typeof vnode.type === 'string') {
        if (!/^[A-Za-z][\w:.-]*$/.test(vnode.type) || blockedTags.has(vnode.type.toLowerCase())) fail(`Unsafe or invalid element tag: ${vnode.type}`);
        const svg = vnode.type === 'svg' || parent.namespaceURI === 'http://www.w3.org/2000/svg' && parent.localName !== 'foreignObject';
        fiber.element = svg ? document.createElementNS('http://www.w3.org/2000/svg', vnode.type) : document.createElement(vnode.type);
        fiber.first = fiber.last = fiber.element;
      } else if (vnode.type === TEXT) fiber.first = fiber.last = document.createTextNode(vnode.props.value);
      else { fiber.first = document.createComment(`f:${fiber.id}`); fiber.last = document.createComment(`/f:${fiber.id}`); }
      parent.insertBefore(fiber.first, before);
      if (fiber.last !== fiber.first) parent.insertBefore(fiber.last, before);
    }
    fiber.parent = owner;
    const previousContext = fiber.context;
    fiber.context = context;
    const props = vnode.props;
    if (fiber.element) {
      updateProps(fiber, props);
      reconcileChildren(fiber.element, fiber, props.children, null, context, depth);
      // Controlled selects apply their value only after options exist.
      if (fiber.element.localName === 'select' && props.value != null) fiber.element.value = String(props.value);
    } else if (vnode.type === TEXT) { if (fiber.first.data !== props.value) fiber.first.data = props.value; fiber.props = props; }
    else if (vnode.type === EMPTY) fiber.props = props;
    else if (vnode.type === Fragment) { fiber.props = props; reconcileChildren(parent, fiber, props.children, fiber.last, context, depth); }
    else if (vnode.type === PORTAL) {
      if (!props.container?.insertBefore) fail('Portal requires a DOM container');
      if (fiber.portalTarget !== props.container) {
        for (const child of fiber.children) dispose(child); fiber.children = [];
        fiber.portalStart?.remove(); fiber.portalEnd?.remove();
        fiber.portalTarget = props.container;
        fiber.portalStart = props.container.ownerDocument.createComment('portal'); fiber.portalEnd = props.container.ownerDocument.createComment('/portal');
        props.container.append(fiber.portalStart, fiber.portalEnd);
      }
      fiber.props = props; reconcileChildren(props.container, fiber, props.children, fiber.portalEnd, context, depth);
    } else if (vnode.type?.$$kind === 'provider') {
      const nextContext = new Map(context); nextContext.set(vnode.type, props.value); fiber.props = props;
      reconcileChildren(parent, fiber, props.children, fiber.last, nextContext, depth);
    } else if (vnode.type === ErrorBoundary || vnode.type === Suspense) {
      fiber.props = props;
      const reset = () => { fiber.error = null; invalidate(fiber); };
      try {
        const output = fiber.error ? typeof props.fallback === 'function' ? props.fallback(fiber.error, reset) : props.fallback : props.children;
        reconcileChildren(parent, fiber, output, fiber.last, context, depth);
      } catch (error) {
        const promise = error && typeof error.then === 'function';
        if (vnode.type === Suspense ? !promise : promise) throw error;
        const all = new Set([...fiber.children, ...(fiber.pendingChildren ?? [])]);
        for (const child of all) if (child.mounted) dispose(child);
        fiber.children = []; fiber.pendingChildren = null;
        // Remove an incompletely-created child range even when its render threw.
        for (let n = fiber.first.nextSibling; n && n !== fiber.last;) { const next = n.nextSibling; n.remove(); n = next; }
        for (const child of [...root.fibers.values()]) { let p = child.parent; while (p && p !== fiber) p = p.parent; if (p === fiber && child.mounted) dispose(child, false); }
        if (promise) {
          const version = ++fiber.waitVersion;
          error.then(() => { if (fiber.mounted && version === fiber.waitVersion) invalidate(fiber); }, () => { if (fiber.mounted && version === fiber.waitVersion) invalidate(fiber); });
        } else fiber.error = error;
        const fallback = !promise && typeof props.fallback === 'function' ? props.fallback(error, reset) : props.fallback;
        reconcileChildren(parent, fiber, fallback, fiber.last, context, depth);
      }
    } else {
      if (vnode.type?.$$kind === 'memo' && fiber.rendered && !fiber.dirty && sameContext(previousContext, context) && vnode.type.compare(fiber.props, props)) return fiber;
      const previous = current; current = fiber; fiber.cursor = 0;
      let output;
      try {
        let type = vnode.type;
        if (type?.$$kind === 'memo') type = type.type;
        output = type?.$$kind === 'forwardRef' ? type.render(props, props.ref ?? null) : type(props);
        if (fiber.rendered && fiber.cursor !== fiber.hooks.length) fail(`Fewer hooks rendered in ${nameOf(vnode.type)}`);
      } finally { current = previous; }
      fiber.props = props;
      reconcileChildren(parent, fiber, normalize(output), fiber.last, context, depth);
    }
    fiber.rendered = true; fiber.dirty = false;
    return fiber;
  }
  function runEffects(root, cells) {
    const pending = [...cells]; cells.clear();
    for (const cell of pending) {
      if (!cell.owner.mounted || !cell.pending) continue;
      const next = cell.pending; cell.pending = null; cleanup(cell, root);
      if (!cell.owner.mounted) continue;
      try {
        const result = next.setup();
        if (result != null && typeof result !== 'function') fail('An effect may return only a cleanup function');
        cell.cleanup = result; cell.deps = next.deps; cell.initialized = true;
      } catch (error) { root.report(error); }
    }
  }
  function createRoot(container, options = {}) {
    if (!container?.ownerDocument || !container.insertBefore) fail('createRoot requires a DOM container');
    if (roots.has(container)) fail('This container already has a Ferrite root');
    const root = {id: nextId++, container, vnode: null, children: [], hooks: [], fibers: new Map(), layouts: new Set(), effects: new Set(), listeners: new Set(), timeline: [],
      disposed: false, rendering: false, queued: false, mounted: true, maxNodes: options.maxNodes ?? 20000, visits: 0, commits: 0};
    root.root = root; root.parent = null;
    root.emit = (type, detail = {}) => {
      const event = {type, commit: root.commits, ...detail}; root.timeline.push(event); if (root.timeline.length > 500) root.timeline.shift();
      for (const listener of root.listeners) { try { listener(event); } catch { /* Observers cannot corrupt a commit. */ } }
    };
    root.report = error => { root.emit('error', {message: error?.message ?? String(error)}); if (options.onError) options.onError(error); else console.error(error); };
    root.perform = () => {
      if (root.disposed || root.rendering) return;
      runEffects(root, root.effects); scheduled.delete(root);
      root.rendering = true; root.visits = 0; const start = performance.now();
      try {
        reconcileChildren(container, root, normalize(root.vnode), null, new Map(), 0);
        root.commits++; root.emit('commit', {milliseconds: performance.now() - start, visited: root.visits});
      } catch (error) {
        // A failed root has no half-live hooks, listeners, or leaked detached fibers.
        for (const fiber of [...root.fibers.values()]) if (fiber.mounted) dispose(fiber, false);
        root.children = []; root.pendingChildren = null; container.replaceChildren(); root.report(error);
        if (options.throwErrors) throw error;
      } finally { root.rendering = false; }
      runEffects(root, root.layouts);
      if (root.effects.size) queueMicrotask(() => { if (!root.disposed) runEffects(root, root.effects); });
    };
    root.render = vnode => { if (root.disposed) fail('Cannot render an unmounted root'); root.vnode = vnode; root.perform(); return root; };
    root.unmount = () => {
      if (root.disposed) return;
      root.disposed = true; root.mounted = false; scheduled.delete(root);
      for (const fiber of root.children) dispose(fiber); root.children = []; root.layouts.clear(); root.effects.clear(); roots.delete(container);
      root.emit('unmount'); root.listeners.clear();
    };
    root.subscribe = listener => { root.listeners.add(listener); return () => root.listeners.delete(listener); };
    root.flushEffects = () => { runEffects(root, root.layouts); runEffects(root, root.effects); };
    root.inspect = () => {
      const inspect = fiber => ({id: fiber.id, type: nameOf(fiber.type), key: fiber.key, source: fiber.props.__source ?? null,
        props: safeValue(fiber.props), hooks: fiber.hooks.map((cell, index) => ({index, kind: cell.kind, value: safeValue(cell.value ?? cell.ref?.current)})), children: fiber.children.map(inspect)});
      return {version: 1, commits: root.commits, disposed: root.disposed, tree: root.children.map(inspect), timeline: root.timeline.slice()};
    };
    roots.set(container, root); container.replaceChildren();
    return root;
  }
  function flushSync(action) {
    batchDepth++;
    try { action?.(); } finally { batchDepth--; }
    if (batchDepth) return;
    let passes = 0;
    while (scheduled.size) {
      if (++passes > 100) { scheduled.clear(); fail('UI update loop exceeded 100 commits'); }
      for (const root of [...scheduled]) { scheduled.delete(root); root.perform(); }
    }
  }
  function cloneElement(element, props, ...children) {
    if (!isElement(element)) fail('cloneElement expects a Ferrite element');
    return createElement(element.type, {...element.props, key: element.key, ...props}, ...(children.length ? children : []));
  }
  const Children = {
    toArray: value => childrenOf(value).filter(v => v.type !== EMPTY),
    count: value => childrenOf(value).length,
    only: value => { if (!isElement(value)) fail('Children.only requires one element'); return value; },
    map: (value, fn, self) => childrenOf(value).map((child, i) => fn.call(self, child.type === EMPTY ? null : child.type === TEXT ? child.props.value : child, i)),
    forEach: (value, fn, self) => { Children.map(value, fn, self); }
  };
  return {version: '0.1.0', createElement, h: createElement, jsx: (type, props, key) => createElement(type, {...props, ...(key === undefined ? {} : {key})}), jsxs: (type, props, key) => createElement(type, {...props, ...(key === undefined ? {} : {key})}), Fragment, Suspense, ErrorBoundary, createRoot,
    createPortal: (children, container, key = null) => createElement(PORTAL, {container, key}, children),
    useState, useReducer, useRef, useEffect, useLayoutEffect, useMemo, useCallback, useContext, useId, useImperativeHandle, useSyncExternalStore,
    createContext, memo, forwardRef, lazy, use, flushSync, cloneElement, isValidElement: isElement, Children,
    _useCell: useCell, _safeValue: safeValue};
}

export const UI = createUIRuntime();
