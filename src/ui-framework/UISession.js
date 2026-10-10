import {OwnedValues} from './OwnedValues.js';
import {UI} from './Runtime.js';
import {MirVirtualMachine} from '../runtime/MirVirtualMachine.js';
import {WebAssemblyRuntime} from '../runtime/WebAssemblyRuntime.js';

/** One application's backend, scoped host handles, callback lifetime and UI debugger. */
export class UISession {
  constructor(artifact, {backend = 'javascript', runtime = UI, maxHandles = 50000, maxTrace = 2000, onError = null, props, onEvent = null, components = {}} = {}) {
    if (artifact?.format !== 'ferrite-ui-v1' || artifact.abi !== 1 || !Array.isArray(artifact.optimizedMir)) throw Error('Unsupported UI artifact');
    if (!['javascript', 'wasm', 'mir'].includes(backend)) throw Error('Unknown UI backend');
    this.bindings = this.validateBindings({props, onEvent, components}); this.currentBindings = null; this.labels = [];
    this.values = new OwnedValues(artifact.ownedSchemas);
    this.artifact = artifact; this.backend = backend; this.ui = runtime; this.maxHandles = maxHandles; this.maxTrace = maxTrace;
    this.onError = onError; this.handles = new Map(); this.nextHandle = 1; this.scopes = []; this.components = new Map();
    this.root = null; this.disposed = false; this.trace = []; this.currentEvent = null; this.depth = 0; this.callBudget = 0; this.calls = 0;
    this.debugger = {armed: false, status: 'disarmed', reason: null, vm: null, queue: [], breakpoints: [], descriptor: null, scope: null, timer: null, epoch: 0, pauseNext: false, error: null};
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
    if (this.ui.weakHookHandles && (this.handles.size >= this.maxHandles || this.nextHandle % 1024 === 0)) this.pruneHandles();
    if (this.handles.size >= this.maxHandles || this.nextHandle > 0xffffffff) throw Error('UI handle budget exceeded');
    const id = this.nextHandle++; this.handles.set(id, persistent && this.ui.weakHookHandles ? {kind, weak: new WeakRef(value)} : {kind, value});
    if (!persistent) { const scope = this.scopes.at(-1); if (!scope) throw Error('UI node allocation outside a Rust invocation'); scope.push(id); }
    return {handle: BigInt(id)};
  }
  resolve(handle, kind) {
    if (!handle || typeof handle.handle !== 'bigint' || handle.handle < 1n || handle.handle > 0xffffffffn) throw Error('Invalid UI handle');
    const record = this.handles.get(Number(handle.handle));
    const value = record?.weak ? record.weak.deref() : record?.value;
    if (!record || value === undefined || kind && record.kind !== kind) throw Error(`Stale or mismatched UI ${kind ?? 'value'} handle`);
    return value;
  }
  pruneHandles() { for (const [id, record] of this.handles) if (record.weak && !record.weak.deref()) this.handles.delete(id); }
  validateBindings({props, onEvent = null, components = {}} = {}) {
    if (onEvent !== null && typeof onEvent !== 'function') throw Error('UI onEvent must be a function');
    if (!components || typeof components !== 'object' || Object.keys(components).length > 1000) throw Error('Invalid external component registry');
    return Object.freeze({props, onEvent, components: Object.freeze({...components})});
  }
  render(bindings = this.bindings) {
    const args = this.artifact.entryPropsType ? [this.values.decode(this.artifact.entryPropsType, bindings.props)] : [];
    return this.invoke(this.artifact.entry, args, {node: true, label: 'render', bindings});
  }
  updateProps(props, {onEvent = this.bindings.onEvent, components = this.bindings.components} = {}) {
    if (!this.root || this.disposed) throw Error('Mount a UI session before updating props');
    if (this.debugger.vm) throw Error('Finish or stop the paused event before updating props');
    if (this.artifact.entryPropsType) this.values.decode(this.artifact.entryPropsType, props);
    this.bindings = this.validateBindings({props, onEvent, components});
    this.root.render(this.ui.h(this.App)); return this;
  }
  release(scope) { for (const id of scope) this.handles.delete(id); }
  prepareVm(instance, args, {debug = false} = {}) {
    const vm = new MirVirtualMachine(debug ? this.artifact.mir ?? this.artifact.optimizedMir : this.artifact.optimizedMir, {entry: instance, args, maxSteps: this.artifact.maxSteps, maxTrace: this.maxTrace});
    this.attach(vm.runtime); return vm;
  }
  invoke(instance, args = [], {node = false, label = 'call', bindings = this.currentBindings ?? this.bindings} = {}) {
    if (this.disposed) throw Error('UI session is disposed');
    if (this.depth >= 64) throw Error('UI callback nesting budget exceeded');
    if (this.depth++ === 0) this.callBudget = 0;
    const previousBindings = this.currentBindings; this.currentBindings = bindings; this.labels.push(label);
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
      this.scopes.pop(); this.release(scope); this.depth--; this.calls++; this.labels.pop(); this.currentBindings = previousBindings;
      this.emit('callback', {instance, label, milliseconds: performance.now() - started, steps: vm?.runtime.steps ?? this.callBudget});
    }
  }
  closure(descriptor, environment, args = [], options = {}) {
    if (!descriptor || typeof descriptor.instance !== 'string') throw Error('Missing checked closure descriptor');
    // Fn uses a borrowed receiver to an owned environment retained by this JS closure.
    const reference = {__ref: true, cell: {value: environment}, path: []};
    return this.invoke(descriptor.instance, [reference, ...args], options);
  }
  event(descriptor, environment, args, event, bindings = this.currentBindings ?? this.bindings) {
    if (this.disposed) return;
    if (this.debugger.armed) {
      // Timer ticks are coalesced while paused; clicks and input preserve ordering.
      const label = event?.type ?? 'timer';
      const queued = label === 'timer' && this.debugger.queue.find(item => item.label === label && item.environment === environment);
      if (queued) { queued.args = args; return; }
      if (this.debugger.queue.length >= 100) { if (label === 'timer') return; throw Error('UI debugger event queue is full'); }
      this.debugger.queue.push({descriptor, environment, args, bindings, label});
      if (!this.debugger.vm && this.debugger.timer === null) this.startDebugEvent();
      else this.emit('debug-queued', this.inspectDebugger());
      return;
    }
    const previous = this.currentEvent; this.currentEvent = event;
    try { this.closure(descriptor, environment, args, {label: 'event', bindings}); }
    finally { this.currentEvent = previous; }
  }
  host(spec, args, runtime) {
    if (spec?.version !== 1 || !Array.isArray(spec.types) || typeof spec.name !== 'string') throw Error('Invalid UI ABI descriptor');
    const bindings = this.currentBindings ?? this.bindings;
    if (this.labels.includes('render') && ['set', 'set_string', 'set_bool', 'update', 'write', 'modify', 'emit', 'focus'].includes(spec.name)) throw Error('UI mutation during render is not supported');
    const u = this.ui, node = handle => this.resolve(handle, 'node'), create = vnode => this.allocate('node', vnode);
    const callback = (index, values = [], options) => this.closure(spec.callbacks?.[index], args[index], values, options);
    const text = value => String(value?.__ref ? runtime.read(value) : value ?? '');
    const state = (handle, kind) => {
      const result = this.resolve(handle, 'state'); if (result.kind !== kind) throw Error(`State requires ${kind}`);
      if (this.debugRunning && this.debugger.overlay) {
        const staged = this.debugger.overlay.get(Number(handle.handle));
        if (!staged || staged.cell !== result.cell) throw Error('State ownership changed during paused event');
        return {get value() { return staged.value; }, set(value) { staged.value = value; }};
      }
      return result.cell;
    };
    if (this.debugRunning && !['get', 'get_string', 'get_bool', 'read', 'set', 'set_string', 'set_bool', 'write', 'modify', 'update'].includes(spec.name)) {
      this.commitDebugState();
      this.debugger.vm.historyBarrier(`Host operation ui::${spec.name}`);
    }
    const newState = (kind, initial) => {
      const cell = u._useCell(initial, {kind: `rust-state:${kind}`});
      if (!cell.handle) { cell.handle = this.allocate('state', cell.retained = {kind, cell}, true); cell.dispose = () => this.handles.delete(Number(cell.handle.handle)); }
      return cell.handle;
    };
    switch (spec.name) {
      case 'emit': {
        const name = String(args[0]); if (!/^[a-zA-Z][\w:.-]{0,99}$/.test(name)) throw Error('Invalid emitted event name');
        if (!bindings.onEvent) throw Error('No UI onEvent receiver is connected');
        bindings.onEvent(name, this.values.encode(spec.valueType, args[1])); return null;
      }
      case 'external': {
        const name = String(args[0]), json = String(args[1]);
        if (!Object.hasOwn(bindings.components, name)) throw Error(`External UI component ${name} is not registered`);
        if (json.length > 1000000) throw Error('External UI props budget exceeded');
        const props = JSON.parse(json);
        if (!props || Array.isArray(props) || typeof props !== 'object') throw Error('External UI props must be an object');
        for (const key of Object.keys(props)) if (/^on/i.test(key) || ['__proto__', 'constructor', 'prototype', 'key', 'ref', 'children', '__source', 'dangerouslySetInnerHTML', 'innerHTML', 'outerHTML', 'srcdoc'].includes(key)) throw Error(`Unsafe external UI prop ${key}`);
        return create(u.h(bindings.components[name], props, ...args[2].map(node)));
      }
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
          component = function RustComponent(props) { return session.closure(descriptor, props.environment, [], {node: true, label: 'render', bindings: props.bindings}); };
          component.displayName = descriptor.type; this.components.set(descriptor.instance, component);
        }
        return create(u.h(component, {environment: args[0], bindings}));
      }
      case 'on_click': {
        const descriptor = spec.callbacks[1], environment = args[1];
        return create(u.cloneElement(node(args[0]), {onClick: event => this.event(descriptor, environment, [], event, bindings)}));
      }
      case 'on': case 'on_event': {
        const name = String(args[1]);
        if (!/^[a-z][a-z0-9]*(?::capture)?$/.test(name) || name.length > 80) throw Error('Invalid UI event name');
        const eventName = this.eventProp(name);
        const descriptor = spec.callbacks[2], environment = args[2];
        return create(u.cloneElement(node(args[0]), {[eventName]: event => this.event(descriptor, environment, [spec.name === 'on_event' ? this.snapshotEvent(event) : String(event.target?.value ?? event.key ?? '')], event, bindings)}));
      }
      case 'interval': {
        const milliseconds=Number(args[0]);
        if(!Number.isInteger(milliseconds)||milliseconds<0||milliseconds>2147483647)throw Error('Invalid UI interval');
        const latest=u.useRef(null);latest.current={descriptor:spec.callbacks[1],environment:args[1],bindings};
        u.useEffect(()=>{
          if(!milliseconds)return;
          let previous=performance.now(),timer=setInterval(()=>{
            const now=performance.now(),delta=Math.max(0,now-previous);previous=now;
            if(this.disposed)return;
            try{const current=latest.current;if(this.debugger.armed)this.event(current.descriptor,current.environment,[delta],null,current.bindings);else this.closure(current.descriptor,current.environment,[delta],{label:'timer',bindings:current.bindings});}
            catch(error){clearInterval(timer);this.emit('error',{message:error.message,code:error.code,span:error.span});this.onError?.(error);}
          },milliseconds);
          return ()=>clearInterval(timer);
        },[milliseconds]);return null;
      }
      case 'state_with': return {...newState(spec.stateType, () => this.values.clone(spec.stateType, callback(0))), marker: {}};
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
        u.useEffect(() => { this.closure(setup, args[0], [], {label: 'effect', bindings}); return () => this.closure(cleanup, args[1], [], {label: 'cleanup', bindings}); }, [deps]); return null;
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
        u.useEffect(() => { this.closure(setup, setupEnv, [], {label: 'effect', bindings}); return () => this.closure(cleanup, cleanupEnv, [], {label: 'cleanup', bindings}); }, [String(args[2])]); return null;
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
    const target=event.currentTarget,rect=target?.getBoundingClientRect?.();
    let offsetX=rect?number(event.clientX)-rect.left:number(event.offsetX),offsetY=rect?number(event.clientY)-rect.top:number(event.offsetY);
    if(target?.getScreenCTM&&typeof DOMPoint==='function'){
      try{const p=new DOMPoint(number(event.clientX),number(event.clientY)).matrixTransform(target.getScreenCTM().inverse());offsetX=p.x;offsetY=p.y;}catch{/* Detached or singular SVG: fall back to CSS coordinates. */}
    }else if(rect){if(rect.width&&target.offsetWidth)offsetX*=target.offsetWidth/rect.width;if(rect.height&&target.offsetHeight)offsetY*=target.offsetHeight/rect.height;}
    return {offset_x:offsetX,offset_y:offsetY,event_type: text(event.type), value: text(event.target?.value), key: text(event.key), code: text(event.code),
      checked: !!event.target?.checked, repeat: !!event.repeat, alt_key: !!event.altKey, ctrl_key: !!event.ctrlKey,
      meta_key: !!event.metaKey, shift_key: !!event.shiftKey, button: integer(event.button), buttons: integer(event.buttons, true),
      client_x: number(event.clientX), client_y: number(event.clientY), pointer_id: integer(event.pointerId), pressure: number(event.pressure),
      delta_x: number(event.deltaX), delta_y: number(event.deltaY), delta_z: number(event.deltaZ),
      input_type: text(event.inputType), data: text(event.data), time_stamp: number(event.timeStamp)};
  }
  mount(container, options = {}) {
    if (this.root || this.disposed) throw Error('A UI session mounts exactly once');
    const session = this;
    function RustApp() { return session.render(); }
    this.App = RustApp;
    RustApp.displayName = this.artifact.entry;
    this.root = this.ui.createRoot(container, {...options, throwErrors: true, onError: error => { this.emit('error', {message: error.message, code: error.code, span: error.span}); this.onError?.(error); }});
    this.root.subscribe(event => this.emit(event.type, event));
    try { this.root.render(this.ui.h(RustApp)); return this; }
    catch (error) { this.dispose(); throw error; }
  }
  setBreakpoints(breakpoints = []) {
    if (this.disposed) throw Error('UI session is disposed');
    if (!Array.isArray(breakpoints) || breakpoints.length > 1000 || breakpoints.some(p => !p || typeof p.file !== 'string' || !p.file.length || p.file.length > 4096 || !Number.isInteger(p.line) || p.line < 1)) throw Error('Invalid UI breakpoints');
    const seen = new Set();
    this.debugger.breakpoints = breakpoints.filter(p => { const key = `${p.file}:${p.line}`; if (seen.has(key)) return false; seen.add(key); return true; }).map(({file, line}) => ({file, line}));
    this.debugger.locations = new Set(this.debugger.breakpoints.map(p => `${p.file}:${p.line}`));
    if (!this.debugLines) {
      this.debugLines = new Set();
      for (const fn of this.artifact.mir ?? this.artifact.optimizedMir) for (const block of fn.blocks) for (const instruction of [...block.instructions, block.terminator]) { const span = instruction.span; if (span) this.debugLines.add(`${span.file}:${span.line}`); }
    }
    return this.inspectDebugger();
  }
  armDebugger({breakpoints = [], pauseOnEntry = true} = {}) {
    if (typeof pauseOnEntry !== 'boolean') throw Error('pauseOnEntry must be boolean');
    this.setBreakpoints(breakpoints);
    const debug = this.debugger;
    debug.armed = true; debug.pauseNext = pauseOnEntry;
    if (!debug.vm) { debug.status = 'waiting'; debug.reason = pauseOnEntry ? 'Waiting for the next event' : 'Waiting for a breakpoint'; }
    const result = this.inspectDebugger(); this.emit('debug-armed', result); return result;
  }
  startDebugEvent() {
    const debug = this.debugger;
    if (this.disposed || !debug.armed || debug.vm) return;
    const next = debug.queue.shift(); if (!next) return;
    debug.bindings = next.bindings; debug.label = next.label; debug.error = null;
    debug.overlay = new Map(); this.pruneHandles();
    for (const [handle, record] of this.handles) {
      const state = record.weak ? record.weak.deref() : record.value;
      if (record.kind === 'state' && state) debug.overlay.set(handle, {cell: state.cell, baseline: state.cell.value, value: state.cell.value, kind: state.kind});
    }
    this.callBudget = 0; debug.descriptor = next.descriptor; debug.scope = [];
    const ref = {__ref: true, cell: {value: next.environment}, path: []};
    debug.vm = this.prepareVm(next.descriptor.instance, [ref, ...next.args], {debug: true});
    // Functional state updaters run on the SAME MIR stack, never invisibly in JS/Wasm.
    debug.vm.interceptCall = (instruction, frame) => {
      const spec = instruction.format;
      if (instruction.name !== 'ferrite.ui.v1' || !['update', 'modify'].includes(spec?.name)) return null;
      const args = instruction.args.map(slot => frame.cells[slot].value), handle = Number(args[0].handle);
      const staged = debug.overlay.get(handle), kind = spec.name === 'update' ? 'i64' : spec.stateType;
      if (!staged || staged.kind !== kind || this.resolve(args[0], 'state').cell !== staged.cell) throw Error('State ownership changed during paused event');
      const value = spec.name === 'update' ? staged.value : this.values.clone(kind, staged.value);
      return {instance: spec.callbacks[1].instance, args: [{__ref: true, cell: {value: args[1]}, path: []}, value], continuation: {kind: 'ui-state', handle, stateType: kind, owned: spec.name === 'modify'}};
    };
    debug.vm.completeCall = (value, continuation) => {
      const staged = debug.overlay.get(continuation.handle);
      if (!staged) throw Error('Updater state is no longer live');
      staged.value = continuation.owned ? this.values.clone(continuation.stateType, value) : value;
      return null;
    };
    debug.vm.enableHistory({captureExternal: () => [...debug.overlay].map(([id, record]) => [id, record.value]),
      restoreExternal: values => { for (const [id, value] of values) debug.overlay.get(id).value = value; }});
    this.trace = []; debug.status = 'paused'; debug.reason = 'Event entry';
    if (debug.pauseNext) { debug.pauseNext = false; this.emit('debug-paused', this.inspectDebugger()); }
    else this.debug('continue', {skipFirst: false});
  }
  assertDebugState() {
    for (const [handle, staged] of this.debugger.overlay ?? []) {
      const record = this.resolve({handle: BigInt(handle)}, 'state');
      if (record.cell !== staged.cell || !Object.is(record.cell.value, staged.baseline)) throw Error('UI state changed outside the paused event; stop and retry');
    }
  }
  commitDebugState() {
    this.assertDebugState();
    for (const staged of this.debugger.overlay?.values() ?? []) {
      if (!Object.is(staged.value, staged.baseline)) staged.cell.set(staged.value);
      staged.baseline = staged.cell.value;
    }
  }
  cancelDebugTask() {
    const debug = this.debugger; clearTimeout(debug.timer); debug.timer = null; debug.epoch++; debug.task = null;
  }
  debug(command = 'continue', {skipFirst = true} = {}) {
    if (this.disposed) throw Error('UI session is disposed');
    const debug = this.debugger;
    if (command === 'stop') {
      this.cancelDebugTask();
      if (debug.scope) this.release(debug.scope);
      Object.assign(debug, {vm: null, scope: null, overlay: null, queue: [], armed: false, pauseNext: false, descriptor: null, error: null, status: 'disarmed', reason: 'Stopped; uncommitted state discarded'});
      this.trace = []; const result = this.inspectDebugger(); this.emit('debug-stopped', result); return result;
    }
    if (command === 'pause') {
      this.cancelDebugTask(); debug.armed = true; debug.pauseNext = !debug.vm;
      debug.status = debug.vm ? (debug.vm.done ? 'completed' : 'paused') : 'waiting'; debug.reason = debug.vm ? 'Pause requested' : 'Waiting for the next event';
      const result = this.inspectDebugger(); this.emit('debug-paused', result); return result;
    }
    if (!['step', 'step-line', 'step-over', 'step-out', 'back', 'back-line', 'restart', 'continue'].includes(command)) throw Error('Unknown UI debugger command');
    if (debug.status === 'running') throw Error('Pause the UI debugger before stepping or resuming');
    if (!debug.vm) {
      if (command === 'continue') { debug.pauseNext = false; if (debug.armed) debug.reason = 'Waiting for a breakpoint'; }
      return this.inspectDebugger();
    }
    if (debug.error && !['back', 'back-line', 'restart'].includes(command)) throw Error('Reverse the failed instruction, restart the event, or stop before continuing');
    const vm = debug.vm;
    if (['back', 'back-line', 'restart'].includes(command)) {
      this.assertDebugState();
      if (command === 'back') vm.stepBack();
      else if (command === 'back-line') vm.stepBackLine();
      else while (vm.historyInfo().available) vm.stepBack();
      debug.error = null; debug.status = vm.done ? 'completed' : 'paused'; debug.reason = 'Reversed'; this.trace = vm.trace.slice();
      const result = this.inspectDebugger(); this.emit('debug-paused', result); return result;
    }
    const frame = vm.frames.at(-1), span = vm.nextSpan();
    debug.task = {command, frame, span, steps: 0, skip: skipFirst, epoch: ++debug.epoch};
    debug.status = 'running'; debug.reason = 'Executing';
    return this.advanceDebugTask();
  }
  advanceDebugTask() {
    const debug = this.debugger, vm = debug.vm, task = debug.task;
    if (!vm || !task || task.epoch !== debug.epoch || this.disposed) return this.inspectDebugger();
    debug.timer = null;
    const previousBindings = this.currentBindings; this.currentBindings = debug.bindings;
    this.scopes.push(debug.scope); this.depth++; this.debugRunning = true;
    let committed = false, failure = null;
    try {
      this.assertDebugState();
      const started = performance.now(); let work = 0;
      while (!vm.done) {
        const span = vm.nextSpan(), frame = vm.frames.at(-1), sameLine = span?.file === task.span?.file && span?.line === task.span?.line;
        if (task.skip && (!sameLine || frame !== task.frame)) task.skip = false;
        if (!task.skip && (task.command === 'continue' || task.steps > 0) && span && debug.locations?.has(`${span.file}:${span.line}`)) { debug.reason = 'Breakpoint'; break; }
        if (task.steps > 0 && (task.command === 'step' || task.command === 'step-line' && (!sameLine || frame !== task.frame) || task.command === 'step-over' && (!vm.frames.includes(task.frame) || frame === task.frame && !sameLine) || task.command === 'step-out' && !vm.frames.includes(task.frame))) { debug.reason = 'Step'; break; }
        if (work >= 512 || work > 0 && performance.now() - started >= 8) break;
        vm.step({capture: false}); task.steps++; work++;
      }
      this.trace = vm.trace.slice();
      if (vm.done && task.command === 'continue') {
        this.commitDebugState(); committed = true; vm.historyBarrier('Committed DOM render and effects');
        this.release(debug.scope); debug.scope = null; debug.vm = null; debug.overlay = null;
        debug.status = 'waiting'; debug.reason = 'Callback committed; waiting for events'; this.calls++;
      } else if (vm.done) { debug.status = 'completed'; debug.reason = 'Callback finished; Continue commits staged state'; }
      else if (debug.reason !== 'Executing') debug.status = 'paused';
    } catch (error) {
      failure = error; debug.status = 'error'; debug.reason = error.message;
      debug.error = {message: error.message, code: error.code ?? 'R_UI_DEBUG', span: error.span ?? vm.runtime.span}; this.trace = vm.trace.slice();
    } finally { this.debugRunning = false; this.depth--; this.scopes.pop(); this.currentBindings = previousBindings; }
    if (debug.status === 'running') {
      const epoch = task.epoch;
      debug.timer = setTimeout(() => { if (epoch === debug.epoch) { try { this.advanceDebugTask(); } catch { /* debug-error already published */ } } }, 0);
    } else debug.task = null;
    // Clear the completed VM before rendering; observers must not see a phantom pause.
    if (committed) {
      try { this.ui.flushSync(); } catch (error) { failure = error; debug.status = 'error'; debug.reason = 'Render failed after state commit'; debug.error = {message: error.message, code: error.code ?? 'R_UI_RENDER', span: error.span}; }
    }
    const result = this.inspectDebugger();
    this.emit(failure ? 'debug-error' : committed ? 'debug-complete' : debug.status === 'running' ? 'debug-running' : 'debug-paused', result);
    if (committed && debug.queue.length) {
      const epoch = debug.epoch;
      debug.timer = setTimeout(() => { debug.timer = null; if (epoch === debug.epoch) { try { this.startDebugEvent(); } catch (error) { this.emit('error', {message: error.message, code: error.code, span: error.span}); } } }, 0);
    }
    if (failure) throw failure;
    return result;
  }
  inspectDebugger() {
    const debug = this.debugger;
    return {armed: debug.armed, status: debug.status, reason: debug.reason, error: debug.error, queued: debug.queue.length, callback: debug.descriptor, event: debug.label,
      state: debug.vm?.snapshot() ?? null, trace: this.trace.slice(-this.maxTrace), breakpoints: debug.breakpoints.map(p => ({...p})),
      breakpointBindings: debug.breakpoints.map(p => ({...p, verified: this.debugLines?.has(`${p.file}:${p.line}`) ?? false, message: this.debugLines?.has(`${p.file}:${p.line}`) ? 'Executable source line; pauses when reached in an event callback' : 'No executable instruction on this line'})),
      stagedStates: [...(debug.overlay ?? [])].map(([handle, record]) => ({handle, type: record.kind, value: this.values.schemas[record.kind] ? this.values.encode(record.kind, record.value) : this.ui._safeValue(record.value)})),
      boundary: 'Event/timer callbacks and nested state updaters execute on MIR for every backend. Back restores bounded Rust instructions and staged state. Continue commits the DOM. Rendering, effects and browser default actions are synchronous and are not source-steppable; irreversible host operations establish history boundaries.'};
  }
  inspect() {
    const states = [];
    this.pruneHandles();
    for (const [handle, entry] of this.handles) { const value = entry.weak ? entry.weak.deref() : entry.value;
      if (entry.kind === 'state' && value) states.push({handle, type: value.kind, value: this.values.schemas[value.kind] ? this.values.encode(value.kind, value.cell.value) : this.ui._safeValue(value.cell.value)});
    }
    return {format: 'ferrite-ui-inspection-v1', backend: this.backend, calls: this.calls, handles: this.handles.size, states,
      root: this.root?.inspect() ?? null, debugger: this.inspectDebugger()};
  }
  setState(handle, value) {
    if (this.debugger.vm) throw Error('Finish or stop the paused event before editing state');
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
