import {Dom} from '../views/Dom.js';
import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {UIProject} from '../../ui-framework/UIProject.js';
import {SourceDesigner} from '../../ui-framework/SourceDesigner.js';
import {UI_SAMPLES, UI_SAMPLE_CSS} from '../../ui-framework/Samples.js';
import {exportNativeHTML, decodeNativeBase64} from '../../ui-framework/NativeWasm.js';
import {PreviewChannel} from './PreviewChannel.js';

/** IDE projection over real source files, bounded compilation and an isolated app. */
export class UIStudio {
  constructor(app) {
    this.app = app; this.model = app.model; this.root = app.panels.get('ui-studio'); this.root.classList.add('ui-studio');
    this.compiler = new BrowserCompiler(); this.file = 'src/app.ui.rs'; this.entryFile = this.file; this.project = null; this.savingProject = false; this.entry = 'app'; this.backend = 'javascript';
    this.nativeAsset = null; this.selected = null; this.snapshot = null; this.artifact = null; this.generation = 0; this.compiledSource = null;
    this.view();
    this.preview = new PreviewChannel(this.frame, {onEvent: message => this.event(message)});
    this.unsubscribe = this.model.subscribe(event => this.changed(event));
    this.unselect = app.selection.subscribe(({span, origin}) => {
      if (origin === 'ui-studio' || !span || span.file !== this.file || !this.designer) return;
      const nodes = this.designer.nodes.filter(node => node.start <= span.start && node.end >= span.end);
      nodes.sort((a, b) => a.end - a.start - (b.end - b.start)); if (nodes[0] && nodes[0].id !== this.selected) this.select(nodes[0].id, false);
    });
    const stored = Object.keys(this.model.files).find(file => file.endsWith('.rs') && Object.hasOwn(this.model.files, UIProject.manifestPath(file)));
    if (stored) this.loadProject(stored);
    this.refreshFiles(); this.refreshSource();
  }
  button(label, action, icon) {
    return Dom.button(label, () => { Promise.resolve().then(action).catch(error => this.error(error)); }, {icon, className: 'studio-button'});
  }
  field(label, node) { const field = Dom.element('label', 'studio-field'); field.append(Dom.element('span', '', label), node); return field; }
  input(label, value = '') { const node = Dom.element('input'); node.setAttribute('aria-label', label); node.value = value; return node; }
  selectInput(label, values) {
    const node = Dom.element('select'); node.setAttribute('aria-label', label);
    for (const [value, title] of values) { const option = Dom.element('option', '', title); option.value = value; node.append(option); }
    return node;
  }
  view() {
    const header = Dom.element('div', 'studio-header'); header.append(Dom.element('strong', '', 'RUST UI STUDIO'), Dom.element('span', 'studio-badge', 'SOURCE ↔ DESIGN'));
    const controls = Dom.element('div', 'studio-toolbar');
    this.files = this.selectInput('UI source file', []); this.files.onchange = () => { this.file = this.files.value; this.model.open(this.file); this.selected = null; this.refreshSource({invalidate: false}); };
    this.entryFiles = this.selectInput('UI project entry file', []); this.entryFiles.onchange = () => { try { this.loadProject(this.entryFiles.value); this.refreshFiles(); this.refreshSource(); } catch (error) { this.error(error); } };
    this.backendSelect = this.selectInput('UI backend', [['javascript', 'JavaScript'], ['wasm', 'WebAssembly'], ['mir', 'MIR / trace']]);
    this.backendSelect.onchange = () => { this.backend = this.backendSelect.value; this.saveProject(); this.markStale(); };
    this.entryInput = this.input('UI entry function', 'app'); this.entryInput.onchange = () => { this.entry = this.entryInput.value; this.saveProject(); this.refreshSource(); };
    controls.append(this.entryFiles, this.files, this.backendSelect, this.entryInput, this.button('Preview', () => this.build(), 'run'), this.button('Export HTML', () => this.download(), 'export'), this.button('Export hydrated HTML', () => this.download({hydrate: true}), 'export'));
    this.nativeInput = Dom.element('input'); this.nativeInput.type = 'file'; this.nativeInput.accept = '.wasm,application/wasm'; this.nativeInput.hidden = true;
    this.nativeInput.setAttribute('aria-label', 'Load trusted Cargo UI Wasm');
    this.nativeInput.onchange = () => {
      const file = this.nativeInput.files?.[0]; this.nativeInput.value = '';
      if (!file) return;
      if (file.size > 8 * 1024 * 1024) { this.error(Error('Native UI binaries are limited to 8 MiB')); return; }
      const generation = this.generation;
      file.arrayBuffer().then(buffer => {
        if (generation !== this.generation) throw Error('Editor changed while loading the native binary');
        return this.buildNative(new Uint8Array(buffer), {name: file.name});
      }).catch(error => this.error(error));
    };
    controls.append(this.button('Load Cargo Wasm', () => this.nativeInput.click(), 'run'), this.nativeInput);
    const samples = Dom.element('div', 'studio-toolbar'); samples.append(Dom.element('span', '', 'New example:'));
    for (const name of Object.keys(UI_SAMPLES)) samples.append(this.button(name, () => this.createExample(name), 'plus'));
    this.status = Dom.element('div', 'studio-status', 'Create an example or choose a Rust UI source file.'); this.status.setAttribute('role', 'status');
    const workspace = Dom.element('div', 'studio-workspace');
    const previewArea = Dom.element('div', 'studio-preview-area');
    const previewBar = Dom.element('div', 'studio-toolbar');
    this.pickButton = this.button('Pick element', () => this.pick(), 'fit');
    this.viewport = this.selectInput('Preview width', [['100%', 'Responsive'], ['375px', 'Phone · 375'], ['768px', 'Tablet · 768'], ['1280px', 'Desktop · 1280']]);
    this.viewport.onchange = () => { this.frame.style.width = this.viewport.value; this.saveProject(); };
    this.layoutMode = this.selectInput('Canvas editing', [['off', 'Run application'], ['move', 'Move element'], ['resize', 'Resize element']]);
    this.layoutMode.onchange = () => { try { this.assertLive(); this.preview.request('layout', {mode: this.layoutMode.value, grid: this.project?.settings.grid ?? 8, snap: this.project?.settings.snap ?? true}).catch(error => this.error(error)); } catch (error) { this.error(error); } };
    previewBar.append(this.pickButton, this.layoutMode, this.viewport, this.button('Inspect', () => this.inspect(), 'tree'));
    const canvas = Dom.element('div', 'studio-canvas'); this.frame = Dom.element('iframe', 'studio-preview'); this.frame.title = 'Sandboxed Rust UI preview'; canvas.append(this.frame);
    previewArea.append(previewBar, canvas);
    const inspector = Dom.element('div', 'studio-inspector');
    this.outline = Dom.element('div', 'studio-outline'); this.outline.setAttribute('role', 'tree'); this.outline.setAttribute('aria-label', 'UI source outline');
    this.properties = Dom.element('div', 'studio-properties'); inspector.append(this.outline, this.properties); workspace.append(previewArea, inspector);
    const sourceDetails = Dom.element('details', 'studio-details'); sourceDetails.append(Dom.element('summary', '', 'Rust source · synchronized with the editor'));
    this.source = Dom.element('textarea', 'studio-source'); this.source.setAttribute('aria-label', 'UI Rust source'); this.source.spellcheck = false;
    this.source.oninput = () => { if (Object.hasOwn(this.model.files, this.file)) this.model.update(this.file, this.source.value); }; sourceDetails.append(this.source);
    const stylesDetails = Dom.element('details', 'studio-details'); stylesDetails.append(Dom.element('summary', '', 'Application CSS'));
    this.css = Dom.element('textarea', 'studio-source'); this.css.setAttribute('aria-label', 'UI application CSS'); this.css.value = UI_SAMPLE_CSS; this.css.oninput = () => { this.saveProject(); this.markStale(); }; stylesDetails.append(this.css);
    const debugDetails = Dom.element('details', 'studio-details'); debugDetails.open = true; debugDetails.append(Dom.element('summary', '', 'Live state / event debugger'));
    const debugBar = Dom.element('div', 'studio-toolbar');
    for (const [label, command, icon] of [['Arm events', 'arm', 'debug'], ['Instruction', 'step', 'step'], ['Source line', 'step-line', 'line'], ['Back instruction', 'back', 'step'], ['Back line', 'back-line', 'line'], ['Restart event', 'restart', 'debug'], ['Continue', 'continue', 'run'], ['Disarm', 'stop', 'stop']])
      debugBar.append(this.button(label, () => this.debug(command), icon));
    this.states = Dom.element('div', 'studio-states'); this.debugOutput = Dom.element('pre', 'studio-debug');
    debugDetails.append(debugBar, this.states, this.debugOutput);
    this.root.append(header, controls, samples, this.status, workspace, sourceDetails, stylesDetails, debugDetails);
  }
  refreshFiles() {
    const before = this.file; this.files.replaceChildren(); this.entryFiles.replaceChildren();
    for (const path of Object.keys(this.model.files).filter(path => path.endsWith('.rs'))) { const option = Dom.element('option', '', path); option.value = path; this.files.append(option); this.entryFiles.append(option.cloneNode(true)); }
    this.files.value = before; this.entryFiles.value = this.entryFile;
  }
  refreshSource({preserve = false, invalidate = true} = {}) {
    const source = this.model.files[this.file]; this.source.disabled = typeof source !== 'string';
    if (this.source.value !== (source ?? '')) this.source.value = source ?? '';
    if (source === this.designer?.source && preserve) return;
    if (invalidate) this.markStale();
    try {
      this.designer = typeof source === 'string' ? new SourceDesigner(source, {file: this.file, entry: this.entry, revision: this.model.revision, validate: false, files: this.model.files, entryFile: this.entryFile}) : null;
      if (!this.designer?.index.has(this.selected)) this.selected = this.designer?.nodes.find(node => node.kind === 'element')?.id ?? null;
      this.renderOutline(); this.renderProperties();
    } catch (error) { this.designer = null; this.outline.replaceChildren(); this.properties.replaceChildren(); this.error(error); }
  }
  loadProject(file) {
    this.project = UIProject.load(this.model.files, file, {css: UI_SAMPLE_CSS}); this.entryFile = file; this.file = file;
    const settings = this.project.settings; this.entry = settings.entry; this.backend = settings.backend;
    this.entryInput.value = this.entry; this.backendSelect.value = this.backend; this.css.value = this.project.css;
    this.viewport.value = settings.viewport; this.frame.style.width = settings.viewport;
  }
  saveProject() {
    if (!Object.hasOwn(this.model.files, this.entryFile) || this.savingProject) return;
    try {
      const project = UIProject.load(this.model.files, this.entryFile, {css: this.css.value});
      const changes = project.changes({entry: this.entry, backend: this.backend, viewport: this.viewport.value}, this.css.value);
      this.savingProject = true; this.model.applyWorkspaceTransaction(changes); this.model.save();
      this.project = UIProject.load(this.model.files, this.entryFile);
    } catch (error) { this.error(error); } finally { this.savingProject = false; }
  }
  changed(event) {
    if (['files', 'replace'].includes(event.kind)) this.refreshFiles();
    if (!['edit', 'files', 'replace'].includes(event.kind)) return;
    this.markStale();
    if (!this.savingProject && this.project && Object.hasOwn(this.model.files, this.entryFile)) {
      try {
        const project = UIProject.load(this.model.files, this.entryFile, {css: this.css.value});
        this.project = project; this.css.value = project.css;
        this.entry = project.settings.entry; this.backend = project.settings.backend;
        this.entryInput.value = this.entry; this.backendSelect.value = this.backend;
        this.viewport.value = project.settings.viewport; this.frame.style.width = project.settings.viewport;
      } catch (error) { this.error(error); }
    }
    this.refreshSource({preserve: true, invalidate: false});
  }
  markStale() {
    this.generation++; this.active?.abort(); this.nativeAsset = null; this.artifact = null; this.snapshot = null; this.renderState();
    this.status.textContent = 'Source changed · Preview to compile. The previous preview is read-only to tooling.'; this.status.dataset.kind = 'stale';
  }
  error(error) {
    if (error.name === 'AbortError') return;
    this.status.dataset.kind = 'error'; this.status.textContent = `${error.code ? error.code + ': ' : ''}${error.message}`;
    if (error.span?.file === this.file) this.app.selection.select(error.span, 'ui-studio', this.model.revision);
  }
  async createExample(name) {
    if (!Object.hasOwn(UI_SAMPLES, name)) throw Error('Unknown UI example');
    let file = `src/${name}.ui.rs`, n = 1; while (Object.hasOwn(this.model.files, file)) file = `src/${name}-${++n}.ui.rs`;
    this.file = this.entryFile = file; this.entry = 'app'; this.entryInput.value = 'app'; this.model.create(file, UI_SAMPLES[name]);
    this.loadProject(file); this.saveProject();
    this.refreshFiles(); this.refreshSource(); return this.build();
  }
  async build({signal} = {}) {
    this.nativeAsset = null; this.saveProject(); const source = this.model.files[this.entryFile]; if (typeof source !== 'string') throw Error('Create an example or select an existing UI source');
    this.active?.abort(); this.active = new AbortController(); const combined = AbortSignal.any([this.active.signal, signal].filter(Boolean));
    const generation = ++this.generation, file = this.entryFile, channel = this.preview.reset();
    this.layoutMode.value = 'off'; this.picking = false; this.pickButton.setAttribute('aria-pressed', 'false'); this.artifact = null;
    this.status.textContent = 'Compiling typed Rust UI in a worker…'; this.status.dataset.kind = 'building';
    const {artifact, html} = await this.compiler.compile({...this.model.files}, 'ui-compile', {file, entry: this.entry, backend: this.backend, css: this.css.value, channel}, combined);
    combined.throwIfAborted(); if (generation !== this.generation || source !== this.model.files[file]) throw new DOMException('Stale UI build', 'AbortError');
    this.artifact = artifact; this.compiledSource = source; this.compiledFile = file; this.compiledGeneration = generation;
    this.snapshot = null; this.preview.load(html, channel); this.status.textContent = 'Loading isolated preview…'; this.renderOutline();
    return {file, entry: artifact.entry, backend: this.backend, nodes: artifact.nodes.length, revision: this.model.revision};
  }
  buildNative(bytes, {name = 'native-app.wasm', signal} = {}) {
    signal?.throwIfAborted();
    if (typeof name !== 'string' || name.length > 200 || !name.endsWith('.wasm') || /[/\\\0]/.test(name)) throw Error('Invalid native Wasm filename');
    // A loaded binary is never silently reinterpreted as editable browser-compiler source.
    const channel = this.preview.reset(), html = exportNativeHTML(bytes, {title: name, css: this.css.value, channel});
    this.active?.abort(); const generation = ++this.generation;
    this.nativeAsset = {bytes: bytes.slice(), name}; this.compiledGeneration = generation;
    this.artifact = {format: 'ferrite-native-ui-v1', nodes: []}; this.snapshot = null;
    this.selected = null; this.picking = false; this.layoutMode.value = 'off'; this.pickButton.setAttribute('aria-pressed', 'false');
    this.outline.replaceChildren(); this.properties.replaceChildren();
    this.app.dock.open('ui-studio'); this.preview.load(html, channel); this.renderState();
    this.status.dataset.kind = 'building'; this.status.textContent = 'Loading trusted rustc Wasm in an isolated origin…';
    return {backend: 'native-wasm', name, bytes: bytes.length, revision: this.model.revision, sourceEditing: false, mirDebugging: false};
  }
  assertSourcePreview() { if (this.nativeAsset) throw Error('Native Cargo binaries support live inspection and export. Source design and MIR stepping require a browser-compiler project.'); }
  assertLive() { if (!this.artifact || this.compiledGeneration !== this.generation || !this.nativeAsset && this.compiledSource !== this.model.files[this.entryFile]) throw Error('UI preview is stale; compile the current source first'); }
  async inspect(signal) { this.assertLive(); const snapshot = await this.preview.request('inspect', {}, {signal}); this.snapshot = snapshot; this.renderState(); return this.state(); }
  state() { return {file: this.file, entryFile: this.entryFile, stylesheet: this.project?.settings.stylesheet, entry: this.entry, revision: this.model.revision, selected: this.selected, backend: this.nativeAsset ? 'native-wasm' : this.backend, nativeArtifact: this.nativeAsset?.name, stale: !this.artifact, snapshot: this.snapshot}; }
  event(message) {
    // A retained older preview cannot navigate or overwrite a newer source revision.
    if (!this.artifact) return;
    if (message.event === 'error') { this.error(Object.assign(Error(message.error?.message ?? 'Preview error'), message.error)); return; }
    if (message.event === 'layout') { this.assertLive(); this.select(message.id); this.edit({op: 'setLayout', node: message.id, rectangle: message.rectangle, grid: 1, snap: false}).catch(error => this.error(error)); return; }
    if (message.event === 'select') { if (this.artifact) this.select(message.id); return; }
    if (message.event === 'ready' || message.event === 'snapshot') {
      this.snapshot = message.snapshot; this.renderState();
      if (message.event === 'ready' && this.artifact) { this.status.dataset.kind = 'ready'; this.status.textContent = this.nativeAsset ? `Live native rustc Wasm · ${this.nativeAsset.name} · isolated origin · inspection/export only` : `Live ${this.backend} preview · ${this.artifact.nodes.length} source nodes · isolated origin`; }
    } else if (message.event.startsWith('debug-')) {
      if (this.snapshot) this.snapshot.debugger = message.detail;
      this.renderState(); const span = message.detail?.state?.next ?? message.detail?.state?.last?.span;
      if (span?.file === this.file) this.app.selection.select(span, 'ui-studio', this.model.revision);
    }
  }
  select(id, reveal = true) {
    this.assertSourcePreview();
    const target = this.artifact?.nodes.find(node => node.id === id);
    if (target?.span.file && target.span.file !== this.file) { this.file = target.span.file; this.refreshFiles(); this.refreshSource({invalidate: false}); }
    const node = this.designer?.index.get(id); if (!node) throw Error('Selected source node no longer exists');
    this.selected = id; this.renderOutline(); this.renderProperties();
    if (reveal) { this.model.open(this.file); this.app.selection.select(node.span, 'ui-studio', this.model.revision); }
    return {id, span: node.span};
  }
  async pick() {
    this.assertLive(); this.assertSourcePreview(); this.picking = !this.picking; await this.preview.request('pick', {value: this.picking});
    this.pickButton.setAttribute('aria-pressed', String(this.picking));
  }
  renderOutline() {
    this.outline.replaceChildren(); if (!this.designer) return;
    const render = (node, depth = 0) => {
      const row = this.button(node.kind === 'element' ? `<${node.tag ?? 'Fragment'}>` : node.kind === 'text' ? node.value.slice(0, 35) : '{ Rust expression }', () => this.select(node.id));
      row.dataset.sourceNode = node.id; row.setAttribute('role', 'treeitem'); row.setAttribute('aria-level', String(depth + 1)); row.setAttribute('aria-selected', String(node.id === this.selected));
      row.style.paddingLeft = `${8 + depth * 12}px`; row.draggable = !!this.designer.parents.get(node.id);
      row.ondragstart = event => { event.dataTransfer.setData('application/x-ferrite-ui-node', JSON.stringify({id: node.id, revision: this.model.revision})); };
      row.ondragover = event => { if (node.kind === 'element' && event.dataTransfer.types.includes('application/x-ferrite-ui-node')) event.preventDefault(); };
      row.ondrop = event => { event.preventDefault(); try { const value = JSON.parse(event.dataTransfer.getData('application/x-ferrite-ui-node')); if (value.revision !== this.model.revision) throw Error('Drag source is stale'); this.edit({op: 'move', node: value.id, parent: node.id}).catch(error => this.error(error)); } catch (error) { this.error(error); } };
      this.outline.append(row); for (const child of node.children ?? []) render(child, depth + 1);
    };
    for (const node of this.designer.nodes.filter(node => !this.designer.parents.has(node.id))) render(node);
  }
  renderProperties() {
    this.properties.replaceChildren(); const node = this.designer?.index.get(this.selected); if (!node) return;
    this.properties.append(Dom.element('strong', '', `${node.kind} · line ${node.span.line}`));
    const actions = Dom.element('div', 'studio-toolbar');
    if (this.designer.parents.has(node.id)) actions.append(this.button('Duplicate', () => this.edit({op: 'duplicate', node: node.id})), this.button('Delete', () => this.edit({op: 'remove', node: node.id}), 'trash'));
    actions.append(this.button('Undo edit', async () => { if (this.model.undoTransaction()) { this.model.save(); await this.build(); } })); this.properties.append(actions);
    if (node.kind !== 'element') {
      const value = this.input('Selected text', node.kind === 'text' ? node.value : '');
      this.properties.append(this.field('Literal text', value), this.button('Set text', () => this.edit({op: 'setText', node: node.id, value: value.value}))); return;
    }
    if (node.tag) {
      const tag = this.input('Element tag', node.tag); this.properties.append(this.field('Tag', tag), this.button('Change tag', () => this.edit({op: 'setTag', node: node.id, value: tag.value})));
      for (const attribute of node.attributes) {
        const value = this.input(`Attribute ${attribute.name}`, attribute.kind === 'boolean' ? 'true' : attribute.value);
        const row = Dom.element('div', 'studio-property'); row.append(this.field(`${attribute.name} · ${attribute.kind}`, value),
          this.button('Apply', () => this.edit({op: 'setAttribute', node: node.id, name: attribute.name, kind: attribute.kind, value: value.value})),
          this.button('Remove', () => this.edit({op: 'removeAttribute', node: node.id, name: attribute.name}))); this.properties.append(row);
      }
      const name = this.input('New attribute name', 'className'), value = this.input('New attribute value');
      const kind = this.selectInput('New attribute kind', [['string', 'String'], ['expression', 'Rust expression'], ['boolean', 'Boolean']]);
      this.properties.append(this.field('New attribute', name), value, kind, this.button('Add attribute', () => this.edit({op: 'setAttribute', node: node.id, name: name.value, value: value.value, kind: kind.value})));
    }
    if (node.tag && !/^[A-Z]/.test(node.tag) && !node.tag.includes('::')) {
      const geometry = Object.fromEntries(['x', 'y', 'width', 'height'].map(name => [name, this.input(`Canvas ${name}`, ['width', 'height'].includes(name) ? '120' : '0')]));
      for (const [name, input] of Object.entries(geometry)) { input.type = 'number'; this.properties.append(this.field(name, input)); }
      this.properties.append(this.button('Set canvas rectangle', () => this.edit({op: 'setLayout', node: node.id,
        rectangle: Object.fromEntries(Object.entries(geometry).map(([key, input]) => [key, Number(input.value)])), grid: this.project?.settings.grid ?? 8, snap: this.project?.settings.snap ?? true})));
    }
    const palette = this.selectInput('Insert element', [['<div></div>', 'Container'], ['<h2>Heading</h2>', 'Heading'], ['<p>Text</p>', 'Paragraph'], ['<button>Button</button>', 'Button'], ['<input placeholder="Type here" />', 'Input'], ['<label>Label</label>', 'Label'], ['<ul><li>Item</li></ul>', 'List']]);
    this.properties.append(palette, this.button('Insert child', () => this.edit({op: 'insert', node: node.id, markup: palette.value}), 'plus'));
  }
  async edit(operation, {signal} = {}) {
    this.assertSourcePreview();
    if (!this.designer) throw Error('Fix UI syntax before visual editing');
    const file = this.file, source = this.model.read(file), revision = this.model.revision;
    const result = await this.compiler.compile({...this.model.files}, 'ui-design', {file, entryFile: this.entryFile, entry: this.entry, operation, revision}, signal);
    signal?.throwIfAborted(); if (this.model.revision !== revision || this.model.read(file) !== source) throw Error('Editor changed while validating the visual edit; no source was overwritten');
    this.model.applyTransaction({[file]: result.source}); this.model.save();
    this.refreshSource({preserve: true}); return this.build({signal});
  }
  async debug(command, signal) {
    this.assertLive(); this.assertSourcePreview(); const result = await this.preview.request(`debug.${command}`, command === 'arm' ? {breakpoints: this.model.breakpointList} : {}, {signal});
    if (this.snapshot) this.snapshot.debugger = result; this.renderState(); return result;
  }
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
  }
  async download({hydrate = false} = {}) {
    let file, html, backend = this.backend;
    if (this.nativeAsset) {
      this.assertLive(); if (hydrate) throw Error('Native Cargo exports mount Wasm; native server hydration is not implemented');
      file = this.nativeAsset.name; backend = 'native-wasm'; html = exportNativeHTML(this.nativeAsset.bytes, {title: file, css: this.css.value});
    } else {
      this.saveProject(); file = this.entryFile;
      ({html} = await this.compiler.compile({...this.model.files}, hydrate ? 'ui-render' : 'ui-export', {file, entry: this.entry, backend: this.backend, css: this.css.value}));
    }
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'})); const link = document.createElement('a');
    link.href = url; link.download = file.split('/').pop().replace(/\.(?:rs|wasm)$/, '.html'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {characters: html.length, backend};
  }
  async command(command, args = {}, {signal} = {}) {
    if (args.expectedRevision !== undefined && args.expectedRevision !== this.model.revision) throw Error('Stale IDE revision');
    if (command === 'ui.native.preview') return this.buildNative(decodeNativeBase64(args.wasm), {name: args.name, signal});
    if (command === 'ui.inspect') return this.inspect(signal);
    if (command === 'ui.preview') {
      if (args.file !== undefined) { this.model.read(args.file); this.loadProject(args.file); }
      if (args.entry !== undefined) this.entry = args.entry;
      if (args.backend !== undefined) { if (!['javascript', 'wasm', 'mir'].includes(args.backend)) throw Error('Unknown UI backend'); this.backend = args.backend; }
      this.backendSelect.value = this.backend; this.entryInput.value = this.entry; this.refreshFiles(); this.refreshSource(); this.app.dock.open('ui-studio'); return this.build({signal});
    }
    this.assertLive();
    if (command === 'ui.select') return this.select(args.node);
    if (command === 'ui.debug') return this.debug(args.action, signal);
    if (command === 'ui.state.set') { const value = await this.preview.request('state.set', {handle: args.handle, value: args.value}, {signal}); this.snapshot = value; this.renderState(); return value; }
    throw Error('Unknown UI Studio command');
  }
  dispose() { this.active?.abort(); this.unsubscribe(); this.unselect(); this.preview.dispose(); void this.compiler.close(); }
}
