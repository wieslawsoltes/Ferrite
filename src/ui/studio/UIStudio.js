import {Dom} from '../views/Dom.js';
import {PaneSplitter} from '../views/PaneSplitter.js';
import {CodeEditor} from '../views/CodeEditor.js';
import {SelectionModel} from '../model/SelectionModel.js';
import {UIStudioSession} from './UIStudioSession.js';
import {UIProject} from '../../ui-framework/UIProject.js';

/** Document-scoped designer host. Mounted inactive frames retain independent app state. */
export class UIStudio {
  constructor(app) {
    this.app=app; this.model=app.model; this.sessions=new Map(); this.current=null; this.revealing=null; this.syncing=false; this.sourceOwners=new Map();
    const editor=app.$('editor-root'); this.toolbar=Dom.element('div','document-mode-toolbar'); this.toolbar.setAttribute('role','toolbar');this.toolbar.setAttribute('aria-label','Document layout');
    this.workspace=Dom.element('div','document-workspace'); this.designers=Dom.element('div','document-designers'); this.separator=Dom.element('div','pane-splitter document-splitter');
    editor.before(this.toolbar,this.workspace); this.workspace.append(editor,this.separator,this.designers);
    this.modes=new Map();for(const [mode,label] of [['code','Code'],['split','Split'],['design','Design'],['preview','Preview']]){const button=Dom.button(label,()=>this.setMode(mode),{className:'document-mode'});button.dataset.mode=mode;this.modes.set(mode,button);this.toolbar.append(button);}
    this.orientation=Dom.button('Split Down',()=>{const state=this.model.documentState();if(this.model.active)this.model.setDocumentState(this.model.active,{orientation:state.orientation==='down'?'right':'down'});},{icon:'split',className:'document-orientation'});this.toolbar.append(this.orientation);
    this.splitter=new PaneSplitter(this.separator,{label:'Resize code and designer',getValue:()=>this.model.documentState().ratio,setValue:ratio=>{if(this.model.active)this.model.setDocumentState(this.model.active,{ratio});},getOrientation:()=>matchMedia('(max-width:620px)').matches?'down':this.model.documentState().orientation,getBounds:()=>this.workspace.getBoundingClientRect()});
    this.landing=app.panels.get('ui-studio');this.renderLanding();
    this.unsubscribe=this.model.subscribe(event=>{
      if(event.kind==='replace'){this.sourceOwners.clear();this.disposeSessions();this.closeSecondary();}
      if(['files','replace'].includes(event.kind)){
        for(const [path,session] of this.sessions)if(!Object.hasOwn(this.model.files,path)||event.renamed?.[path])this.release(path,session);
        if(this.secondary&&event.renamed?.[this.secondary.path])this.secondary.path=event.renamed[this.secondary.path];
        this.renderLanding();
      }
      if(['open','files','replace','document'].includes(event.kind))this.sync(event.kind==='open'||event.kind==='replace');
    });
    this.sync(true);
  }
  isView(path) { return typeof path==='string'&&path.endsWith('.rs')&&Object.hasOwn(this.model.files,path)&&(this.sessions.has(path)||path.endsWith('.ui.rs')||Object.hasOwn(this.model.files,UIProject.manifestPath(path))||/\bview!\s*[{(]/.test(this.model.files[path])); }
  renderLanding() {
    this.landing.replaceChildren(Dom.element('h3','','UI Views'),Dom.element('p','view-note','Open a view file in Project, then choose Code, Split, Design or Preview above the editor. Each view owns its preview, selection and settings.'),Dom.button('New UI View',()=>this.app.projects.newView(),{icon:'plus'}));
    for(const path of Object.keys(this.model.files).filter(path=>this.isView(path)))this.landing.append(Dom.button(path,()=>this.open(path),{icon:'fit',className:'project-row'}));
  }
  session(path) {
    let session=this.sessions.get(path);if(session)return session;
    this.model.read(path);if(!path.endsWith('.rs'))throw Error('Open a Rust view source');
    const root=Dom.element('div','ui-session');root.hidden=true;this.designers.append(root);
    session=new UIStudioSession(this.app,{root,file:path});this.sessions.set(path,session);
    // Bound dormant workers/iframes while retaining all document/source settings.
    if(this.sessions.size>16)for(const [old,instance] of this.sessions)if(old!==path&&instance!==this.current){this.release(old,instance);break;}
    return session;
  }
  release(path,session) { session.dispose();session.root.remove();this.sessions.delete(path);for(const [source,owner] of this.sourceOwners)if(owner===path)this.sourceOwners.delete(source);if(this.current===session)this.current=null; }
  disposeSessions() { for(const [path,session] of this.sessions)this.release(path,session); }
  ensurePreview(session) {
    if(session.artifact||session.startQueued||session.disposed)return;session.startQueued=true;
    queueMicrotask(async()=>{try{if(!session.disposed&&!session.root.hidden)await session.build();}catch(error){session.error(error);}finally{session.startQueued=false;}});
  }
  sync(build=false) {
    if(this.syncing)return;this.syncing=true;
    try{
      const path=this.model.active,previous=this.current;
      if(path&&this.isView(path)&&!this.model.documentStates.has(path))this.model.setDocumentState(path,{mode:'split'});
      const linked=this.sourceOwners.get(path);const owner=this.revealing??(linked&&this.sessions.has(linked)?this.sessions.get(linked):path&&this.isView(path)?this.session(path):null);this.current=owner;
      for(const [file,session] of this.sessions){session.root.hidden=session!==owner;session.root.classList.toggle('ui-studio',session===owner);if(!this.model.tabs.includes(file)&&session!==owner)this.release(file,session);}
      const state=this.model.documentState(path),mode=owner?state.mode:(this.secondary?'split':'code');
      this.workspace.dataset.mode=mode;this.workspace.dataset.orientation=state.orientation;
      this.workspace.style.setProperty('--document-ratio',state.ratio+'%');this.designers.hidden=!owner||mode==='code';
      this.app.$('editor-root').hidden=!!owner&&['design','preview'].includes(mode);this.separator.hidden=mode!=='split';
      if(owner)owner.root.dataset.mode=mode;
      for(const [value,button] of this.modes){button.disabled=!owner&&value!=='code'&&value!=='split';button.setAttribute('aria-pressed',String(value===mode));}
      this.orientation.hidden=mode!=='split';const orientationLabel=state.orientation==='down'?'Split Right':'Split Down';this.orientation.querySelector('span').textContent=orientationLabel;this.orientation.setAttribute('aria-label',orientationLabel);this.orientation.title=orientationLabel;
      this.splitter.refresh();if(owner&&build&&mode!=='code'){this.ensurePreview(owner);if(owner!==previous)this.focusDocument();}
      if(this.secondary){this.secondary.root.hidden=!!owner;if(!Object.hasOwn(this.model.files,this.secondary.path))this.closeSecondary();else{this.secondary.editor.open(this.secondary.path);this.refreshSecondaryFiles();}}
    }finally{this.syncing=false;}
  }
  focusDocument() { this.app.dock.collapse?.('right');this.app.dock.collapse?.('bottom'); }
  setMode(mode) {
    const path=this.model.active;if(!path)return;
    if(mode==='split'&&!this.isView(path)){this.split(path);return;}
    if(!this.isView(path)&&!this.current){if(mode==='code')this.closeSecondary();return;}
    this.model.setDocumentState(path,{mode});this.sync(mode!=='code');if(mode!=='code')this.focusDocument();this.model.save();
  }
  open(path) {
    path??=this.isView(this.model.active)?this.model.active:Object.keys(this.model.files).find(file=>this.isView(file));
    if(!path){this.app.dock.open('ui-studio');return;}
    this.model.read(path);this.sourceOwners.delete(path);this.model.setDocumentState(path,{mode:this.model.documentState(path).mode==='code'?'split':this.model.documentState(path).mode});
    this.model.open(path);this.focusDocument();this.sync(true);return this.current;
  }
  showSession(session) { this.current=session;this.model.open(session.entryFile);this.model.setDocumentState(session.entryFile,{mode:'split'});this.sync();this.focusDocument(); }
  revealSource(session,action) { this.revealing=session;try{action();this.sourceOwners.set(this.model.active,session.entryFile);if(this.model.documentState().mode==='code')this.model.setDocumentState(this.model.active,{mode:'split'});this.sync();}finally{this.revealing=null;} }
  split(path=this.model.active,orientation='right') {
    if(!path)return;this.model.setDocumentState(path,{mode:'split',orientation});
    if(this.isView(path)){this.open(path);return;}
    if(!this.secondary){
      const root=Dom.element('section','secondary-editor'),bar=Dom.element('div','secondary-toolbar'),select=Dom.element('select'),host=Dom.element('div','editor-root');
      select.setAttribute('aria-label','Split editor file');bar.append(select,Dom.button('Unsplit',()=>{this.closeSecondary();this.sync();},{icon:'close'}));root.append(bar,host);this.workspace.append(root);
      const positions=new Map(),model=this.model,proxy=new Proxy(model,{get(target,key){if(key==='positions')return positions;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
      const selection=new SelectionModel();selection.reset(model.revision);const editor=new CodeEditor(host,proxy,selection);editor.textarea.id='split-source';editor.textarea.setAttribute('aria-label','Split source editor');
      this.secondary={root,select,editor,path};select.onchange=()=>{this.secondary.path=select.value;editor.open(select.value);};
    }else this.secondary.path=path;
    this.secondary.root.hidden=false;this.secondary.editor.open(path);this.refreshSecondaryFiles();this.sync();this.focusDocument();
  }
  refreshSecondaryFiles() {
    const group=this.secondary;if(!group)return;const names=Object.keys(this.model.files).sort();
    if(group.select.options.length!==names.length||[...group.select.options].some((option,i)=>option.value!==names[i])){group.select.replaceChildren();for(const path of names){const option=Dom.element('option','',path);option.value=path;group.select.append(option);}}
    group.select.value=group.path;
  }
  closeSecondary() { if(!this.secondary)return;this.secondary.editor.dispose();this.secondary.root.remove();this.secondary=null;this.sync(); }
  state() { return {...(this.current?.state()??{file:null,entryFile:null,stale:true,snapshot:null}),mode:this.model.documentState().mode,documents:[...this.sessions].map(([file,session])=>({file,stale:!session.artifact,active:session===this.current}))}; }
  async command(command,args={},options={}) {
    if(args.expectedRevision!==undefined&&args.expectedRevision!==this.model.revision)throw Error('Stale IDE revision');
    const path=args.file??this.current?.entryFile??this.model.active;const session=this.session(path);
    if(command==='ui.preview'||command==='ui.native.preview'){this.showSession(session);this.current=session;}
    return session.command(command,args,options);
  }
  dispose() { this.unsubscribe();this.disposeSessions();this.closeSecondary(); }
}
