import {Dom} from './Dom.js';
import {SampleProjects} from '../model/SampleProjects.js';
import {SyntaxHighlighter} from '../services/SyntaxHighlighter.js';
import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {PreviewChannel} from '../studio/PreviewChannel.js';
import {UIProject} from '../../ui-framework/UIProject.js';

/** Disposable, isolated sample gallery. Source, runtime and workspace have separate lifetimes. */
export class SampleBrowser {
  constructor(app){this.app=app;this.generation=0;}
  open(id=null){
    if(this.dialog?.open){if(id)this.choose(SampleProjects.find(id));return;}
    const model=this.app.model;this.epoch=model.workspaceEpoch;this.revision=model.revision;
    this.compiler=new BrowserCompiler();this.dialog=Dom.element('dialog','sample-browser');this.dialog.setAttribute('aria-label','Samples');
    const heading=Dom.element('header','sample-browser-header');heading.append(Dom.element('h2','','Samples'),Dom.element('span','sample-browser-subtitle','Run, inspect, then make it yours'),Dom.button('Close',()=>this.dialog.close(),{icon:'close'}));
    const layout=Dom.element('div','sample-browser-layout'),sidebar=Dom.element('aside','sample-browser-sidebar');
    this.search=Dom.element('input');this.search.type='search';this.search.placeholder='Search samples…';this.search.setAttribute('aria-label','Search samples');
    this.category=Dom.element('select');this.category.setAttribute('aria-label','Sample category');
    for(const name of ['All','7GUIs','Rust','Native Rust']){const option=Dom.element('option','',name);option.value=name;this.category.append(option);}
    this.list=Dom.element('div','sample-browser-list');this.list.setAttribute('role','listbox');this.list.setAttribute('aria-label','Available samples');
    this.search.oninput=this.category.onchange=()=>this.renderList();sidebar.append(this.search,this.category,this.list);
    const detail=Dom.element('section','sample-browser-detail');this.title=Dom.element('h3');this.description=Dom.element('p');this.tags=Dom.element('div','sample-browser-tags');
    const actions=Dom.element('div','sample-browser-actions');this.openButton=Dom.button('Open as new project',()=>this.install(false),{icon:'cargo'});this.addButton=Dom.button('Add to current project',()=>this.install(true),{icon:'plus'});actions.append(this.openButton,this.addButton);
    this.status=Dom.element('div','sample-browser-status');this.status.setAttribute('role','status');
    const tabs=Dom.element('div','sample-browser-tabs');tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','Sample details');
    this.previewButton=Dom.button('Live preview',()=>this.setMode('preview'));this.sourceButton=Dom.button('Source files',()=>this.setMode('source'));
    for(const [mode,button] of [['preview',this.previewButton],['source',this.sourceButton]]){button.setAttribute('role','tab');button.id=`sample-${mode}-tab`;button.setAttribute('aria-controls',`sample-${mode}`);button.onkeydown=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();this.setMode(mode==='preview'?'source':'preview');(mode==='preview'?this.sourceButton:this.previewButton).focus();}};}
    this.backend=Dom.element('select');this.backend.setAttribute('aria-label','Sample preview backend');for(const [value,label] of [['javascript','JavaScript'],['wasm','WebAssembly'],['mir','MIR']]){const option=Dom.element('option','',label);option.value=value;this.backend.append(option);}this.backend.onchange=()=>this.preview();
    tabs.append(this.previewButton,this.sourceButton,this.backend);
    this.frame=Dom.element('iframe','sample-browser-preview');this.frame.id='sample-preview';this.frame.title='Isolated sample preview';this.frame.setAttribute('aria-labelledby',this.previewButton.id);
    this.channel=new PreviewChannel(this.frame,{onEvent:message=>{if(message.event==='ready')this.message(`Live ${this.backend.value} preview · no project changes`);else if(message.event==='error')this.message(message.error?.message??'Sample runtime error',true);}});
    this.sources=Dom.element('div','sample-browser-sources');this.sources.id='sample-source';this.sources.setAttribute('role','tabpanel');this.sources.setAttribute('aria-labelledby',this.sourceButton.id);
    this.file=Dom.element('select');this.file.setAttribute('aria-label','Sample source file');this.file.onchange=()=>this.renderSource();this.code=Dom.element('pre','sample-browser-code');this.code.tabIndex=0;this.code.setAttribute('aria-label','Sample source code');this.sources.append(this.file,this.code);
    detail.append(this.title,this.description,this.tags,actions,this.status,tabs,this.frame,this.sources);
    layout.append(sidebar,detail);this.dialog.append(heading,layout,Dom.element('footer','sample-browser-footer','Browsing does not change your files. Open archives the current project first. Add creates an independent, collision-free copy.'));
    this.dialog.onclose=()=>this.dispose();document.body.append(this.dialog);this.dialog.showModal();this.mode='preview';this.renderList();this.choose(SampleProjects.find(id??'7guis-counter'));this.search.focus();
  }
  message(text,error=false){this.status.textContent=text;this.status.dataset.error=String(error);}
  renderList(){
    const items=SampleProjects.search(this.search.value,this.category.value);this.list.replaceChildren();
    for(const [index,sample] of items.entries()){
      const button=Dom.button('',()=>this.choose(sample),{className:'sample-browser-item'});button.dataset.sample=sample.id;button.setAttribute('role','option');button.setAttribute('aria-selected',String(sample.id===this.selected?.id));button.tabIndex=sample.id===this.selected?.id||!this.selected&&index===0?0:-1;
      button.append(Dom.element('strong','',sample.title),Dom.element('small','',`${sample.category} · ${sample.tags.join(' / ')}`));
      button.onkeydown=event=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;event.preventDefault();const target=items[event.key==='Home'?0:event.key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,index+(event.key==='ArrowUp'?-1:1)))];this.choose(target);this.list.querySelector(`[data-sample="${target.id}"]`)?.focus();};this.list.append(button);
    }
    if(!items.length)this.list.append(Dom.element('p','','No matching samples.'));
    else if(!items.some(item=>item.id===this.selected?.id)){this.list.firstElementChild.tabIndex=0;}
  }
  choose(sample){
    this.cancelPreview();this.selected=sample;this.title.textContent=sample.title;this.description.textContent=sample.description;this.tags.textContent=sample.tags.join('  ·  ');
    this.addButton.disabled=sample.kind!=='ui';this.addButton.title=this.addButton.disabled?'Open compiler examples as separate projects to preserve Cargo targets':'';
    this.file.replaceChildren();for(const path of Object.keys(sample.files)){const option=Dom.element('option','',path);option.value=path;this.file.append(option);}this.file.value=sample.entry;this.renderSource();this.renderList();this.setMode(sample.kind==='ui'?this.mode:'source');
  }
  renderSource(){const path=this.file.value,text=this.selected?.files[path]??'';if(path.endsWith('.rs'))this.code.innerHTML=SyntaxHighlighter.html(text,path);else this.code.textContent=text;}
  setMode(mode){
    this.mode=mode;this.frame.hidden=mode!=='preview';this.sources.hidden=mode!=='source';this.backend.hidden=mode!=='preview'||this.selected.kind!=='ui';
    this.previewButton.setAttribute('aria-selected',String(mode==='preview'));this.sourceButton.setAttribute('aria-selected',String(mode==='source'));
    this.previewButton.tabIndex=mode==='preview'?0:-1;this.sourceButton.tabIndex=mode==='source'?0:-1;
    if(mode==='preview')void this.preview();else{this.cancelPreview();this.message(`${Object.keys(this.selected.files).length} editable files · ${this.selected.native?'native Cargo required':'source inspection only'}`);}
  }
  cancelPreview(){this.request?.abort();this.generation++;if(this.channel&&!this.channel.disposed)this.channel.reset();this.frame?.removeAttribute('srcdoc');}
  async preview(){
    if(!this.dialog?.open||this.mode!=='preview')return;this.cancelPreview();const sample=this.selected;
    if(sample.kind!=='ui'){this.message('This compiler example runs from the IDE after opening the project. Native examples require an explicit Cargo connection.');return;}
    const generation=this.generation,controller=this.request=new AbortController(),channel=this.channel.channel;this.message('Compiling Rust sample in an isolated worker…');
    try{const project=UIProject.load(sample.files,sample.entry);const result=await this.compiler.compile(sample.files,'ui-compile',{file:sample.entry,entry:project.settings.entry,css:project.css,backend:this.backend.value,maxSteps:project.settings.maxSteps??250000,channel},controller.signal);
      if(controller.signal.aborted||generation!==this.generation||!this.dialog.open)return;this.channel.load(result.html,channel);
    }catch(error){if(!controller.signal.aborted&&generation===this.generation)this.message(error.message,true);}
  }
  install(add){
    try{
      const app=this.app;app.editor.capture();
      const result=SampleProjects.install(app.model,app.projects.store,this.selected,{add,expectedEpoch:this.epoch,expectedRevision:this.revision});
      app.stop(false);if(!add){app.options={};app.cargo.options={};app.editor.clearHistory();app.backend=this.selected.native?'native':'browser';app.$('backend-select').value=app.backend;}
      if(this.selected.kind==='ui')app.studio.open(result.entry);
      app.status(`${this.selected.title} ${add?'added to this project':'opened; previous project archived'}${result.saved?'':' · browser save failed; export a snapshot'}`,result.saved?'success':'error');this.dialog.close();
    }catch(error){this.message(error.message,true);}
  }
  dispose(){this.cancelPreview();this.channel?.dispose();void this.compiler?.close();this.dialog?.remove();this.dialog=null;}
}
