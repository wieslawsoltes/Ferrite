import {Dom} from '../views/Dom.js';
import {UIProject} from '../../ui-framework/UIProject.js';
import {SourceDesigner} from '../../ui-framework/SourceDesigner.js';
import {UI_SAMPLE_CSS} from '../../ui-framework/Samples.js';
/** Session operations; the owning UIStudioSession supplies document-scoped state. */
export const StudioProject = {
  refreshFiles() {
    const before = this.file; this.files.replaceChildren(); this.entryFiles.replaceChildren();
    for (const path of Object.keys(this.model.files).filter(path => path.endsWith('.rs'))) { const option = Dom.element('option', '', path); option.value = path; this.files.append(option); this.entryFiles.append(option.cloneNode(true)); }
    this.files.value = before; this.entryFiles.value = this.entryFile; this.pathLabel.textContent = this.entryFile; this.pathLabel.title = this.entryFile;
  },
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
  },
  loadProject(file) {
    this.project = UIProject.load(this.model.files, file, {css: UI_SAMPLE_CSS}); this.entryFile = file; this.file = file;
    const settings = this.project.settings; this.entry = settings.entry; this.backend = settings.backend;
    this.entryInput.value = this.entry; this.backendSelect.value = this.backend; this.css.value = this.project.css;
    this.viewport.value = settings.viewport; this.frame.style.width = settings.viewport;
  },
  saveProject() {
    if (!Object.hasOwn(this.model.files, this.entryFile) || this.savingProject) return;
    try {
      const project = UIProject.load(this.model.files, this.entryFile, {css: this.css.value});
      const changes = project.changes({entry: this.entry, backend: this.backend, viewport: this.viewport.value}, this.css.value);
      this.savingProject = true; this.model.applyWorkspaceTransaction(changes); this.model.save();
      this.project = UIProject.load(this.model.files, this.entryFile);
    } catch (error) { this.error(error); } finally { this.savingProject = false; }
  },
  changed(event) {
    if (!['edit','files','replace'].includes(event.kind) || this.disposed) return;
    this.refreshFiles();
    const relevant = new Set([this.file,this.entryFile,UIProject.manifestPath(this.entryFile),this.project?.settings.stylesheet,...Object.keys(this.dependencies ?? {})]);
    if (event.kind === 'edit' && !relevant.has(event.path)) return;
    if (event.kind === 'files' && this.observedFiles && [...relevant].every(path => this.observedFiles[path] === this.model.files[path])) return;
    this.observedFiles = {...this.model.files};
    this.markStale();
    if (!this.savingProject && Object.hasOwn(this.model.files,this.entryFile)) {
      try { const project=UIProject.load(this.model.files,this.entryFile,{css:this.css.value}); this.project=project; this.css.value=project.css; this.entry=project.settings.entry; this.backend=project.settings.backend; this.entryInput.value=this.entry; this.backendSelect.value=this.backend; this.viewport.value=project.settings.viewport; this.frame.style.width=project.settings.viewport; }
      catch(error){this.error(error);}
    }
    this.refreshSource({preserve:true,invalidate:false});
    clearTimeout(this.buildTimer);
    if (!this.savingProject && !this.root.hidden && this.app.model.documentState(this.app.model.active).mode !== 'code') this.buildTimer=setTimeout(()=>this.build().catch(error=>this.error(error)),350);
  },
  markStale() {
    this.generation++; this.active?.abort(); this.nativeAsset = null; this.artifact = null; this.snapshot = null; this.renderState();
    this.status.textContent = 'Source changed · Preview to compile. The previous preview is read-only to tooling.'; this.status.dataset.kind = 'stale';
  },
  error(error) {
    if (error.name === 'AbortError') return;
    this.status.dataset.kind = 'error'; this.status.textContent = `${error.code ? error.code + ': ' : ''}${error.message}`;
    if (!this.root.hidden && this.dock?.visible !== false && !this.disposed && error.span?.file === this.file) this.app.selection.select(error.span, 'ui-studio', this.model.revision);
  }
};
