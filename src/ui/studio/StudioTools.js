import {Dom} from '../views/Dom.js';
import {exportNativeHTML, decodeNativeBase64} from '../../ui-framework/NativeWasm.js';
/** Session operations; the owning UIStudioSession supplies document-scoped state. */
export const StudioTools = {
  async debug(command, signal) {
    this.assertLive(); this.assertSourcePreview(); const result = await this.preview.request(`debug.${command}`, command === 'arm' ? {breakpoints: this.model.breakpointList} : {}, {signal});
    if (this.snapshot) this.snapshot.debugger = result; this.renderState(); return result;
  },
  renderState() {
    this.states.replaceChildren();
    for (const state of this.snapshot?.states ?? []) {
      const value = this.input(`State ${state.handle}`, !['i64', 'String', 'bool'].includes(state.type) ? JSON.stringify(state.value) : String(state.value));
      const row = Dom.element('div', 'studio-state'); row.append(this.field(`${state.type} · handle ${state.handle}`, value), this.button('Set', async () => {
        this.assertLive(); const next = state.type === 'bool' ? (() => { if (!['true', 'false'].includes(value.value)) throw Error('Boolean state must be true or false'); return value.value === 'true'; })() : !['i64', 'String'].includes(state.type) ? JSON.parse(value.value) : value.value;
        this.snapshot = await this.preview.request('state.set', {handle: state.handle, value: next}); this.renderState();
      })); this.states.append(row);
    }
    this.debugOutput.textContent = JSON.stringify({calls: this.snapshot?.calls, handles: this.snapshot?.handles, debugger: this.snapshot?.debugger}, null, 2)?.slice(0, 100000) ?? 'Preview an app to inspect its state.';
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
