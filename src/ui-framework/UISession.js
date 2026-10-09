import {OwnedValues} from './OwnedValues.js';
import {UI} from './Runtime.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../runtime/WebAssemblyRuntime.js';

/** One application's backend, scoped host handles, callback lifetime and UI debugger. */
export class UISession {
  constructor(artifact, {backend = 'javascript', runtime = UI, maxHandles = 50000, maxTrace = 2000, onError = null} = {}) {
    if (artifact?.format !== 'ferrite-ui-v1' || artifact.abi !== 1 || !Array.isArray(artifact.optimizedMir)) throw Error('Unsupported UI artifact');
    if (!['javascript', 'wasm', 'mir'].includes(backend)) throw Error('Unknown UI backend');
    this.values = new OwnedValues(artifact.ownedSchemas);
    this.artifact = artifact; this.backend = backend; this.ui = runtime; this.maxHandles = maxHandles; this.maxTrace = maxTrace;
    this.onError = onError; this.handles = new Map(); this.nextHandle = 1; this.scopes = []; this.components = new Map();
    this.root = null; this.disposed = false; this.trace = []; this.currentEvent = null; this.depth = 0; this.callBudget = 0; this.calls = 0;
    this.debugger = {armed: false, vm: null, queue: [], breakpoints: [], descriptor: null, scope: null};
    this.listeners = new Set();
    if (backend === 'javascript') {
      this.program = new Function(artifact.js)();
      if (!this.program?.runtime || !this.program.functions) throw Error('Invalid UI JavaScript library');
      this.attach(this.program.runtime);
    } else if (backend === 'wasm') {
      this.program = new WebAssemblyRuntime(artifact.wasm, {maxSteps: artifact.maxSteps}); this.attach(this.program.runtime);
    }
  }
  emit(type, detail = {}) { for (const listener of this.listeners) { try { listener({type, ...detail}); } catch { /* Observers have no execution authority. */ } } }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  attach(runtime) {
    const builtin = runtime.builtin.bind(runtime), tick = runtime.tick.bind(runtime);
    runtime.builtin = (name, args, context) => name === 'ferrite.ui.v1' ? this.host(context.format, args, runtime) : builtin(name, args, context);
    runtime.tick = span => {
      if (++this.callBudget > this.artifact.maxSteps) runtime.fail('UI callback instruction budget exceeded', 'R_UI_BUDGET');
      tick(span);
    };
  }
  allocate(kind, value, persistent = false) {
    if (this.disposed) throw Error('UI session is disposed');
    if (this.handles.size >= this.maxHandles || this.nextHandle > 0xffffffff) throw Error('UI handle budget exceeded');
    const id = this.nextHandle++; this.handles.set(id, {kind, value});
    if (!persistent) { const scope = this.scopes.at(-1); if (!scope) throw Error('UI node allocation outside a Rust invocation'); scope.push(id); }
    return {handle: BigInt(id)};
  }
  resolve(handle, kind) {
    if (!handle || typeof handle.handle !== 'bigint' || handle.handle < 1n || handle.handle > 0xffffffffn) throw Error('Invalid UI handle');
    const record = this.handles.get(Number(handle.handle));
    if (!record || kind && record.kind !== kind) throw Error(`Stale or mismatched UI ${kind ?? 'value'} handle`);
    return record.value;
  }
  release(scope) { for (const id of scope) this.handles.delete(id); }
  prepareVm(instance, args) {
    const vm = new MirVirtualMachine(this.artifact.optimizedMir, {entry: instance, args, maxSteps: this.artifact.maxSteps, maxTrace: this.maxTrace});
    this.attach(vm.runtime); return vm;
  }
  invoke(instance, args = [], {node = false, label = 'call'} = {}) {
    if (this.disposed) throw Error('UI session is disposed');
    if (this.depth >= 64) throw Error('UI callback nesting budget exceeded');
    if (this.depth++ === 0) this.callBudget = 0;
    const scope = []; this.scopes.push(scope); const started = performance.now(); let value, vm;
    try {
      if (this.backend === 'mir') { vm = this.prepareVm(instance, args); vm.run(); value = vm.result; this.trace = vm.trace.slice(); }
      else {
        const runtime = this.program.runtime, previousDepth = runtime.depth;
        if (this.depth === 1) runtime.steps = 0;
        try { value = this.backend === 'wasm' ? this.program.instance.exports[instance](...args) : this.program.functions[instance](...args); }
        finally { runtime.depth = previousDepth; }
      }
      return node ? this.resolve(value, 'node') : value;
    } finally {
      this.scopes.pop(); this.release(scope); this.depth--; this.calls++;
      this.emit('callback', {instance, label, milliseconds: performance.now() - started, steps: vm?.runtime.steps ?? this.callBudget});
    }
  }
  closure(descriptor, environment, args = [], options = {}) {
    if (!descriptor || typeof descriptor.instance !== 'string') throw Error('Missing checked closure descriptor');
    // Fn uses a borrowed receiver to an owned environment retained by this JS closure.
    const reference = {__ref: true, cell: {value: environment}, path: []};
    return this.invoke(descriptor.instance, [reference, ...args], options);
  }
  event(descriptor, environment, args, event) {
    if (this.disposed) return;
    if (this.debugger.armed) {
      if (this.debugger.queue.length >= 100) throw Error('UI debugger event queue is full');
      this.debugger.queue.push({descriptor, environment, args}); this.emit('debug-queued', {count: this.debugger.queue.length});
      if (!this.debugger.vm) this.startDebugEvent(); return;
    }
    const previous = this.currentEvent; this.currentEvent = event;
    try { this.closure(descriptor, environment, args, {label: 'event'}); }
    finally { this.currentEvent = previous; }
  }
  host(spec, args, runtime) {
    if (spec?.version !== 1 || !Array.isArray(spec.types) || typeof spec.name !== 'string') throw Error('Invalid UI ABI descriptor');
    const u = this.ui, node = handle => this.resolve(handle, 'node'), create = vnode => this.allocate('node', vnode);
    const callback = (index, values = [], options) => this.closure(spec.callbacks?.[index], args[index], values, options);
    const text = value => String(value?.__ref ? runtime.read(value) : value ?? '');
    const state = (handle, kind) => { const result = this.resolve(handle, 'state'); if (result.kind !== kind) throw Error(`State requires ${kind}`); return result.cell; };
    const newState = (kind, initial) => {
      const cell = u._useCell(initial, {kind: `rust-state:${kind}`});
      if (!cell.handle) { cell.handle = this.allocate('state', {kind, cell}, true); cell.dispose = () => this.handles.delete(Number(cell.handle.handle)); }
      return cell.handle;
    };
    switch (spec.name) {
      case 'element': return create(u.h(String(args[0]), null, ...args[1].map(node)));
      case 'fragment': return create(u.h(u.Fragment, null, ...args[0].map(node)));
      case 'text': case 'value': return create(text(args[0]));
      case 'child': {
        const type = spec.types[0], value = args[0];
        if (type === 'ui::Node') return create(node(value));
        if (type === 'Vec<ui::Node>') return create(u.h(u.Fragment, null, ...value.map(node)));
        if (type === 'Option<ui::Node>') return create(value.tag === 'Option::Some' ? node(value.values[0]) : null);
        return create(type === '()' ? null : text(value));
      }
      case 'attr': {
        const name = String(args[1]);
        if (/^on/i.test(name) || ['ref', 'key', 'children', '__source', 'innerHTML', 'outerHTML', 'dangerouslySetInnerHTML', 'srcdoc'].includes(name)) throw Error(`Use a checked UI API instead of attribute ${name}`);
        return create(u.cloneElement(node(args[0]), {[name]: typeof args[2] === 'boolean' ? args[2] : text(args[2])}));
      }
      case 'key': return create(u.cloneElement(node(args[0]), {key: text(args[1])}));
      case 'source': return create(u.cloneElement(node(args[0]), {__source: String(args[1])}));
      case 'component': {
        const descriptor = spec.callbacks[0]; let component = this.components.get(descriptor.instance);
        if (!component) {
          const session = this;
          component = function RustComponent(props) { return session.closure(descriptor, props.environment, [], {node: true, label: 'render'}); };
          component.displayName = descriptor.type; this.components.set(descriptor.instance, component);
        }
        return create(u.h(component, {environment: args[0]}));
      }
      case 'on_click': {
        const descriptor = spec.callbacks[1], environment = args[1];
        return create(u.cloneElement(node(args[0]), {onClick: event => this.event(descriptor, environment, [], event)}));
      }
      case 'on': case 'on_event': {
        const name = String(args[1]);
        if (!/^[a-z][a-z0-9]*(?::capture)?$/.test(name) || name.length > 80) throw Error('Invalid UI event name');
        const eventName = this.eventProp(name);
        const descriptor = spec.callbacks[2], environment = args[2];
        return create(u.cloneElement(node(args[0]), {[eventName]: event => this.event(descriptor, environment, [spec.name === 'on_event' ? this.snapshotEvent(event) : String(event.target?.value ?? event.key ?? '')], event)}));
      }
      case 'state': return {...newState(spec.stateType, this.values.clone(spec.stateType, args[0])), marker: {}};
      case 'read': return this.values.clone(spec.stateType, state(args[0], spec.stateType).value);
      case 'write': state(args[0], spec.stateType).set(this.values.clone(spec.stateType, args[1])); return null;
      case 'modify': {
        const cell = state(args[0], spec.stateType), value = this.values.clone(spec.stateType, cell.value);
        cell.set(this.values.clone(spec.stateType, callback(1, [value]))); return null;
      }
      case 'memo_value': case 'memo_with': {
        const deps = spec.dependencyType ? this.values.key(spec.dependencyType, args[1]) : String(args[1]);
        return this.values.clone(spec.valueType, u.useMemo(() => this.values.clone(spec.valueType, callback(0)), [deps]));
      }
      case 'effect_with': {
        const deps = this.values.key(spec.dependencyType, args[2]), setup = spec.callbacks[0], cleanup = spec.callbacks[1];
        u.useEffect(() => { this.closure(setup, args[0]); return () => this.closure(cleanup, args[1]); }, [deps]); return null;
      }
      case 'stop_propagation':
        if (!this.currentEvent) throw Error('Cannot stop propagation outside a synchronous event');
        this.currentEvent.stopPropagation(); return null;
      case 'use_state': return newState('i64', args[0]);
      case 'use_string': return newState('String', String(args[0]));
      case 'use_bool': return newState('bool', args[0]);
      case 'get': return state(args[0], 'i64').value;
      case 'get_string': return state(args[0], 'String').value;
      case 'get_bool': return state(args[0], 'bool').value;
      case 'set': state(args[0], 'i64').set(args[1]); return null;
      case 'set_string': state(args[0], 'String').set(args[1]); return null;
      case 'set_bool': state(args[0], 'bool').set(args[1]); return null;
      case 'update': { const cell = state(args[0], 'i64'); cell.set(callback(1, [cell.value])); return null; }
      case 'use_ref': {
        const cell = u._useCell(() => ({current: null}), {kind: 'rust-ref'});
        if (!cell.handle) { cell.handle = this.allocate('ref', cell.value, true); cell.dispose = () => this.handles.delete(Number(cell.handle.handle)); }
        return cell.handle;
      }
      case 'node_ref': return create(u.cloneElement(node(args[0]), {ref: this.resolve(args[1], 'ref')}));
      case 'focus': this.resolve(args[0], 'ref').current?.focus(); return null;
      case 'ref_value': return String(this.resolve(args[0], 'ref').current?.value ?? '');
      case 'effect': {
        const setup = spec.callbacks[0], cleanup = spec.callbacks[1], setupEnv = args[0], cleanupEnv = args[1];
        u.useEffect(() => { this.closure(setup, setupEnv, [], {label: 'effect'}); return () => this.closure(cleanup, cleanupEnv, [], {label: 'cleanup'}); }, [String(args[2])]); return null;
      }
      case 'memo': return u.useMemo(() => callback(0, [], {label: 'memo'}), [String(args[1])]);
      case 'prevent_default':
        if (!this.currentEvent) throw Error('prevent_default requires a synchronous DOM event; paused debugger events cannot cancel a past browser default');
        this.currentEvent.preventDefault(); return null;
      default: throw Error(`Unknown UI ABI operation ${spec.name}`);
    }
  }
  eventProp(name) {
    const [event, capture] = name.split(':');
    const words = 'Click DoubleClick ContextMenu MouseDown MouseUp MouseMove MouseEnter MouseLeave MouseOver MouseOut KeyDown KeyUp KeyPress PointerDown PointerUp PointerMove PointerEnter PointerLeave PointerOver PointerOut PointerCancel GotPointerCapture LostPointerCapture TouchStart TouchEnd TouchMove TouchCancel Drag DragStart DragEnd DragEnter DragLeave DragOver Drop Input BeforeInput Change Submit Reset Focus Blur FocusIn FocusOut Wheel Scroll Copy Cut Paste CompositionStart CompositionUpdate CompositionEnd AnimationStart AnimationEnd AnimationIteration TransitionEnd Load Error';
    const aliases = Object.fromEntries(words.split(' ').map(word => [word.toLowerCase(), word])); aliases.dblclick = 'DoubleClick';
    return 'on' + (aliases[event] ?? event[0].toUpperCase() + event.slice(1)) + (capture ? 'Capture' : '');
  }
  snapshotEvent(event) {
    const text = value => { const result = String(value ?? ''); if (result.length > 1000000) throw Error('DOM event value budget exceeded'); return result; };
    const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
    const integer = (value, unsigned = false) => BigInt(unsigned ? number(value) >>> 0 : number(value) | 0);
    return {event_type: text(event.type), value: text(event.target?.value), key: text(event.key), code: text(event.code),
      checked: !!event.target?.checked, repeat: !!event.repeat, alt_key: !!event.altKey, ctrl_key: !!event.ctrlKey,
      meta_key: !!event.metaKey, shift_key: !!event.shiftKey, button: integer(event.button), buttons: integer(event.buttons, true),
      client_x: number(event.clientX), client_y: number(event.clientY), pointer_id: integer(event.pointerId), pressure: number(event.pressure),
      delta_x: number(event.deltaX), delta_y: number(event.deltaY), delta_z: number(event.deltaZ),
      input_type: text(event.inputType), data: text(event.data), time_stamp: number(event.timeStamp)};
  }
  mount(container, options = {}) {
    if (this.root || this.disposed) throw Error('A UI session mounts exactly once');
    const session = this;
    function RustApp() { return session.invoke(session.artifact.entry, [], {node: true, label: 'render'}); }
    RustApp.displayName = this.artifact.entry;
    this.root = this.ui.createRoot(container, {...options, throwErrors: true, onError: error => { this.emit('error', {message: error.message, code: error.code, span: error.span}); this.onError?.(error); }});
    this.root.subscribe(event => this.emit(event.type, event));
    try { this.root.render(this.ui.h(RustApp)); return this; }
    catch (error) { this.dispose(); throw error; }
  }
  armDebugger({breakpoints = []} = {}) {
    if (!Array.isArray(breakpoints) || breakpoints.length > 1000 || breakpoints.some(p => typeof p.file !== 'string' || !Number.isInteger(p.line) || p.line < 1)) throw Error('Invalid UI breakpoints');
    this.debugger.armed = true; this.debugger.breakpoints = breakpoints; return this.inspectDebugger();
  }
  startDebugEvent() {
    const debug = this.debugger, next = debug.queue.shift(); if (!next) return;
    this.callBudget = 0; debug.descriptor = next.descriptor; debug.scope = [];
    const ref = {__ref: true, cell: {value: next.environment}, path: []};
    debug.vm = this.prepareVm(next.descriptor.instance, [ref, ...next.args]); this.emit('debug-paused', this.inspectDebugger());
  }
  debug(command = 'continue') {
    const debug = this.debugger;
    if (command === 'stop') { if (debug.scope) this.release(debug.scope); debug.vm = null; debug.scope = null; debug.queue = []; debug.armed = false; return this.inspectDebugger(); }
    if (!['step', 'step-line', 'continue'].includes(command)) throw Error('Unknown UI debugger command');
    if (!debug.vm) this.startDebugEvent();
    const vm = debug.vm; if (!vm) return this.inspectDebugger();
    this.scopes.push(debug.scope); this.depth++;
    try {
      if (command === 'step') vm.step(); else if (command === 'step-line') vm.stepLine(); else vm.run({breakpoints: debug.breakpoints, skipFirst: true});
      this.trace = vm.trace.slice();
      if (vm.done) { this.release(debug.scope); debug.scope = null; }
    } catch (error) {
      this.release(debug.scope ?? []); debug.scope = null; debug.vm = null; throw error;
    } finally { this.depth--; this.scopes.pop(); this.ui.flushSync(); }
    const result = this.inspectDebugger(); this.emit(vm.done ? 'debug-complete' : 'debug-paused', result);
    if (vm.done) debug.vm = null;
    return result;
  }
  inspectDebugger() {
    return {armed: this.debugger.armed, queued: this.debugger.queue.length, callback: this.debugger.descriptor,
      state: this.debugger.vm?.snapshot() ?? null, trace: this.trace.slice(-this.maxTrace), breakpoints: this.debugger.breakpoints.slice(),
      boundary: 'Instruction stepping pauses event callbacks only. Component rendering and effect callbacks remain synchronous.'};
  }
  inspect() {
    const states = [];
    for (const [handle, entry] of this.handles) if (entry.kind === 'state') states.push({handle, type: entry.value.kind, value: this.values.schemas[entry.value.kind] ? this.values.encode(entry.value.kind, entry.value.cell.value) : this.ui._safeValue(entry.value.cell.value)});
    return {format: 'ferrite-ui-inspection-v1', backend: this.backend, calls: this.calls, handles: this.handles.size, states,
      root: this.root?.inspect() ?? null, debugger: this.inspectDebugger()};
  }
  setState(handle, value) {
    const record = this.resolve({handle: BigInt(handle)}, 'state');
    if (this.values.schemas[record.kind]) value = this.values.decode(record.kind, value);
    else if (record.kind === 'i64') { value = BigInt(String(value).replace(/n$/, '')); if (value < -(1n << 63n) || value >= 1n << 63n) throw Error('State is outside i64 bounds'); }
    else if (record.kind === 'bool' && typeof value !== 'boolean' || record.kind === 'String' && typeof value !== 'string') throw Error('State type mismatch');
    this.ui.flushSync(() => record.cell.set(value)); return this.inspect();
  }
  dispose() {
    if (this.disposed) return;
    this.debug('stop'); this.root?.unmount(); this.disposed = true; this.handles.clear(); this.components.clear(); this.listeners.clear();
  }
}
