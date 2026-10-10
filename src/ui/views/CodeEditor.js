import {Dom} from './Dom.js';
import {SyntaxHighlighter} from '../services/SyntaxHighlighter.js';
import {RustDocument} from '../../language/RustDocument.js';
import {CompletionPopup} from './CompletionPopup.js';
import {WorkspaceEditPlan} from '../model/WorkspaceEditPlan.js';
import {SourceFile} from '../../project/SourceFile.js';

/** Accessible native text input with an aligned syntax layer, gutter and source spans. */
const editors = new WeakMap();
export class CodeEditor {
  static forElement(element) { return editors.get(element) ?? null; }
  constructor(root, model, selection) {
    this.root=root; this.model=model; this.selection=selection; this.path=null; this.histories=new Map(); this.frame=0;
    this.gutter=Dom.element('div','editor-gutter'); this.gutter.setAttribute('aria-label','Breakpoints and line numbers');
    this.surface=Dom.element('div','editor-surface'); this.highlight=Dom.element('pre','editor-highlight'); this.highlight.setAttribute('aria-hidden','true');
    this.textarea=Dom.element('textarea','code-input'); this.textarea.id='source'; this.textarea.spellcheck=false; this.textarea.wrap='off'; this.textarea.autocapitalize='off'; this.textarea.autocomplete='off'; this.textarea.setAttribute('aria-label','Rust source editor');
    this.currentLine=Dom.element('div','current-line'); this.surface.append(this.currentLine,this.highlight,this.textarea); root.append(this.gutter,this.surface);
    editors.set(this.textarea,this); this.diagnostics=[]; this.diagnosticRevision=-1;
    this.languageStatus=Dom.element('span','editor-language-status'); this.languageStatus.setAttribute('role','status'); this.languageStatus.textContent='Rust tooling'; this.surface.append(this.languageStatus);
    this.signature=Dom.element('pre','editor-signature'); this.signature.hidden=true; this.surface.append(this.signature);
    this.textarea.addEventListener('compositionstart',()=>{this.composing=true;this.completion?.hide();});
    this.textarea.addEventListener('compositionend',()=>{this.composing=false;this.dispatch('editor-input',{composing:false});});
    this.textarea.addEventListener('input',event=>{this.changed();this.dispatch('editor-input',{composing:this.composing||event.isComposing,inputType:event.inputType,data:event.data});}); this.textarea.addEventListener('scroll',()=>{this.completion?.hide();this.scroll();});
    for (const name of ['click','keyup','select']) this.textarea.addEventListener(name,()=>this.queueSelection());
    this.textarea.addEventListener('keydown',event=>this.keydown(event));
    this.unsubscribe=selection.subscribe(event=>{if(event.span && !['editor','reset'].includes(event.origin))this.reveal(event.span);});
    this.unmodel=this.model.subscribe(event=>{
      if(event.renamed){for(const [from,to] of Object.entries(event.renamed)){if(this.histories.has(from)){this.histories.set(to,this.histories.get(from));this.histories.delete(from);}if(this.path===from){this.path=to;this.render();}}}
      if(event.kind==='replace')this.clearHistory();
      if(event.kind==='breakpoint')this.renderGutter();
      // External source projections must not leave this editor showing stale text.
      // Self-edits already have the new value and retain their local undo history.
      if(event.kind==='edit'&&event.path===this.path&&this.textarea.value!==this.model.files[this.path].replace(/\r\n/g,'\n'))this.open(this.path);
    });
  }
  capture() { if(this.path)this.model.positions.set(this.path,{start:this.textarea.selectionStart,end:this.textarea.selectionEnd,top:this.textarea.scrollTop,left:this.textarea.scrollLeft}); }
  open(path) {
    this.lineEnding=path&&this.model.files[path]?.includes('\r\n')?'\r\n':'\n';
    if(this.path===path && this.textarea.value===this.model.files[path]?.replace(/\r\n/g,'\n'))return;
    this.completion?.hide(); this.setSignature(''); this.capture(); this.path=path; this.textarea.value=path ? this.model.read(path) : ''; this.textarea.disabled=!path;
    const position=this.model.positions.get(path)??{start:0,end:0,top:0,left:0}; this.render();
    this.textarea.setSelectionRange(position.start,position.end);this.textarea.scrollTop=position.top;this.textarea.scrollLeft=position.left;this.scroll();
    if(path&&(!this.histories.has(path)||this.histories.get(path).entries[this.histories.get(path).index]?.text!==this.textarea.value))this.histories.set(path,{entries:[{text:this.textarea.value,start:position.start,end:position.end}],index:0});
    this.dispatch('editor-document');
  }
  changed({history=true}={}) {
    if(!this.path)return;
    this.completion?.hide(); this.setSignature(''); this.diagnostics=[]; this.diagnosticRevision=-1;
    this.model.update(this.path,this.lineEnding==='\r\n'?this.textarea.value.replace(/\n/g,'\r\n'):this.textarea.value); this.render();this.queueSelection();
    if(history){const state=this.histories.get(this.path)??{entries:[],index:-1};state.entries.splice(state.index+1);state.entries.push({text:this.textarea.value,start:this.textarea.selectionStart,end:this.textarea.selectionEnd});if(state.entries.length>150)state.entries.shift();state.index=state.entries.length-1;this.histories.set(this.path,state);}
  }
  undo(redo=false){const state=this.histories.get(this.path);if(!state)return;const index=state.index+(redo?1:-1);if(index<0||index>=state.entries.length)return;state.index=index;const entry=state.entries[index];this.textarea.value=entry.text;this.textarea.setSelectionRange(entry.start,entry.end);this.changed({history:false});}
  keydown(event) {
    if(this.composing||event.isComposing)return;
    if(this.completion?.keydown(event))return;
    if(event.key==='Escape')this.setSignature('');
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();this.undo(event.shiftKey);return;}
    if(event.key==='Tab'){
      event.preventDefault();const input=this.textarea,start=input.selectionStart,end=input.selectionEnd;
      if(event.shiftKey){const from=input.value.lastIndexOf('\n',start-1)+1;const count=/^ {1,4}/.exec(input.value.slice(from))?.[0].length??0;input.setRangeText('',from,from+count,'preserve');}
      else input.setRangeText('    ',start,end,'end');this.changed();
    }
    if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();const before=this.textarea.value.slice(0,this.textarea.selectionStart);let indent=/^\s*/.exec(before.split('\n').at(-1))[0];if(before.trimEnd().endsWith('{'))indent+='    ';this.textarea.setRangeText('\n'+indent,this.textarea.selectionStart,this.textarea.selectionEnd,'end');this.changed();}
  }
  render(){if(this.document?.text!==this.textarea.value||this.document?.file!==this.path)this.document=this.path?.endsWith('.rs')?new RustDocument(this.textarea.value,this.path):null;this.source=this.document?.source??new SourceFile(this.path??'',this.textarea.value);this.modelSource=new SourceFile(this.path??'',this.model.files[this.path]??'');this.highlight.innerHTML=SyntaxHighlighter.html(this.textarea.value,this.path,this.document,this.diagnosticRevision===this.model.revision?this.diagnostics:[])+'\n';this.renderGutter();this.scroll();}
  renderGutter(){const content=Dom.element('div','gutter-content');const count=this.source?.lines.length??1;for(let i=1;i<=count;i++){
    const row=Dom.element('button','gutter-line');row.type='button';row.dataset.line=String(i);row.setAttribute('aria-label',`Toggle breakpoint at line ${i}`);row.title=`Toggle breakpoint at line ${i}`;
    const issues=this.diagnosticRevision===this.model.revision?this.diagnostics.filter(d=>d.span.line<=i&&d.span.endLine>=i):[];if(issues.length){row.classList.add('has-diagnostic');row.title=issues.map(d=>d.message).join('\n');row.setAttribute('aria-label',`Line ${i}: ${issues.map(d=>d.message).join('; ')}. Toggle breakpoint`);}
    const isBreak=this.model.breakpoints.get(this.path)?.has(i);if(isBreak)row.classList.add('breakpoint');row.append(Dom.element('span','breakpoint-dot',isBreak?'●':''),Dom.element('span','line-number',i));
    row.onclick=()=>{if(this.path)this.model.toggleBreakpoint(this.path,i);};content.append(row);
  }this.gutter.replaceChildren(content);this.scroll();}
  scroll(){this.highlight.style.transform=`translate(${-this.textarea.scrollLeft}px,${-this.textarea.scrollTop}px)`;const content=this.gutter.firstChild;if(content)content.style.transform=`translateY(${-this.textarea.scrollTop}px)`;this.line();}
  line(){const position=this.source?.position(this.textarea.selectionStart);if(position){this.currentLine.style.top=`${14+(position.line-1)*22-this.textarea.scrollTop}px`;this.root.dispatchEvent(new CustomEvent('editor-position',{detail:position}));}}
  queueSelection(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.line();this.capture();this.dispatch('editor-caret');if(this.path)this.selection.select(this.originalSpan(this.textarea.selectionStart,this.textarea.selectionEnd),'editor',this.model.revision);});}
  originalSpan(start,end){const a=this.source.position(start),b=this.source.position(end);return this.modelSource.span(this.modelSource.offset(a.line,a.column),this.modelSource.offset(b.line,b.column));}
  reveal(span,{activate=true}={}){
    if(!Object.hasOwn(this.model.files,span.file))return;if(activate&&this.model.active!==span.file)this.model.open(span.file);this.open(span.file);
    const a=this.modelSource.position(span.start),b=this.modelSource.position(span.end),start=this.source.offset(a.line,a.column),end=this.source.offset(b.line,b.column);
    this.textarea.focus({preventScroll:true});this.textarea.setSelectionRange(start,end);this.textarea.scrollTop=Math.max(0,(a.line-5)*22);this.line();this.capture();
  }
  dispatch(name,detail={}){this.root.dispatchEvent(new CustomEvent(name,{bubbles:true,detail:{editor:this,...detail}}));}
  showCompletions(items,accept){this.completion??=new CompletionPopup(this);this.completion.show(items,accept);}
  setLanguageStatus(text){this.languageStatus.textContent=text;this.languageStatus.title=text;}
  setSignature(text){this.signature.textContent=text??'';this.signature.hidden=!text;}
  setDiagnostics(items,revision){if(revision!==this.model.revision)return;this.diagnostics=items.map(item=>({...item,span:WorkspaceEditPlan.span(this.path,this.textarea.value,item.range)}));this.diagnosticRevision=revision;this.render();}
  dispose(){editors.delete(this.textarea);this.completion?.dispose();this.unsubscribe();this.unmodel();if(this.frame)cancelAnimationFrame(this.frame);this.root.replaceChildren();}
  clearHistory(){this.histories.clear();this.path=null;}
}
