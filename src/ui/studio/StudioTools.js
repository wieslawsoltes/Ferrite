import {Dom} from '../views/Dom.js';
import {exportNativeHTML, decodeNativeBase64} from '../../ui-framework/NativeWasm.js';
/** Session operations; the owning UIStudioSession supplies document-scoped state. */
export const StudioTools = {
  async debug(command, signal) {
    this.assertLive(); this.assertSourcePreview();
    if (this.debugPending && !['stop','pause'].includes(command)) return this.debugPending;
    this.debugRequest?.abort(); this.debugRequest = new AbortController();
    const combined = AbortSignal.any([this.debugRequest.signal, signal].filter(Boolean));
    const generation = this.generation, channel = this.preview.channel;
    const current = () => !combined.aborted && !this.disposed && generation === this.generation && channel === this.preview.channel;
    const operation = (async () => {
      if (command === 'arm') await this.interact();
      combined.throwIfAborted();
      if (!current()) throw new DOMException('Stale debugger command', 'AbortError');
      if (!['arm','stop','pause'].includes(command)) await this.preview.request('debug.breakpoints', {breakpoints: this.model.breakpointList}, {signal: combined});
      const result = await this.preview.request(`debug.${command}`, command === 'arm' ? {breakpoints: this.model.breakpointList, pauseOnEntry: this.model.breakpointList.length === 0} : {}, {signal: combined});
      if (current()) { if (this.snapshot) this.snapshot.debugger = result; this.renderState(); if (command === 'arm') this.syncBreakpoints?.(); }
      return result;
    })();
    this.debugPending = operation;
    try { return await operation; } finally { if (this.debugPending === operation) this.debugPending = null; }
  },
  syncBreakpoints() {
    if (!this.artifact || !this.preview.ready || !this.snapshot?.debugger?.armed) return;
    const generation = this.generation;
    this.preview.request('debug.breakpoints', {breakpoints: this.model.breakpointList}).then(result => {
      if (!this.disposed && generation === this.generation && this.snapshot?.debugger) { this.snapshot.debugger.breakpoints = result.breakpoints; this.snapshot.debugger.breakpointBindings = result.breakpointBindings; this.renderState(); }
    }).catch(error => { if (generation === this.generation) this.error(error); });
  },
  stopDebugging() {
    this.debugRequest?.abort();
    if (this.preview.ready && !this.nativeAsset) {
      const generation = this.generation;
      this.preview.request('debug.stop').then(result => { if (!this.disposed && generation === this.generation && this.snapshot) { this.snapshot.debugger = result; this.renderState(); } }).catch(() => {});
    }
  },
  revealDebugSpan(span) {
    if (!span || this.disposed || this.root.hidden || this.app.studio?.current && this.app.studio.current !== this) return;
    if (this.app.studio && Object.hasOwn(this.model.files, span.file)) {
      this.app.studio.revealSource(this, () => { this.file = span.file; this.model.open(span.file); this.model.setDocumentState(span.file, {mode: 'split'}); });
      this.refreshFiles(); this.refreshSource({preserve: true, invalidate: false});
    }
    this.app.selection.select(span, 'ui-studio', this.model.revision);
  },
  renderState() {
    this.states.replaceChildren();
    for (const state of this.snapshot?.states ?? []) {
      const value = this.input(`State ${state.handle}`, !['i64', 'String', 'bool'].includes(state.type) ? JSON.stringify(state.value) : String(state.value));
      const row = Dom.element('div', 'studio-state'); row.append(this.field(`${state.type} · handle ${state.handle}`, value), this.button('Set', async () => {
        this.assertLive(); if (this.snapshot?.debugger?.state) throw Error('Continue or stop the paused event before editing state'); const next = state.type === 'bool' ? (() => { if (!['true', 'false'].includes(value.value)) throw Error('Boolean state must be true or false'); return value.value === 'true'; })() : !['i64', 'String'].includes(state.type) ? JSON.parse(value.value) : value.value;
        this.snapshot = await this.preview.request('state.set', {handle: state.handle, value: next}); this.renderState();
      })); this.states.append(row);
    }
    this.debugView?.renderUI(this.snapshot?.debugger, {live: !!this.artifact && this.preview?.ready && !this.nativeAsset});
    if (this.app.studio?.current === this) this.app.debugger?.renderUI(this.snapshot?.debugger, {live: !!this.artifact && this.preview?.ready && !this.nativeAsset});
  },
  async download({hydrate = false} = {}) {
    let file, html, backend = this.backend;
    if (this.nativeAsset) {
      this.assertLive(); if (hydrate) throw Error('Native Cargo exports mount Wasm; native server hydration is not implemented');
      file = this.nativeAsset.name; backend = 'native-wasm'; html = exportNativeHTML(this.nativeAsset.bytes, {title: file, css: this.css.value});
    } else {
      this.saveProject(); file = this.entryFile;
      ({html} = await this.compiler.compile({...this.model.files}, hydrate ? 'ui-render' : 'ui-export', {file, entry: this.entry, backend: this.backend, maxSteps: this.project?.settings.maxSteps ?? 250000, css: this.css.value}));
    }
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'})); const link = document.createElement('a');
    link.href = url; link.download = file.split('/').pop().replace(/\.(?:rs|wasm)$/, '.html'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {characters: html.length, backend};
  },
  async command(command, args = {}, {signal} = {}) {
    if (args.expectedRevision !== undefined && args.expectedRevision !== this.model.revision) throw Error('Stale IDE revision');
    if (command === 'ui.native.preview') return this.buildNative(decodeNativeBase64(args.wasm), {name: args.name, signal});
    if (command === 'ui.inspect') return this.inspect(signal);
    if (command === 'ui.preview') {
      if (args.file !== undefined) { this.model.read(args.file); this.loadProject(args.file); }
      if (args.entry !== undefined) this.entry = args.entry;
      if (args.backend !== undefined) { if (!['javascript', 'wasm', 'mir'].includes(args.backend)) throw Error('Unknown UI backend'); this.backend = args.backend; }
      this.backendSelect.value = this.backend; this.entryInput.value = this.entry; this.refreshFiles(); this.refreshSource(); this.app.studio.showSession(this); return this.build({signal});
    }
    this.assertLive();
    if (command === 'ui.select') return this.select(args.node);
    if (command === 'ui.debug') return this.debug(args.action, signal);
    if (command === 'ui.state.set') { const value = await this.preview.request('state.set', {handle: args.handle, value: args.value}, {signal}); this.snapshot = value; this.renderState(); return value; }
    throw Error('Unknown UI Studio command');
  }
};
