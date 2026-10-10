import {Dom} from '../views/Dom.js';
import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {PreviewChannel} from './PreviewChannel.js';
import {createDesignerView} from './DesignerView.js';
import {StudioProject} from './StudioProject.js';
import {StudioPreview} from './StudioPreview.js';
import {StudioEditing} from './StudioEditing.js';
import {StudioTools} from './StudioTools.js';

/** One source document, compiler and retained live preview. No panel owns a second copy. */
export class UIStudioSession {
  constructor(app, {root, file}) {
    this.app = app; this.model = app.model; this.root = root; this.root.classList.add('ui-session'); this.root.dataset.viewFile = file;
    this.compiler = new BrowserCompiler(); this.file = file; this.entryFile = this.file; this.project = null; this.savingProject = false; this.entry = 'app'; this.backend = 'javascript';
    this.nativeAsset = null; this.selected = null; this.snapshot = null; this.artifact = null; this.generation = 0; this.compiledSource = null;
    this.view();
    this.preview = new PreviewChannel(this.frame, {onEvent: message => this.event(message)});
    this.unsubscribe = this.model.subscribe(event => this.changed(event));
    this.unselect = app.selection.subscribe(({span, origin}) => {
      if (this.root.hidden || this.dock?.visible === false || origin === 'ui-studio' || !span || span.file !== this.file || !this.designer) return;
      const nodes = this.designer.nodes.filter(node => node.start <= span.start && node.end >= span.end);
      nodes.sort((a, b) => a.end - a.start - (b.end - b.start)); if (nodes[0] && nodes[0].id !== this.selected) this.select(nodes[0].id, false);
    });
    try { this.loadProject(file); } catch (error) { this.error(error); }
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
  view() { createDesignerView(this); }
  dispose() { this.debugRequest?.abort(); this.debugView?.dispose(); this.disposed=true; this.dock?.dispose(); clearTimeout(this.buildTimer); this.active?.abort(); this.unsubscribe(); this.unselect(); this.preview.dispose(); void this.compiler.close(); }
}

Object.assign(UIStudioSession.prototype, StudioProject, StudioPreview, StudioEditing, StudioTools);
