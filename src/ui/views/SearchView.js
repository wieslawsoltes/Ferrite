import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
import {WorkspaceSearch} from '../services/WorkspaceSearch.js';
import {ReplacePlan} from '../model/ReplacePlan.js';

/** Find-in-files tool with revision-safe navigation, explicit replacement preview and atomic undo. */
export class SearchView {
  constructor(root, model, selection, {search = new WorkspaceSearch()} = {}) {
    root.classList.add('search-tool');
    this.root = root; this.model = model; this.search = search; this.registry = new SpanRegistry(selection, 'search'); this.request = 0; this.result = null; this.plan = null;
    const form = Dom.element('form', 'workspace-search'); form.setAttribute('aria-label', 'Find and replace in project');
    const input = (id, label, placeholder) => { const row = Dom.element('label', 'search-field', label); const field = Dom.element('input'); field.id = id; field.placeholder = placeholder; field.setAttribute('aria-label', label); row.append(field); form.append(row); return field; };
    this.query = input('search-query', 'Search text', 'Literal text; metacharacters are not patterns');
    this.replacement = input('search-replacement', 'Replacement text', 'Literal replacement');
    this.include = input('search-include', 'File masks', '**/*.rs, Cargo.toml');
    this.exclude = input('search-exclude', 'Exclude masks', '**/generated/**');
    const options = Dom.element('div', 'search-options');
    const check = (id, label) => { const wrapper = Dom.element('label', '', label), field = Dom.element('input'); field.type = 'checkbox'; field.id = id; wrapper.prepend(field); options.append(wrapper); return field; };
    this.caseSensitive = check('search-case', 'Match case'); this.wholeWord = check('search-word', 'Whole word'); this.currentFile = check('search-current', 'Current file'); form.append(options);
    const buttons = Dom.element('div', 'search-actions');
    const find = Dom.button('Find all', () => this.find()); find.id = 'search-find';
    this.previewButton = Dom.button('Preview replacements', () => this.preview()); this.previewButton.id = 'search-preview';
    this.applyButton = Dom.button('Apply replacements', () => this.apply(), {className: 'primary-button'}); this.applyButton.id = 'search-apply';
    const undo = Dom.button('Undo replacement', () => { try { const done = model.undoTransaction(); this.message(done ? 'Replacement undone atomically.' : 'No edit transaction to undo.'); } catch (error) { this.message(error.message); } }); undo.id = 'search-undo';
    buttons.append(find, this.previewButton, this.applyButton, undo); form.append(buttons); form.onsubmit = event => { event.preventDefault(); this.find(); };
    this.note = Dom.element('p', 'view-note', 'Find literal text across the project. Ctrl/Cmd+Shift+F opens this tool.'); this.note.setAttribute('role', 'status');
    this.content = Dom.element('div', 'search-results'); root.append(form, this.note, this.content); this.disableEdits();
    for (const field of [this.query, this.include, this.exclude, this.caseSensitive, this.wholeWord, this.currentFile]) field.addEventListener('input', () => this.schedule());
    this.replacement.addEventListener('input', () => { this.plan = null; this.applyButton.disabled = true; });
    this.unsubscribe = model.subscribe(event => { if (['edit', 'files', 'replace'].includes(event.kind) || event.kind === 'open' && this.currentFile.checked) this.invalidate(); });
  }
  disableEdits() { this.previewButton.disabled = true; this.applyButton.disabled = true; }
  message(text) { this.note.textContent = text; }
  invalidate() {
    this.request++; this.controller?.abort(); clearTimeout(this.timer); this.registry.clear(); this.result = null; this.plan = null; this.disableEdits();
    Dom.empty(this.content, 'Source changed. Search again to refresh exact locations.');
  }
  schedule() { this.invalidate(); this.timer = setTimeout(() => this.find(), 180); }
  open(text = '', currentFile = false) { this.currentFile.checked = currentFile; if (text) this.query.value = text; this.query.focus(); this.query.select(); if (this.query.value) this.find(); }
  async find() {
    clearTimeout(this.timer); this.controller?.abort(); const serial = ++this.request, revision = this.model.revision;
    this.controller = new AbortController(); this.registry.clear(); this.plan = null; this.disableEdits(); this.message('Searching…');
    try {
      if (this.currentFile.checked && !this.model.active) throw Error('Open a file before searching the current file');
      const result = await this.search.find({...this.model.files}, this.query.value, {caseSensitive: this.caseSensitive.checked, wholeWord: this.wholeWord.checked, include: this.include.value, exclude: this.exclude.value, file: this.currentFile.checked ? this.model.active : null, revision, signal: this.controller.signal});
      if (serial !== this.request || revision !== this.model.revision) return;
      this.result = result; this.content.replaceChildren();
      this.message(`${result.matches.length}${result.truncated ? '+' : ''} matches · ${Object.keys(result.sources).length} files · ${result.scannedFiles} searched${result.truncated ? ' · refine search before replacing' : ''}`);
      let path = null;
      for (const match of result.matches) {
        if (path !== match.span.file) { path = match.span.file; this.content.append(Dom.element('h3', 'section-heading', path)); }
        const row = Dom.button('', null, {className: 'search-match', title: Dom.sourceLabel(match.span)});
        row.append(Dom.element('small', 'muted', `${match.span.line}:${match.span.column}`), Dom.element('span', '', match.before), Dom.element('mark', '', match.text), Dom.element('span', '', match.after));
        this.registry.bind(row, match.span); this.content.append(row);
      }
      if (!result.matches.length) Dom.empty(this.content, result.query ? 'No matching text.' : 'Enter text to search.');
      this.previewButton.disabled = !result.matches.length || result.truncated;
    } catch (error) { if (error.name !== 'AbortError' && serial === this.request) { this.message(error.message); this.content.replaceChildren(); } }
  }
  preview() {
    if (!this.result || this.result.revision !== this.model.revision) { this.message('Search is stale. Run Find all again.'); return; }
    try {
      this.plan = new ReplacePlan(this.result, this.replacement.value); this.registry.clear(); this.content.replaceChildren();
      for (const path of Object.keys(this.plan.after)) {
        const panel = Dom.element('details', 'refactor-preview'); panel.open = true;
        panel.append(Dom.element('summary', '', path), Dom.element('p', 'view-note', 'Before / after (first 25,000 characters)'), Dom.element('pre', 'refactor-before', this.plan.before[path].slice(0, 25000)), Dom.element('pre', 'refactor-after', this.plan.after[path].slice(0, 25000))); this.content.append(panel);
      }
      this.message(`Preview: ${this.plan.count} literal replacements · ${Object.keys(this.plan.after).length} files. Nothing has changed yet.`); this.applyButton.disabled = false;
    } catch (error) { this.message(error.message); this.applyButton.disabled = true; }
  }
  apply() {
    try { if (!this.plan) throw Error('Preview replacements before applying'); const plan = this.plan, paths = plan.apply(this.model); this.message(`Applied ${plan.count} replacements to ${paths.length} files. Undo replacement restores all affected files.`); }
    catch (error) { this.message(error.message); }
  }
  dispose() { clearTimeout(this.timer); this.controller?.abort(); this.unsubscribe(); this.registry.unsubscribe(); }
}
