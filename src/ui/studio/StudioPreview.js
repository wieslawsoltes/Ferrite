import {exportNativeHTML} from '../../ui-framework/NativeWasm.js';
/** Session operations; the owning UIStudioSession supplies document-scoped state. */
export const StudioPreview = {
  setPresentation(visible, mode) {
    const wasPreview = this.root.dataset.mode === 'preview';
    this.root.dataset.mode = mode;
    this.dock.setPresentation({visible, solo: mode === 'preview' ? 'canvas' : null});
    // Preview is an interacting application, not an invisible pick/move tool.
    if (visible && mode === 'preview' && !wasPreview && this.artifact && this.preview.ready)
      this.interact().catch(error => this.error(error));
  },
  async build({signal} = {}) {
    signal?.throwIfAborted();
    clearTimeout(this.buildTimer); this.nativeAsset = null; this.saveProject(); const source = this.model.files[this.entryFile]; if (typeof source !== 'string') throw Error('Open or create a UI view file');
    this.active?.abort(); this.active = new AbortController(); const combined = AbortSignal.any([this.active.signal, signal].filter(Boolean));
    const generation = ++this.generation, file = this.entryFile, channel = this.preview.reset();
    this.buildingGeneration = generation;
    try {
      this.layoutMode.value = 'off'; this.layoutMode.dataset.activeMode = 'off'; this.frame.style.pointerEvents = ''; this.layoutMode.removeAttribute('aria-busy'); this.picking = false; this.pickButton.setAttribute('aria-pressed', 'false'); this.artifact = null;
      this.status.textContent = 'Compiling typed Rust UI in a worker…'; this.status.dataset.kind = 'building';
      const {artifact, html} = await this.compiler.compile({...this.model.files}, 'ui-compile', {file, entry: this.entry, backend: this.backend, maxSteps: this.project?.settings.maxSteps ?? 250000, css: this.css.value, channel}, combined);
      combined.throwIfAborted(); if (generation !== this.generation || source !== this.model.files[file]) throw new DOMException('Stale UI build', 'AbortError');
      this.dependencies = {...artifact.files}; this.observedFiles = {...this.model.files};
      this.artifact = artifact; this.compiledSource = source; this.compiledFile = file; this.compiledGeneration = generation;
      this.snapshot = null; this.preview.load(html, channel); this.status.textContent = 'Loading isolated preview…'; this.renderOutline();
      return {file, entry: artifact.entry, backend: this.backend, nodes: artifact.nodes.length, revision: this.model.revision};
    } finally {
      // A cancelled predecessor must not clear a replacement build's scheduling ownership.
      if (this.buildingGeneration === generation) this.buildingGeneration = null;
    }
  },
  buildNative(bytes, {name = 'native-app.wasm', signal} = {}) {
    signal?.throwIfAborted();
    if (typeof name !== 'string' || name.length > 200 || !name.endsWith('.wasm') || /[/\\\0]/.test(name)) throw Error('Invalid native Wasm filename');
    // A loaded binary is never silently reinterpreted as editable browser-compiler source.
    const channel = this.preview.reset(), html = exportNativeHTML(bytes, {title: name, css: this.css.value, channel});
    this.active?.abort(); const generation = ++this.generation;
    this.nativeAsset = {bytes: bytes.slice(), name}; this.compiledGeneration = generation;
    this.artifact = {format: 'ferrite-native-ui-v1', nodes: []}; this.snapshot = null;
    this.selected = null; this.picking = false; this.layoutMode.value = 'off'; this.layoutMode.dataset.activeMode = 'off'; this.frame.style.pointerEvents = ''; this.layoutMode.removeAttribute('aria-busy'); this.pickButton.setAttribute('aria-pressed', 'false');
    this.outline.replaceChildren(); this.properties.replaceChildren();
    this.app.studio.showSession(this); this.preview.load(html, channel); this.renderState();
    this.status.dataset.kind = 'building'; this.status.textContent = 'Loading trusted rustc Wasm in an isolated origin…';
    return {backend: 'native-wasm', name, bytes: bytes.length, revision: this.model.revision, sourceEditing: false, mirDebugging: false};
  },
  assertSourcePreview() { if (this.nativeAsset) throw Error('Native Cargo binaries support live inspection and export. Source design and MIR stepping require a browser-compiler project.'); },
  assertLive() { if (!this.artifact || this.compiledGeneration !== this.generation || !this.nativeAsset && this.compiledSource !== this.model.files[this.entryFile]) throw Error('UI preview is stale; compile the current source first'); },
  async inspect(signal) { this.assertLive(); const snapshot = await this.preview.request('inspect', {}, {signal}); this.snapshot = snapshot; this.renderState(); return this.state(); },
  state() { return {file: this.file, entryFile: this.entryFile, stylesheet: this.project?.settings.stylesheet, entry: this.entry, revision: this.model.revision, selected: this.selected, backend: this.nativeAsset ? 'native-wasm' : this.backend, nativeArtifact: this.nativeAsset?.name, stale: !this.artifact, snapshot: this.snapshot, docking: this.dock?.snapshot()}; },
  event(message) {
    // A retained older preview cannot navigate or overwrite a newer source revision.
    if (!this.artifact || this.disposed) return;
    if ((this.root.hidden || this.dock?.visible === false) && ['select','layout'].includes(message.event)) return;
    if (message.event === 'error') { this.error(Object.assign(Error(message.error?.message ?? 'Preview error'), message.error)); return; }
    if (message.event === 'layout') { this.assertLive(); this.select(message.id); this.edit({op: 'setLayout', node: message.id, rectangle: message.rectangle, grid: 1, snap: false}).catch(error => this.error(error)); return; }
    if (message.event === 'select') { if (this.artifact) { this.select(message.id); this.dock?.open('properties'); } return; }
    if (message.event === 'ready' || message.event === 'snapshot') {
      this.snapshot = message.snapshot; this.renderState();
      if (message.event === 'ready' && this.armOnReady) { this.armOnReady=false; this.debug('arm').catch(error=>this.error(error)); }
      if (message.event === 'ready' && this.artifact) { this.status.dataset.kind = 'ready'; this.status.textContent = this.nativeAsset ? `Live native rustc Wasm · ${this.nativeAsset.name} · isolated origin · inspection/export only` : `Live ${this.backend} preview · ${this.artifact.nodes.length} source nodes · isolated origin`; }
    } else if (message.event.startsWith('debug-')) {
      if (this.snapshot) this.snapshot.debugger = message.detail;
      this.renderState(); const span = message.detail?.state?.next ?? message.detail?.state?.last?.span;
      if (!this.root.hidden && this.dock?.visible !== false && span?.file === this.file) this.app.selection.select(span, 'ui-studio', this.model.revision);
    }
  }
};
