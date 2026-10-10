import {CompletionEdits} from '../../language/CompletionEdits.js';
import {WorkspaceEditPlan as Edits} from '../model/WorkspaceEditPlan.js';

/** Strict browser LSP -> IDE adapter. Never opens or edits a server-supplied URL. */
export class EditorLanguageResult {
  constructor(files) { this.files = files; }
  path(uri) {
    try {
      const url = new URL(uri); if (url.protocol !== 'ferrite:' || url.hostname !== 'workspace' || url.search || url.hash) return null;
      const path = url.pathname.slice(1).split('/').map(decodeURIComponent).join('/');
      return !path.split('/').some(p => p === '..' || p === '.') && Object.hasOwn(this.files,path) ? path : null;
    } catch { return null; }
  }
  span(uri, range) { const file = this.path(uri); return file ? Edits.span(file,this.files[file],range) : null; }
  edits(raw) {
    const changes = Object.create(null);
    for (const [uri,edits] of Object.entries(raw?.changes ?? {})) {
      const file = this.path(uri); if (!file) throw Error('Language edit is outside the current workspace'); changes[file] = edits;
    }
    if (raw?.documentChanges?.length) throw Error('File operations require explicit workspace tools');
    Edits.prepare(this.files,changes); return changes;
  }
  static text(contents) { return typeof contents === 'string' ? contents : Array.isArray(contents) ? contents.map(c => this.text(c)).join('\n\n') : contents?.value ?? ''; }
  map(method, raw, file, position, backend) {
    const result = {method,backend};
    if (['definition','references'].includes(method)) return {...result,locations:(Array.isArray(raw) ? raw : raw ? [raw] : []).flatMap(item => { const span = this.span(item.targetUri ?? item.uri,item.targetSelectionRange ?? item.range); return span ? [{span}] : []; })};
    if (method === 'rename') return raw ? {...result,changes:this.edits(raw)} : {...result,text:'No resolved local binding at the caret.'};
    if (method === 'hover') return {...result,text:EditorLanguageResult.text(raw?.contents)};
    if (method === 'signatureHelp') {
      const signature = raw?.signatures?.[raw.activeSignature ?? 0], parameter = signature?.parameters?.[signature?.activeParameter ?? raw.activeParameter ?? 0];
      return {...result,text:signature ? signature.label + (parameter ? '\n\nParameter: ' + (Array.isArray(parameter.label) ? signature.label.slice(...parameter.label) : parameter.label) : '') + '\n' + EditorLanguageResult.text(signature.documentation) : ''};
    }
    if (method === 'documentSymbol') return {...result,symbols:(raw ?? []).map(item => ({name:item.name,span:Edits.span(file,this.files[file],item.selectionRange ?? item.range)}))};
    if (method === 'completion') return {...result,items:CompletionEdits.items(this.files,file,position,raw)};
    return {...result,text:''};
  }
}
