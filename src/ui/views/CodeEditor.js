import {Dom} from './Dom.js';
import {SyntaxHighlighter} from '../services/SyntaxHighlighter.js';
import {SourceFile} from '../../project/SourceFile.js';

/** Accessible native text input with an aligned syntax layer, gutter and source spans. */
export class CodeEditor {
  constructor(root, model, selection) {
    this.root=root; this.model=model; this.selection=selection; this.path=null; this.histories=new Map(); this.frame=0;
    this.gutter=Dom.element('div','editor-gutter'); this.gutter.setAttribute('aria-label','Breakpoints and line numbers');
    this.surface=Dom.element('div','editor-surface'); this.highlight=Dom.element('pre','editor-highlight'); this.highlight.setAttribute('aria-hidden','true');
    this.textarea=Dom.element('textarea','code-input'); this.textarea.id='source'; this.textarea.spellcheck=false; this.textarea.wrap='off'; this.textarea.autocapitalize='off'; this.textarea.autocomplete='off'; this.textarea.setAttribute('aria-label','Rust source editor');
    this.currentLine=Dom.element('div','current-line'); this.surface.append(this.currentLine,this.highlight,this.textarea); root.append(this.gutter,this.surface);
    this.textarea.addEventListener('input',()=>this.changed()); this.textarea.addEventListener('scroll',()=>this.scroll());
    for (const name of ['click','keyup','select']) this.textarea.addEventListener(name,()=>this.queueSelection());
    this.textarea.addEventListener('keydown',event=>this.keydown(event));
    this.unsubscribe=selection.subscribe(event=>{if(event.span && !['editor','reset'].includes(event.origin))this.reveal(event.span);});
    this.unmodel=this.model.subscribe(event=>{
      if(event.renamed){for(const [from,to] of Object.entries(event.renamed)){if(this.histories.has(from)){this.histories.set(to,this.histories.get(from));this.histories.delete(from);}if(this.path===from){this.path=to;this.render();}}}
      if(event.kind==='replace')this.clearHistory();
      if(event.kind==='breakpoint')this.renderGutter();
      // External source projections must not leave this editor showing stale text.
      // Self-edits already have the new value and retain their local undo history.
      if(event.kind==='edit'&&event.path===this.path&&this.textarea.value!==this.model.files[this.path])this.open(this.path);
    });
  }
  capture() { if(this.path)this.model.positions.set(this.path,{start:this.textarea.selectionStart,end:this.textarea.selectionEnd,top:this.textarea.scrollTop,left:this.textarea.scrollLeft}); }
  open(path) {
    if(this.path===path && this.textarea.value===this.model.files[path])return;
    this.capture(); this.path=path; this.textarea.value=path ? this.model.read(path) : ''; this.textarea.disabled=!path;
    const position=this.model.positions.get(path)??{start:0,end:0,top:0,left:0}; this.render();
    this.textarea.setSelectionRange(position.start,position.end);this.textarea.scrollTop=position.top;this.textarea.scrollLeft=position.left;this.scroll();
    if(path&&(!this.histories.has(path)||this.histories.get(path).entries[this.histories.get(path).index]?.text!==this.textarea.value))this.histories.set(path,{entries:[{text:this.textarea.value,start:position.start,end:position.end}],index:0});
  }
  changed({history=true}={}) {
    if(!this.path)return;
    this.model.update(this.path,this.textarea.value); this.render();this.queueSelection();
    if(history){const state=this.histories.get(this.path)??{entries:[],index:-1};state.entries.splice(state.index+1);state.entries.push({text:this.textarea.value,start:this.textarea.selectionStart,end:this.textarea.selectionEnd});if(state.entries.length>150)state.entries.shift();state.index=state.entries.length-1;this.histories.set(this.path,state);}
  }
  undo(redo=false){const state=this.histories.get(this.path);if(!state)return;const index=state.index+(redo?1:-1);if(index<0||index>=state.entries.length)return;state.index=index;const entry=state.entries[index];this.textarea.value=entry.text;this.textarea.setSelectionRange(entry.start,entry.end);this.changed({history:false});}
  keydown(event) {
    if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==='z'){event.preventDefault();this.undo(event.shiftKey);return;}
    if(event.key==='Tab'){
      event.preventDefault();const input=this.textarea,start=input.selectionStart,end=input.selectionEnd;
      if(event.shiftKey){const from=input.value.lastIndexOf('\n',start-1)+1;const count=/^ {1,4}/.exec(input.value.slice(from))?.[0].length??0;input.setRangeText('',from,from+count,'preserve');}
      else input.setRangeText('    ',start,end,'end');this.changed();
    }
    if(event.key==='Enter'&&!event.ctrlKey&&!event.metaKey){event.preventDefault();const before=this.textarea.value.slice(0,this.textarea.selectionStart);let indent=/^\s*/.exec(before.split('\n').at(-1))[0];if(before.trimEnd().endsWith('{'))indent+='    ';this.textarea.setRangeText('\n'+indent,this.textarea.selectionStart,this.textarea.selectionEnd,'end');this.changed();}
  }
  render(){this.highlight.innerHTML=SyntaxHighlighter.html(this.textarea.value,this.path)+'\n';this.source=new SourceFile(this.path??'',this.textarea.value);this.renderGutter();this.scroll();}
  renderGutter(){const content=Dom.element('div','gutter-content');const count=this.source?.lines.length??1;for(let i=1;i<=count;i++){
    const row=Dom.element('button','gutter-line');row.type='button';row.dataset.line=String(i);row.setAttribute('aria-label',`Toggle breakpoint at line ${i}`);row.title=`Toggle breakpoint at line ${i}`;
    const isBreak=this.model.breakpoints.get(this.path)?.has(i);if(isBreak)row.classList.add('breakpoint');row.append(Dom.element('span','breakpoint-dot',isBreak?'●':''),Dom.element('span','line-number',i));
    row.onclick=()=>{if(this.path)this.model.toggleBreakpoint(this.path,i);};content.append(row);
  }this.gutter.replaceChildren(content);this.scroll();}
  scroll(){this.highlight.style.transform=`translate(${-this.textarea.scrollLeft}px,${-this.textarea.scrollTop}px)`;const content=this.gutter.firstChild;if(content)content.style.transform=`translateY(${-this.textarea.scrollTop}px)`;this.line();}
  line(){const position=this.source?.position(this.textarea.selectionStart);if(position){this.currentLine.style.top=`${14+(position.line-1)*22-this.textarea.scrollTop}px`;this.root.dispatchEvent(new CustomEvent('editor-position',{detail:position}));}}
  queueSelection(){if(this.frame)return;this.frame=requestAnimationFrame(()=>{this.frame=0;this.line();this.capture();if(this.path)this.selection.select(this.source.span(this.textarea.selectionStart,this.textarea.selectionEnd),'editor',this.model.revision);});}
  reveal(span){if(!Object.hasOwn(this.model.files,span.file))return;if(this.model.active!==span.file)this.model.open(span.file);this.open(span.file);const start=Math.min(span.start,this.textarea.value.length),end=Math.min(Math.max(span.end,start),this.textarea.value.length);this.textarea.focus({preventScroll:true});this.textarea.setSelectionRange(start,end);const line=this.source.position(start).line;this.textarea.scrollTop=Math.max(0,(line-5)*22);this.line();this.capture();}
  dispose(){this.unsubscribe();this.unmodel();if(this.frame)cancelAnimationFrame(this.frame);this.root.replaceChildren();}
  clearHistory(){this.histories.clear();this.path=null;}
}
