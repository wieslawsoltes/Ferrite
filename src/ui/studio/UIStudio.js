import {Dom} from '../views/Dom.js';
import {PaneSplitter} from '../views/PaneSplitter.js';
import {StudioSecondaryEditor} from './StudioSecondaryEditor.js';
import {StudioDocuments} from './StudioDocuments.js';

/** Document workbench; designer sessions and secondary editors have explicit lifetimes. */
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
      for(const session of this.sessions.values())session.setPresentation(session===owner&&mode!=='code',session===owner?mode:session.root.dataset.mode);
      for(const [value,button] of this.modes){button.disabled=!owner&&value!=='code'&&value!=='split';button.setAttribute('aria-pressed',String(value===mode));}
      this.orientation.hidden=mode!=='split';const orientationLabel=state.orientation==='down'?'Split Right':'Split Down';this.orientation.querySelector('span').textContent=orientationLabel;this.orientation.setAttribute('aria-label',orientationLabel);this.orientation.title=orientationLabel;
      this.splitter.refresh();if(owner&&build&&mode!=='code'){this.ensurePreview(owner);if(owner!==previous)this.focusDocument();}
      if(this.secondary){this.secondary.root.hidden=!!owner;if(!Object.hasOwn(this.model.files,this.secondary.path))this.closeSecondary();else{this.secondary.editor.open(this.secondary.path);this.refreshSecondaryFiles();}}
    }finally{this.syncing=false;}
  }
  setMode(mode) {
    const path=this.model.active;if(!path)return;
    if(mode==='split'&&!this.isView(path)){this.split(path);return;}
    if(!this.isView(path)&&!this.current){if(mode==='code')this.closeSecondary();return;}
    this.model.setDocumentState(path,{mode});this.sync(mode!=='code');if(mode!=='code')this.focusDocument();this.model.save();
  }
  state() { return {...(this.current?.state()??{file:null,entryFile:null,stale:true,snapshot:null}),mode:this.model.documentState().mode,documents:[...this.sessions].map(([file,session])=>({file,stale:!session.artifact,active:session===this.current}))}; }
  async command(command,args={},options={}) {
    if(args.expectedRevision!==undefined&&args.expectedRevision!==this.model.revision)throw Error('Stale IDE revision');
    const path=args.file??this.current?.entryFile??this.model.active;const session=this.session(path);
    if(command==='ui.preview'||command==='ui.native.preview'){this.showSession(session);this.current=session;}
    return session.command(command,args,options);
  }
  dispose() { this.unsubscribe();this.disposeSessions();this.closeSecondary(); }
}

Object.assign(UIStudio.prototype, StudioDocuments, StudioSecondaryEditor);
