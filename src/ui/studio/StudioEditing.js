import {renderDesignerOutline} from './DesignerOutline.js';
import {renderDesignerProperties} from './DesignerProperties.js';
import {captureDesignerSelection, restoreDesignerSelection} from './DesignerSelection.js';
/** Session operations; the owning UIStudioSession supplies document-scoped state. */
export const StudioEditing = {
  select(id, reveal = true) {
    if (this.nativeAsset) throw Error('Native binaries have no browser-compiler source node identities');
    const target = this.artifact?.nodes.find(node => node.id === id);
    if (target?.span.file && target.span.file !== this.file) { this.file = target.span.file; this.refreshFiles(); this.refreshSource({invalidate: false}); }
    const node = this.designer?.index.get(id); if (!node) throw Error('Selected source node no longer exists');
    // Editor selection can echo the canvas/outline selection asynchronously.
    // Replacing the same inspector would discard an in-progress attribute edit.
    // Source changes rebuild properties through refreshSource instead.
    if (this.selected !== id) {
      this.selected = id; this.renderOutline(); this.renderProperties();
    }
    if (reveal) this.app.studio.revealSource(this, () => { this.model.open(this.file); this.app.selection.select(node.span, 'ui-studio', this.model.revision); });
    return {id, span: node.span};
  },
  async configureLayout() {
    this.assertLive(); this.assertSourcePreview();
    this.interactionEpoch = (this.interactionEpoch ?? 0) + 1;
    const generation = this.generation, epoch = this.layoutEpoch = (this.layoutEpoch ?? 0) + 1;
    const mode = this.layoutMode.value;
    this.layoutMode.setAttribute('aria-busy', 'true'); this.frame.style.pointerEvents = 'none';
    try {
      const result = await this.preview.request('layout', {mode, grid: this.project?.settings.grid ?? 8, snap: this.project?.settings.snap ?? true});
      if (epoch !== this.layoutEpoch || generation !== this.generation) return;
      if (result?.mode !== mode) throw Error('Preview did not acknowledge the requested canvas mode');
      await this.preview.request('pick', {value: false});
      if (epoch !== this.layoutEpoch || generation !== this.generation) return;
      this.picking = false; this.pickButton.setAttribute('aria-pressed', 'false');
      this.layoutMode.dataset.activeMode = mode;
      this.layoutMode.removeAttribute('aria-busy'); this.frame.style.pointerEvents = '';
      return result;
    } catch (error) {
      // Old replies must not re-enable a newer preview or overwrite its status.
      if (epoch !== this.layoutEpoch || generation !== this.generation) return;
      this.layoutMode.removeAttribute('aria-busy');
      this.layoutMode.dataset.activeMode = 'unknown';
      // An uncertain mode must not turn a design gesture into an application click.
      // Another explicit mode selection or a new preview restores interaction.
      throw error;
    }
  },
  async pick() {
    this.assertLive(); this.assertSourcePreview();
    const generation = this.generation, picking = !this.picking;
    this.layoutMode.value = 'off'; const operation = this.configureLayout(), epoch = this.interactionEpoch;
    await operation;
    if (epoch !== this.interactionEpoch || generation !== this.generation) return;
    await this.preview.request('pick', {value: picking});
    if (epoch !== this.interactionEpoch || generation !== this.generation) return;
    this.picking = picking; this.pickButton.setAttribute('aria-pressed', String(picking));
  },
  async interact() {
    this.assertLive();
    if (this.nativeAsset) return; // Native apps already interact; no source picking protocol.
    const generation = this.generation;
    this.layoutMode.value = 'off'; const operation = this.configureLayout(), epoch = this.interactionEpoch;
    await operation;
    if (epoch !== this.interactionEpoch || generation !== this.generation) return;
    await this.preview.request('pick', {value: false});
    if (epoch !== this.interactionEpoch || generation !== this.generation) return;
    this.picking = false; this.pickButton.setAttribute('aria-pressed', 'false');
  },
  renderOutline() { renderDesignerOutline(this); },
  renderProperties() { renderDesignerProperties(this); },
  async edit(operation, {signal} = {}) {
    this.assertSourcePreview();
    if (!this.designer) throw Error('Fix UI syntax before visual editing');
    const file = this.file, source = this.model.read(file), revision = this.model.revision;
    const selection = captureDesignerSelection(this.designer, this.selected, operation);
    const result = await this.compiler.compile({...this.model.files}, 'ui-design', {file, entryFile: this.entryFile, entry: this.entry, operation, revision}, signal);
    signal?.throwIfAborted(); if (this.model.revision !== revision || this.model.read(file) !== source) throw Error('Editor changed while validating the visual edit; no source was overwritten');
    this.model.applyTransaction({[file]: result.source}); this.model.save();
    this.refreshSource({preserve: true});
    const node = restoreDesignerSelection(this.designer, selection, source);
    if (node) {
      this.select(node.id, false);
      // Source ranges change during a visual edit. Repair the editor's selection
      // before its queued echo can select an enclosing, now larger/smaller node.
      if (!this.root.hidden && this.dock?.visible !== false && this.model.active === file)
        this.app.selection.select(node.span, 'ui-studio', this.model.revision);
    }
    return this.build({signal});
  }
};
