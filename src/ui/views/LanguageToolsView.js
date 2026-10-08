import {Dom} from './Dom.js';
import {SpanRegistry} from './SpanRegistry.js';
import {WorkspaceEditPlan} from '../model/WorkspaceEditPlan.js';

/** Semantic results from installed rust-analyzer, with previewed revision-checked edits. */
export class LanguageToolsView {
  constructor(root,model,selection,onCommand){
    this.root=root;this.model=model;this.registry=new SpanRegistry(selection,'rust-analyzer');this.revision=-1;
    const toolbar=Dom.element('div','language-toolbar');
    for(const [command,title] of [['completion','Complete'],['definition','Definition'],['references','References'],['hover','Documentation'],['rename','Rename symbol'],['documentSymbol','Symbols'],['signatureHelp','Signature']]){
      const b=Dom.button(title,()=>onCommand(command),{className:'subtle-button'});b.dataset.languageCommand=command;toolbar.append(b);
    }
    const undo=Dom.button('Undo refactoring',()=>{try{this.model.undoTransaction();}catch(error){this.message(error.message);}});undo.id='undo-refactoring';toolbar.append(undo);
    this.header=Dom.element('p','view-note');this.content=Dom.element('div','language-results');this.root.append(toolbar,this.header,this.content);this.invalidate();
  }
  invalidate(){this.revision=-1;this.registry.clear();this.header.textContent='Installed rust-analyzer · UTF-16 source positions · native bridge required';Dom.empty(this.content,'Request semantic tooling for the active Rust source.');}
  message(text){this.registry.clear();this.header.textContent=text;this.content.replaceChildren();}
  apply(changes,revision){
    if(revision!==this.model.revision){this.message('Refactoring is stale. Request it again for the current source.');return;}
    try{const plan=WorkspaceEditPlan.prepare(this.model.files,changes);this.model.applyTransaction(plan.files);this.message(`Applied ${plan.count} semantic edits to ${plan.paths.length} files. Undo refactoring restores the transaction.`);}catch(error){this.message(error.message);}
  }
  render(result,revision){
    this.registry.clear();this.content.replaceChildren();this.revision=revision;this.header.textContent=`rust-analyzer · ${result.method} · revision ${revision}`;
    if(result.changes){
      const plan=WorkspaceEditPlan.prepare(this.model.files,result.changes);this.content.append(Dom.element('h3','section-heading',`${plan.count} edits · ${plan.paths.length} files`));
      for(const path of plan.paths){const panel=Dom.element('details','refactor-preview');panel.open=true;panel.append(Dom.element('summary','',path),Dom.element('pre','refactor-before',this.model.files[path].slice(0,25000)),Dom.element('pre','refactor-after',plan.files[path].slice(0,25000)));this.content.append(panel);}
      const apply=Dom.button('Apply refactoring',()=>this.apply(result.changes,revision),{className:'primary-button'});apply.id='apply-refactoring';this.content.append(apply);return;
    }
    if(result.items){
      for(const item of result.items){const row=Dom.button(item.label,()=>this.apply(item.changes,revision),{className:'completion-item'});row.append(Dom.element('small','',item.detail));this.content.append(row);}
      if(!result.items.length)Dom.empty(this.content,'No completions at this position.');return;
    }
    if(result.locations||result.symbols){
      const entries=result.locations??result.symbols;
      for(const item of entries){const row=Dom.button(item.name??Dom.sourceLabel(item.span),null,{className:'language-location'});row.append(Dom.element('small','',item.detail??Dom.sourceLabel(item.span)));this.registry.bind(row,item.span);this.content.append(row);}
      if(!entries.length)Dom.empty(this.content,'No project-local locations returned. External library sources are not fetched.');return;
    }
    this.content.append(Dom.element('pre','language-documentation',result.text||'No documentation at this position.'));
  }
}
