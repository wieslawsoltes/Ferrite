import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {BrowserLanguageService} from '../../agent/browser/BrowserLanguageService.js';
import {VirtualFileSystem} from '../../project/VirtualFileSystem.js';
import {CodeEditor} from '../views/CodeEditor.js';
import {DialogService} from '../views/DialogService.js';
import {EditorLanguageResult} from '../services/EditorLanguageResult.js';
import {WorkspaceEditPlan} from '../model/WorkspaceEditPlan.js';

/** Owns editor language requests, not files. One revision/caret lease per interaction.
 * UI analysis is local and never executes workspace code. Native rust-analyzer is
 * retained for regular Rust when the user explicitly connects the trusted bridge.
 */
export class EditorLanguageController {
  constructor(app) {
    this.app = app; this.model = app.model; this.compiler = new BrowserCompiler(); this.lifetime = new AbortController(); this.reset();
    const options = {signal:this.lifetime.signal};
    document.addEventListener('focusin',event => { const editor = CodeEditor.forElement(event.target); if (editor) { this.lastEditor = editor; this.scheduleDiagnostics(editor); } },options);
    document.addEventListener('editor-document',event => { this.invalidate(); this.scheduleDiagnostics(event.detail.editor); },options);
    document.addEventListener('editor-input',event => this.input(event.detail),options);
    document.addEventListener('editor-caret',event => {
      if (this.lease?.editor === event.detail.editor && !this.valid(this.lease)) { this.interaction?.abort(); event.detail.editor.completion?.hide(); }
    },options);
    this.unsubscribe = this.model.subscribe(event => {
      if (['edit','files','replace'].includes(event.kind)) { this.invalidate(); if (event.kind === 'replace') this.reset(); this.scheduleDiagnostics(); }
    });
    window.addEventListener('pagehide',() => this.dispose(),{once:true,signal:this.lifetime.signal});
  }
  reset() {
    this.language?.close(); const model = this.model, identity = model.workspaceId, epoch = model.workspaceEpoch;
    const workspace = {model,normalize:path => VirtualFileSystem.path(path),snapshot:async () => ({files:{...model.files},revision:model.revision}),assertCurrent(signal) {
      if (signal?.aborted) throw signal.reason ?? new DOMException('Language request cancelled','AbortError');
      if (model.workspaceId !== identity || model.workspaceEpoch !== epoch) throw new DOMException('Workspace replaced','AbortError');
    }};
    this.language = new BrowserLanguageService(workspace,this.compiler);
  }
  editors() { return [this.app.editor,this.app.studio.secondary?.editor].filter(Boolean); }
  activeEditor() {
    const focused = CodeEditor.forElement(document.activeElement);
    return focused ?? (this.lastEditor?.textarea.isConnected && this.lastEditor.textarea.getClientRects().length ? this.lastEditor : this.app.editor);
  }
  capture(editor) { return {editor,file:editor.path,text:this.model.files[editor.path],editorText:editor.textarea.value,revision:this.model.revision,identity:this.model.workspaceId,epoch:this.model.workspaceEpoch,start:editor.textarea.selectionStart,end:editor.textarea.selectionEnd}; }
  valid(lease, caret = !lease.anchored) { return !this.disposed && (!caret || !CodeEditor.forElement(document.activeElement) || CodeEditor.forElement(document.activeElement)===lease.editor) && lease.editor.textarea.isConnected && lease.file === lease.editor.path && this.model.workspaceId === lease.identity && this.model.workspaceEpoch === lease.epoch && this.model.revision === lease.revision && this.model.files[lease.file] === lease.text && lease.editor.textarea.value===lease.editorText && (!caret || lease.start === lease.editor.textarea.selectionStart && lease.end === lease.editor.textarea.selectionEnd); }
  options(editor) {
    const options = {...this.app.options}, owner = this.app.studio.sourceOwners.get(editor.path);
    if (owner && Object.hasOwn(this.model.files,owner)) options.uiEntryFile = owner;
    else if (this.app.studio.isView(editor.path)) options.uiEntryFile = editor.path;
    return options;
  }
  invalidate() {
    clearTimeout(this.completionTimer); clearTimeout(this.diagnosticTimer); this.interaction?.abort(); this.diagnosticRequest?.abort(); this.lease = null;
    for (const editor of this.editors()) { editor.completion?.hide(); editor.setDiagnostics([],this.model.revision); }
  }
  input({editor, composing, inputType, data}) {
    this.lastEditor = editor; this.invalidate(); this.scheduleDiagnostics(editor);
    if (composing || !editor.path?.endsWith('.rs')) return;
    if (inputType === 'insertText' && typeof data === 'string' && /[\p{XID_Continue}:<.-]$/u.test(data)) this.completionTimer = setTimeout(() => this.command('completion',{editor,automatic:true}),140);
    else if (inputType === 'insertText' && (data === '(' || data === ',')) this.completionTimer = setTimeout(() => this.command('signatureHelp',{editor,automatic:true}),160);
  }
  scheduleDiagnostics(editor = this.activeEditor()) {
    clearTimeout(this.diagnosticTimer); if (!editor?.path?.endsWith('.rs')) return;
    this.diagnosticTimer = setTimeout(async () => {
      if (this.disposed || this.interaction) return;
      // Do not replace full native diagnostics with subset diagnostics in an ordinary Rust project.
      if (this.app.native.capabilities?.languageServer && !this.options(editor).uiEntryFile) return;
      const lease = this.capture(editor), controller = this.diagnosticRequest = new AbortController();
      editor.setLanguageStatus('Analyzing…');
      try {
        const result = await this.language.request('textDocument/diagnostic',{path:lease.file,options:this.options(editor)},controller.signal);
        if (this.valid(lease,false) && !controller.signal.aborted) {
          editor.setDiagnostics(result.items,lease.revision); editor.setLanguageStatus(`${this.options(editor).uiEntryFile ? 'Rust UI' : 'Rust subset'} · ${result.items.length} diagnostics`);
        }
      } catch (error) { if (this.valid(lease,false) && !controller.signal.aborted && error.name !== 'AbortError') editor.setLanguageStatus(error.message); }
      finally { if (this.diagnosticRequest === controller) this.diagnosticRequest = null; }
    },350);
  }
  async command(command, {editor = this.activeEditor(),automatic = false} = {}) {
    if(editor?.composing)return;
    if (!editor?.path?.endsWith('.rs')) { if (!automatic) this.app.status('Open a Rust source file for language tooling.','error'); return; }
    this.diagnosticRequest?.abort(); this.interaction?.abort(); clearTimeout(this.completionTimer);
    const lease = this.lease = this.capture(editor), controller = this.interaction = new AbortController(); this.lastEditor = editor;
    // Modal focus restoration may reset a textarea caret. Rename targets the
    // captured symbol, but still requires the exact file/workspace revision.
    lease.anchored = command === 'rename';
    let newName;
    try {
      if (command === 'rename') { newName = await DialogService.ask({title:'Rename Rust symbol',label:'New symbol name',confirm:'Preview edits'}); if (!newName || !this.valid(lease)) return; editor.textarea.setSelectionRange(lease.start,lease.end); }
      const position = BrowserLanguageService.point(lease.editorText,lease.start), options = this.options(editor);
      const useNative = this.app.native.capabilities?.languageServer && !options.uiEntryFile;
      const backend = useNative ? 'rust-analyzer' : options.uiEntryFile ? 'Ferrite Rust UI' : 'Ferrite Rust subset';
      if (!automatic && command !== 'completion') { this.app.dock.open('language'); this.app.languageTools.message(`Loading ${backend} results…`); }
      let result;
      if (useNative) {
        const native = this.app.native, session = this.app.repositories.session, parameters = {file:lease.file,position,newName,options};
        controller.signal.addEventListener('abort',() => native.languageActive?.abort(),{once:true});
        result = await (session ? native.repository('language',{id:session.id,version:session.version,files:{...this.model.files},method:'textDocument/' + command,...parameters}) : native.language({...this.model.files},'textDocument/' + command,parameters));
        result = {...result,method:command,backend};
      } else {
        const raw = await this.language.request('textDocument/' + command,{path:lease.file,params:{position,newName},options},controller.signal);
        result = new EditorLanguageResult(this.model.files).map(command,raw,lease.file,position,backend);
      }
      if (controller.signal.aborted || !this.valid(lease)) return;
      editor.setLanguageStatus(backend);
      if (command === 'completion') {
        if (result.items?.length) editor.showCompletions(result.items,item => this.accept(item,lease));
        else if (!automatic) { this.app.dock.open('language'); this.app.languageTools.render(result,lease.revision); }
      } else if (command === 'definition' && result.locations?.length === 1) {
        const span = result.locations[0].span;
        if (editor === this.app.studio.secondary?.editor) this.app.studio.secondary.path = span.file;
        editor.reveal(span,{activate:editor!==this.app.studio.secondary?.editor}); this.app.studio.refreshSecondaryFiles(); this.app.languageTools.render(result,lease.revision);
      } else if (automatic && command === 'signatureHelp') editor.setSignature(result.text);
      else this.app.languageTools.render(result,lease.revision);
    } catch (error) { if (!controller.signal.aborted && this.valid(lease) && error.name !== 'AbortError') { if (automatic) editor.setLanguageStatus(error.message); else { this.app.dock.open('language'); this.app.languageTools.message(error.message); } } }
    finally {
      if (this.interaction === controller) { this.interaction = null; this.scheduleDiagnostics(editor); }
      if (this.app.nativeCheckPending && !this.app.repositories.needsReload) { this.app.nativeCheckPending = false; this.app.schedule(); }
    }
  }
  accept(item, lease) {
    if (!this.valid(lease)) return;
    try {
      const changes = item.changes, edits = changes[lease.file], editor = lease.editor;
      WorkspaceEditPlan.prepare(this.model.files,changes);
      if (Object.keys(changes).length === 1 && edits.length === 1) {
        const edit = edits[0], span = WorkspaceEditPlan.span(lease.file,lease.editorText,edit.range);
        editor.textarea.setRangeText(edit.newText,span.start,span.end,'end'); editor.changed();
      } else {
        const plan = WorkspaceEditPlan.prepare(this.model.files,changes); this.model.applyTransaction(plan.files); editor.open(lease.file);
      }
      editor.textarea.focus({preventScroll:true}); editor.capture(); this.scheduleDiagnostics(editor);
    } catch (error) { this.app.languageTools.message(error.message); }
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.invalidate(); this.unsubscribe(); this.lifetime.abort(); this.language.close(); this.compiler.close(); }
}
