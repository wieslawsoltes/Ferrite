import {RustDocument} from './RustDocument.js';
import {WorkspaceEditPlan} from '../ui/model/WorkspaceEditPlan.js';

/** Normalize plain LSP completions consistently for native and browser providers.
 * Explicit edits win over CompletionList defaults; fallback insertion replaces the
 * whole current token. Never evaluate completion commands or insert snippet syntax.
 */
export class CompletionEdits {
  static items(files, file, position, raw) {
    const text = files[file]; WorkspaceEditPlan.span(file, text, {start:position,end:position});
    const document = new RustDocument(text, file), offset = document.source.offset(position.line + 1, position.character + 1);
    const right = document.tokenAt(offset), left = document.tokenAt(offset, true);
    const usable = token => token && (token.identifier || ['attribute','event','tag','component'].includes(token.kind));
    const token = usable(right) && right.start < offset ? right : usable(left) && left.end === offset ? left : null;
    const point = at => { const p = document.source.position(at); return {line:p.line - 1,character:p.column - 1}; };
    const fallback = token ? {start:point(token.start),end:point(token.end)} : {start:position,end:position};
    const defaults = Array.isArray(raw) ? {} : raw?.itemDefaults ?? {};
    return (Array.isArray(raw) ? raw : raw?.items ?? []).slice(0,300).flatMap(item => {
      if (!item || typeof item.label !== 'string' || (item.insertTextFormat ?? defaults.insertTextFormat) === 2 || item.additionalTextEdits != null && !Array.isArray(item.additionalTextEdits)) return [];
      const defaultRange = defaults.editRange?.replace ?? defaults.editRange;
      const range = item.textEdit?.replace ?? item.textEdit?.range ?? defaultRange ?? fallback;
      let newText = item.textEdit?.newText ?? (defaultRange ? item.textEditText : undefined) ?? item.insertText ?? item.label;
      if (!item.textEdit && !defaultRange && token?.raw && /^[\p{XID_Start}_][\p{XID_Continue}_]*$/u.test(newText)) newText = 'r#' + newText;
      const changes = {[file]:[{range,newText},...(item.additionalTextEdits ?? [])]};
      try { WorkspaceEditPlan.prepare(files, changes); return [{label:item.label,detail:item.detail ?? '',changes}]; } catch { return []; }
    });
  }
}
