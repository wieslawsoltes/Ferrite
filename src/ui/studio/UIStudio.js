import {Dom} from '../views/Dom.js';
import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {SourceDesigner} from '../../ui-framework/SourceDesigner.js';
import {UI_SAMPLES, UI_SAMPLE_CSS} from '../../ui-framework/Samples.js';
import {PreviewChannel} from './PreviewChannel.js';

/** IDE projection over real source files, bounded compilation and an isolated app. */
export class UIStudio {
  constructor(app) {
    this.app = app; this.model = app.model; this.root = app.panels.get('ui-studio'); this.root.classList.add('ui-studio');
    this.compiler = new BrowserCompiler(); this.file = 'src/app.ui.rs'; this.entry = 'app'; this.backend = 'javascript';
    this.selected = null; this.snapshot = null; this.artifact = null; this.generation = 0; this.compiledSource = null;
    this.view();
    this.preview = new PreviewChannel(this.frame, {onEvent: message => this.event(message)});
    this.unsubscribe = this.model.subscribe(event => this.changed(event));
    this.unselect = app.selection.subscribe(({span, origin}) => {
      if (origin === 'ui-studio' || !span || span.file !== this.file || !this.designer) return;
      const nodes = this.designer.nodes.filter(node => node.start <= span.start && node.end >= span.end);
      nodes.sort((a, b) => a.end - a.start - (b.end - b.start)); if (nodes[0]) this.select(nodes[0].id, false);
    });
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
    this.files = this.selectInput('UI source file', []); this.files.onchange = () => { this.file = this.files.value; this.selected = null; this.refreshSource(); };
    this.backendSelect = this.selectInput('UI backend', [['javascript', 'JavaScript'], ['wasm', 'WebAssembly'], ['mir', 'MIR / trace']]);
    this.backendSelect.onchange = () => { this.backend = this.backendSelect.value; this.markStale(); };
    this.entryInput = this.input('UI entry function', 'app'); this.entryInput.onchange = () => { this.entry = this.entryInput.value; this.refreshSource(); };
    controls.append(this.files, this.backendSelect, this.entryInput, this.button('Preview', () => this.build(), 'run'), this.button('Export HTML', () => this.download(), 'export'));
    const samples = Dom.element('div', 'studio-toolbar'); samples.append(Dom.element('span', '', 'New example:'));
    for (const name of Object.keys(UI_SAMPLES)) samples.append(this.button(name, () => this.createExample(name), 'plus'));
    this.status = Dom.element('div', 'studio-status', 'Create an example or choose a Rust UI source file.'); this.status.setAttribute('role', 'status');
    const workspace = Dom.element('div', 'studio-workspace');
    const previewArea = Dom.element('div', 'studio-preview-area');
    const previewBar = Dom.element('div', 'studio-toolbar');
    this.pickButton = this.button('Pick element', () => this.pick(), 'fit');
    this.viewport = this.selectInput('Preview width', [['100%', 'Responsive'], ['375px', 'Phone · 375'], ['768px', 'Tablet · 768'], ['1280px', 'Desktop · 1280']]);
    this.viewport.onchange = () => { this.frame.style.width = this.viewport.value; };
    previewBar.append(this.pickButton, this.viewport, this.button('Inspect', () => this.inspect(), 'tree'));
    const canvas = Dom.element('div', 'studio-canvas'); this.frame = Dom.element('iframe', 'studio-preview'); this.frame.title = 'Sandboxed Rust UI preview'; canvas.append(this.frame);
    previewArea.append(previewBar, canvas);
    const inspector = Dom.element('div', 'studio-inspector');
    this.outline = Dom.element('div', 'studio-outline'); this.outline.setAttribute('role', 'tree'); this.outline.setAttribute('aria-label', 'UI source outline');
    this.properties = Dom.element('div', 'studio-properties'); inspector.append(this.outline, this.properties); workspace.append(previewArea, inspector);
    const sourceDetails = Dom.element('details', 'studio-details'); sourceDetails.append(Dom.element('summary', '', 'Rust source · synchronized with the editor'));
    this.source = Dom.element('textarea', 'studio-source'); this.source.setAttribute('aria-label', 'UI Rust source'); this.source.spellcheck = false;
    this.source.oninput = () => { if (Object.hasOwn(this.model.files, this.file)) this.model.update(this.file, this.source.value); }; sourceDetails.append(this.source);
    const stylesDetails = Dom.element('details', 'studio-details'); stylesDetails.append(Dom.element('summary', '', 'Application CSS'));
    this.css = Dom.element('textarea', 'studio-source'); this.css.setAttribute('aria-label', 'UI application CSS'); this.css.value = UI_SAMPLE_CSS; this.css.oninput = () => this.markStale(); stylesDetails.append(this.css);
    const debugDetails = Dom.element('details', 'studio-details'); debugDetails.open = true; debugDetails.append(Dom.element('summary', '', 'Live state / event debugger'));
    const debugBar = Dom.element('div', 'studio-toolbar');
    for (const [label, command, icon] of [['Arm events', 'arm', 'debug'], ['Instruction', 'step', 'step'], ['Source line', 'step-line', 'line'], ['Continue', 'continue', 'run'], ['Disarm', 'stop', 'stop']])
      debugBar.append(this.button(label, () => this.debug(command), icon));
    this.states = Dom.element('div', 'studio-states'); this.debugOutput = Dom.element('pre', 'studio-debug');
    debugDetails.append(debugBar, this.states, this.debugOutput);
    this.root.append(header, controls, samples, this.status, workspace, sourceDetails, stylesDetails, debugDetails);
  }
  refreshFiles() {
    const before = this.file; this.files.replaceChildren();
    for (const path of Object.keys(this.model.files).filter(path => path.endsWith('.rs'))) { const option = Dom.element('option', '', path); option.value = path; this.files.append(option); }
    this.files.value = before;
  }
  refreshSource({preserve = false} = {}) {
    const source = this.model.files[this.file]; this.source.disabled = typeof source !== 'string';
    if (this.source.value !== (source ?? '')) this.source.value = source ?? '';
    if (source === this.designer?.source && preserve) return;
    this.markStale();
    try {
      this.designer = typeof source === 'string' ? new SourceDesigner(source, {file: this.file, entry: this.entry, revision: this.model.revision, validate: false}) : null;
      if (!this.designer?.index.has(this.selected)) this.selected = this.designer?.nodes.find(node => node.kind === 'element')?.id ?? null;
      this.renderOutline(); this.renderProperties();
    } catch (error) { this.designer = null; this.outline.replaceChildren(); this.properties.replaceChildren(); this.error(error); }
  }
  changed(event) {
    if (['files', 'replace'].includes(event.kind)) this.refreshFiles();
    if (['edit', 'files', 'replace'].includes(event.kind)) this.refreshSource({preserve: true});
  }
  markStale() {
    this.generation++; this.active?.abort(); this.artifact = null; this.snapshot = null; this.renderState();
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
    this.file = file; this.entry = 'app'; this.entryInput.value = 'app'; this.model.create(file, UI_SAMPLES[name]);
    this.refreshFiles(); this.refreshSource(); return this.build();
  }
  async build({signal} = {}) {
    const source = this.model.files[this.file]; if (typeof source !== 'string') throw Error('Create an example or select an existing UI source');
    this.active?.abort(); this.active = new AbortController(); const combined = AbortSignal.any([this.active.signal, signal].filter(Boolean));
    const generation = ++this.generation, file = this.file, channel = this.preview.reset();
    this.picking = false; this.pickButton.setAttribute('aria-pressed', 'false'); this.artifact = null;
    this.status.textContent = 'Compiling typed Rust UI in a worker…'; this.status.dataset.kind = 'building';
    const {artifact, html} = await this.compiler.compile({[file]: source}, 'ui-compile', {file, entry: this.entry, backend: this.backend, css: this.css.value, channel}, combined);
    combined.throwIfAborted(); if (generation !== this.generation || source !== this.model.files[file]) throw new DOMException('Stale UI build', 'AbortError');
    this.artifact = artifact; this.compiledSource = source; this.compiledFile = file; this.compiledGeneration = generation;
    this.snapshot = null; this.preview.load(html, channel); this.status.textContent = 'Loading isolated preview…'; this.renderOutline();
    return {file, entry: artifact.entry, backend: this.backend, nodes: artifact.nodes.length, revision: this.model.revision};
  }
  assertLive() { if (!this.artifact || this.compiledGeneration !== this.generation || this.compiledSource !== this.model.files[this.file]) throw Error('UI preview is stale; compile the current source first'); }
  async inspect(signal) { this.assertLive(); const snapshot = await this.preview.request('inspect', {}, {signal}); this.snapshot = snapshot; this.renderState(); return this.state(); }
  state() { return {file: this.file, entry: this.entry, revision: this.model.revision, selected: this.selected, backend: this.backend, stale: !this.artifact, snapshot: this.snapshot}; }
  event(message) {
    // A retained older preview cannot navigate or overwrite a newer source revision.
    if (!this.artifact) return;
    if (message.event === 'error') { this.error(Object.assign(Error(message.error?.message ?? 'Preview error'), message.error)); return; }
    if (message.event === 'select') { if (this.artifact) this.select(message.id); return; }
    if (message.event === 'ready' || message.event === 'snapshot') {
      this.snapshot = message.snapshot; this.renderState();
      if (message.event === 'ready' && this.artifact) { this.status.dataset.kind = 'ready'; this.status.textContent = `Live ${this.backend} preview · ${this.artifact.nodes.length} source nodes · isolated origin`; }
    } else if (message.event.startsWith('debug-')) {
      if (this.snapshot) this.snapshot.debugger = message.detail;
      this.renderState(); const span = message.detail?.state?.next ?? message.detail?.state?.last?.span;
      if (span?.file === this.file) this.app.selection.select(span, 'ui-studio', this.model.revision);
    }
  }
  select(id, reveal = true) {
    const node = this.designer?.index.get(id); if (!node) throw Error('Selected source node no longer exists');
    // Editor selection can echo the canvas/outline selection asynchronously.
    // Replacing the same inspector would discard an in-progress attribute edit.
    // Source changes rebuild properties through refreshSource instead.
    if (this.selected !== id) {
      this.selected = id; this.renderOutline(); this.renderProperties();
    }
    if (reveal) { this.model.open(this.file); this.app.selection.select(node.span, 'ui-studio', this.model.revision); }
    return {id, span: node.span};
  }
  async pick() {
    this.assertLive(); this.picking = !this.picking; await this.preview.request('pick', {value: this.picking});
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
    const palette = this.selectInput('Insert element', [['<div></div>', 'Container'], ['<h2>Heading</h2>', 'Heading'], ['<p>Text</p>', 'Paragraph'], ['<button>Button</button>', 'Button'], ['<input placeholder="Type here" />', 'Input'], ['<label>Label</label>', 'Label'], ['<ul><li>Item</li></ul>', 'List']]);
    this.properties.append(palette, this.button('Insert child', () => this.edit({op: 'insert', node: node.id, markup: palette.value}), 'plus'));
  }
  async edit(operation, {signal} = {}) {
    if (!this.designer) throw Error('Fix UI syntax before visual editing');
    const file = this.file, source = this.model.read(file), revision = this.model.revision;
    const result = await this.compiler.compile({[file]: source}, 'ui-design', {file, entry: this.entry, operation, revision}, signal);
    signal?.throwIfAborted(); if (this.model.revision !== revision || this.model.read(file) !== source) throw Error('Editor changed while validating the visual edit; no source was overwritten');
    this.model.applyTransaction({[file]: result.source}); this.model.save();
    this.refreshSource({preserve: true}); return this.build({signal});
  }
  async debug(command, signal) {
    this.assertLive(); const result = await this.preview.request(`debug.${command}`, command === 'arm' ? {breakpoints: this.model.breakpointList.filter(point => point.file === this.file)} : {}, {signal});
    if (this.snapshot) this.snapshot.debugger = result; this.renderState(); return result;
  }
  renderState() {
    this.states.replaceChildren();
    for (const state of this.snapshot?.states ?? []) {
      const value = this.input(`State ${state.handle}`, String(state.value));
      const row = Dom.element('div', 'studio-state'); row.append(this.field(`${state.type} · handle ${state.handle}`, value), this.button('Set', async () => {
        this.assertLive(); const next = state.type === 'bool' ? (() => { if (!['true', 'false'].includes(value.value)) throw Error('Boolean state must be true or false'); return value.value === 'true'; })() : value.value;
        this.snapshot = await this.preview.request('state.set', {handle: state.handle, value: next}); this.renderState();
      })); this.states.append(row);
    }
    this.debugOutput.textContent = JSON.stringify({calls: this.snapshot?.calls, handles: this.snapshot?.handles, debugger: this.snapshot?.debugger}, null, 2)?.slice(0, 100000) ?? 'Preview an app to inspect its state.';
  }
  async download() {
    const file = this.file, source = this.model.read(file);
    const {html} = await this.compiler.compile({[file]: source}, 'ui-export', {file, entry: this.entry, backend: this.backend, css: this.css.value});
    const url = URL.createObjectURL(new Blob([html], {type: 'text/html;charset=utf-8'})); const link = document.createElement('a');
    link.href = url; link.download = file.split('/').pop().replace(/\.rs$/, '.html'); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    return {characters: html.length, backend: this.backend};
  }
  async command(command, args = {}, {signal} = {}) {
    if (args.expectedRevision !== undefined && args.expectedRevision !== this.model.revision) throw Error('Stale IDE revision');
    if (command === 'ui.inspect') return this.inspect(signal);
    if (command === 'ui.preview') {
      if (args.file !== undefined) { this.model.read(args.file); this.file = args.file; }
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
