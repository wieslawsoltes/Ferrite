import {createUIRuntime, UI} from './Runtime.js';
import {scriptJSON} from './Export.js';

/** Dependency-free host factory; serialized verbatim in native single-file exports. */
export function createNativeWasmHost(runtime, {onError = null, maxBytes = 8 * 1024 * 1024, maxMemoryBytes = 64 * 1024 * 1024} = {}) {
  if (!runtime?.createRoot || !runtime?.h) throw Error('A Ferrite DOM runtime is required');
  if (onError !== null && typeof onError !== 'function') throw Error('onError must be callable');
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 8 || maxBytes > 8 * 1024 * 1024 || !Number.isSafeInteger(maxMemoryBytes) || maxMemoryBytes < 65536 || maxMemoryBytes > 64 * 1024 * 1024) throw Error('Invalid native UI limits');
  const decoder = new TextDecoder('utf-8', {fatal: true}), encoder = new TextEncoder();
  const textFields = ['type', 'value', 'key', 'code', 'inputType', 'data'];
  const numberFields = ['checked', 'repeat', 'altKey', 'ctrlKey', 'metaKey', 'shiftKey', 'button', 'buttons', 'pointerId', 'clientX', 'clientY', 'pressure', 'deltaX', 'deltaY', 'deltaZ', 'timeStamp'];
  const required = ['ferrite_ui_abi', 'ferrite_start', 'ferrite_render', 'ferrite_commit', 'ferrite_dispatch', 'ferrite_dispose'];
  let instance = null, root = null, phase = 'new', disposed = false, poisoned = false, queued = false, dirty = false, currentEvent = null, output = null, stats = {}, calls = 0;
  const refs = new Map(), listeners = new Set();
  const notify = event => { for (const listener of listeners) { try { listener(event); } catch { /* Read-only observers. */ } } };
  function validate(input) {
    if (!(input instanceof Uint8Array) || input.length < 8 || input.length > maxBytes) throw Error('Native UI requires bounded Wasm bytes');
    const bytes = input.slice();
    if ([0,97,115,109,1,0,0,0].some((v,i) => bytes[i] !== v)) throw Error('Invalid Wasm header');
    let offset = 8, memory = false;
    function uint(end = bytes.length) {
      let value = 0;
      for (let n = 0; n < 5; n++) {
        if (offset >= end) throw Error('Truncated Wasm integer');
        const byte = bytes[offset++];
        if (n === 4 && byte > 15) throw Error('Invalid Wasm u32');
        value += (byte & 127) * 2 ** (7 * n); if (!(byte & 128)) return value;
      }
      throw Error('Invalid Wasm integer');
    }
    while (offset < bytes.length) {
      const section = bytes[offset++], length = uint(), end = offset + length;
      if (end > bytes.length) throw Error('Truncated Wasm section');
      if (section === 5) {
        if (memory || uint(end) !== 1 || uint(end) !== 1) throw Error('Native UI requires one unshared memory32 with a declared maximum');
        const initial = uint(end), maximum = uint(end);
        if (initial > maximum || maximum * 65536 > maxMemoryBytes || offset !== end) throw Error('Native Wasm memory limit exceeded');
        memory = true;
      }
      if (section === 8) throw Error('Native UI uses explicit startup, not a Wasm start section');
      offset = end;
    }
    if (!memory) throw Error('Missing bounded native Wasm memory');
    return bytes;
  }
  function range(pointer, length) {
    const buffer = instance?.exports.memory?.buffer;
    // Wasm i32 pointers are bit patterns, not signed JS addresses.
    pointer >>>= 0; length >>>= 0;
    if (!buffer || buffer.byteLength > maxMemoryBytes || length > 4 * 1024 * 1024 || pointer > buffer.byteLength || length > buffer.byteLength - pointer) throw Error('Native ABI memory range rejected');
    return new Uint8Array(buffer, pointer, length);
  }
  function eventText(field, reference) {
    if (field === 100) { const node = refs.get(reference)?.current; if (!node) throw Error('Stale native DOM ref'); return String(node.value ?? ''); }
    if (!currentEvent || !textFields[field]) throw Error('Native event read outside dispatch');
    return String(field === 1 ? currentEvent.target?.value ?? '' : currentEvent[textFields[field]] ?? '');
  }
  function schedule() {
    if (disposed || poisoned) return;
    dirty = true; if (phase !== 'idle' || queued) return;
    queued = true; queueMicrotask(() => { queued = false; if (!disposed && !poisoned) { try { flush(); } catch (error) { report(error); } } });
  }
  function report(error) { poisoned = true; notify({type: 'error', message: error.message}); onError?.(error); }
  function invoke(name, ...args) { if (disposed || poisoned) throw Error('Native UI session is disposed or faulted'); calls++; return instance.exports[name](...args); }
  function decodeNode(node, budget, seenRefs, depth = 0) {
    if (!node || typeof node !== 'object' || Array.isArray(node) || ++budget.count > 10000 || depth > 128) throw Error('Invalid native view tree');
    const key = node.key;
    if (key !== null && key !== undefined && typeof key !== 'string') throw Error('Invalid native node key');
    if (Object.hasOwn(node, 'text')) {
      if (typeof node.text !== 'string') throw Error('Invalid native text');
      return runtime.h(runtime.Fragment, {key}, node.text);
    }
    if (!Array.isArray(node.children)) throw Error('Missing native children');
    const children = node.children.map(child => decodeNode(child, budget, seenRefs, depth + 1));
    if (!Object.hasOwn(node, 'tag')) return runtime.h(runtime.Fragment, {key}, ...children);
    if (typeof node.tag !== 'string' || !/^[A-Za-z][\w:-]*$/.test(node.tag) || !node.props || Array.isArray(node.props) || typeof node.props !== 'object' || !Array.isArray(node.events)) throw Error('Invalid native element');
    const props = Object.create(null);
    for (const [name, value] of Object.entries(node.props)) {
      if (/^on/i.test(name) || ['children','ref','key','innerHTML','outerHTML','dangerouslySetInnerHTML','__proto__','constructor','prototype'].includes(name) || !['string','boolean'].includes(typeof value)) throw Error('Invalid native DOM property');
      props[name] = value;
    }
    props.key = key;
    for (const event of node.events) {
      if (!Array.isArray(event) || event.length !== 2 || !/^[a-z][a-z0-9]*$/.test(event[0]) || !Number.isInteger(event[1]) || event[1] < 1 || event[1] > 0xffffffff) throw Error('Invalid native event binding');
      const [name, id] = event; if (Object.hasOwn(props, `on:${name}`)) throw Error('Duplicate native event');
      props[`on:${name}`] = e => dispatch(id, e);
    }
    if (node.ref) {
      if (!Number.isInteger(node.ref) || node.ref < 1 || node.ref > 0xffffffff || seenRefs.has(node.ref)) throw Error('Invalid or duplicated native DOM ref');
      seenRefs.add(node.ref); if (!refs.has(node.ref)) refs.set(node.ref, {current: null}); props.ref = refs.get(node.ref);
    }
    return runtime.h(node.tag, props, ...children);
  }
  function dispatch(id, event) {
    if (disposed || poisoned) return;
    if (phase !== 'idle') throw Error('Reentrant native DOM dispatch');
    currentEvent = event; phase = 'event';
    try { invoke('ferrite_dispatch', id); }
    catch (error) { report(error); throw error; }
    finally { currentEvent = null; phase = 'idle'; }
    if (dirty) schedule();
  }
  function flush() {
    if (disposed || poisoned) throw Error('Native UI session is disposed or faulted');
    if (phase !== 'idle') throw Error('Cannot flush during native execution');
    try {
      for (let turn = 0; dirty; turn++) {
        if (turn >= 25) throw Error('Native effect/render loop exceeded 25 commits');
        dirty = false; output = null; phase = 'render'; invoke('ferrite_render');
        if (!output || output.abi !== 1 || !Number.isInteger(output.components) || !Number.isInteger(output.hooks)) throw Error('Native render did not emit a valid view');
        const seenRefs = new Set(), tree = decodeNode(output.tree, {count: 0}, seenRefs);
        phase = 'dom'; root.render(tree);
        for (const id of refs.keys()) if (!seenRefs.has(id)) refs.delete(id);
        phase = 'commit'; invoke('ferrite_commit'); stats = {components: output.components, hooks: output.hooks};
        notify({type: 'commit', snapshot: inspect()}); phase = 'idle';
      }
      return inspect();
    } catch (error) { report(error); throw error; }
    finally { phase = 'idle'; }
  }
  function inspect() { return {format: 'ferrite-native-ui-inspection-v1', backend: 'native-wasm', calls, ...stats, memoryBytes: instance?.exports.memory.buffer.byteLength ?? 0, disposed, faulted: poisoned, root: root?.inspect() ?? null, states: [], debugger: {supported: false, boundary: 'Actual rustc Wasm: use browser Wasm debugging. Ferrite MIR reverse stepping does not apply.'}}; }
  function dispose() {
    if (disposed) return;
    disposed = true; dirty = false;
    try { instance?.exports.ferrite_dispose(); } catch (error) { onError?.(error); }
    finally { root?.unmount(); refs.clear(); listeners.clear(); instance = null; }
  }
  const api = {validate, flush, inspect, dispose, subscribe(listener) { if (typeof listener !== 'function') throw Error('Invalid listener'); listeners.add(listener); return () => listeners.delete(listener); },
    async mount(input, container) {
      if (phase !== 'new' || disposed) throw Error('Native UI hosts mount exactly once');
      phase = 'loading';
      try {
        const bytes = validate(input), module = await WebAssembly.compile(bytes);
        const imports = {view_emit(pointer, length) {
          if (phase !== 'render' || output !== null) throw Error('Native views emit exactly once during render');
          output = JSON.parse(decoder.decode(range(pointer, length)));
        }, view_invalidate: schedule, event_text(field, reference, pointer, capacity) {
          const bytes = encoder.encode(eventText(field, reference)); if (bytes.length > 1024 * 1024) throw Error('Native event text budget exceeded');
          if (capacity) { if ((capacity >>> 0) !== bytes.length) throw Error('Native event buffer size mismatch'); range(pointer, capacity).set(bytes); } return bytes.length;
        }, event_number(field) {
          if (!currentEvent || !numberFields[field]) throw Error('Native event read outside dispatch');
          const value = field === 0 ? currentEvent.target?.checked : currentEvent[numberFields[field]];
          return Number.isFinite(Number(value)) ? Number(value) : 0;
        }, dom_operation(operation, reference) {
          if (operation === 2) { const node = refs.get(reference)?.current; if (!node || phase === 'render') throw Error('Invalid native focus'); node.focus(); }
          else { if (!currentEvent) throw Error('DOM event control outside synchronous dispatch'); if (operation === 0) currentEvent.preventDefault(); else if (operation === 1) currentEvent.stopPropagation(); else throw Error('Unknown native DOM operation'); }
        }};
        for (const value of WebAssembly.Module.imports(module)) if (value.kind !== 'function' || value.module !== 'ferrite_native_ui_v1' || !Object.hasOwn(imports, value.name)) throw Error('Unapproved native Wasm import');
        if (disposed) throw Error('Native mounting was cancelled');
        instance = await WebAssembly.instantiate(module, {ferrite_native_ui_v1: imports});
        if (disposed) { instance = null; throw Error('Native mounting was cancelled'); }
        if (!(instance.exports.memory instanceof WebAssembly.Memory) || required.some(name => typeof instance.exports[name] !== 'function') || instance.exports.ferrite_ui_abi() !== 1) throw Error('Unsupported native UI ABI');
        root = runtime.createRoot(container, {throwErrors: true}); invoke('ferrite_start'); phase = 'idle'; dirty = true; flush(); return api;
      } catch (error) { dispose(); throw error; }
    }
  };
  return api;
}
export function mountNativeUI(bytes, container, options = {}) { return createNativeWasmHost(options.runtime ?? UI, options).mount(bytes, container); }
export function exportNativeHTML(bytes, {title = 'Native Rust UI', css = '', channel = null} = {}) {
  if (typeof title !== 'string' || title.length > 1000 || typeof css !== 'string' || css.length > 500000 || channel !== null && !/^[a-f0-9]{32,128}$/.test(channel)) throw Error('Invalid native UI export options');
  bytes = createNativeWasmHost(UI).validate(bytes);
  let binary = ''; for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  const data = btoa(binary), safeTitle = title.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const script = `const createUIRuntime=${createUIRuntime.toString()};const createNativeWasmHost=${createNativeWasmHost.toString()};
const channel=${scriptJSON(channel)};const send=value=>{if(channel)parent.postMessage({type:'ferrite-ui',channel,...value},'*');};
const style=document.createElement('style');style.textContent=${scriptJSON(css)};document.head.append(style);
const host=createNativeWasmHost(createUIRuntime(),{onError:error=>send({event:'error',error:{message:error.message}})});
host.subscribe(event=>{if(event.type==='commit')send({event:'snapshot',snapshot:host.inspect()});});
window.addEventListener('message',event=>{const m=event.data;if(!channel||event.source!==parent||m?.type!=='ferrite-ui-command'||m.channel!==channel||typeof m.id!=='string'||m.id.length>100)return;
try{if(m.command!=='inspect')throw Error('Native Wasm previews expose inspection only; source design and MIR stepping require a browser-compiler project');send({reply:m.id,result:host.inspect()});}catch(e){send({reply:m.id,error:{message:e.message}});}});
Object.defineProperty(window,'ferriteUI',{value:host});window.addEventListener('pagehide',()=>host.dispose(),{once:true});
host.mount(Uint8Array.from(atob(${scriptJSON(data)}),c=>c.charCodeAt(0)),document.getElementById('app')).then(()=>send({event:'ready',snapshot:host.inspect()})).catch(error=>{const p=document.createElement('pre');p.textContent=error.message;document.body.append(p);send({event:'error',error:{message:error.message}});});`;
  if (/<\/script/i.test(script)) throw Error('Unexpected script terminator');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'wasm-unsafe-eval'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'"><title>${safeTitle}</title></head><body><main id="app"></main><script>${script}</script></body></html>`;
}

/** Strict binary transport; no URL fetch or implicit execution. */
export function decodeNativeBase64(value) {
  if (typeof value !== 'string' || !value.length || value.length > 11184812 || value.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) throw Error('Invalid bounded native Wasm base64');
  const binary = atob(value);
  if (btoa(binary) !== value) throw Error('Noncanonical native Wasm base64');
  return createNativeWasmHost(UI).validate(Uint8Array.from(binary, c => c.charCodeAt(0)));
}
