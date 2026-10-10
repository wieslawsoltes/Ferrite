import {Dom} from '../views/Dom.js';
import {UIProject} from '../../ui-framework/UIProject.js';
import {UIStudioSession} from './UIStudioSession.js';
/** Workbench operations; the owning UIStudio controls document and editor lifetimes. */
export const StudioDocuments = {
  isView(path) { return typeof path==='string'&&path.endsWith('.rs')&&Object.hasOwn(this.model.files,path)&&(this.sessions.has(path)||path.endsWith('.ui.rs')||Object.hasOwn(this.model.files,UIProject.manifestPath(path))||/\bview!\s*[{(]/.test(this.model.files[path])); },
  renderLanding() {
    this.landing.replaceChildren(Dom.element('h3','','UI Views'),Dom.element('p','view-note','Open a view file in Project, then choose Code, Split, Design or Preview above the editor. Each view owns its preview, selection and settings.'),Dom.button('New UI View',()=>this.app.projects.newView(),{icon:'plus'}));
    for(const path of Object.keys(this.model.files).filter(path=>this.isView(path)))this.landing.append(Dom.button(path,()=>this.open(path),{icon:'fit',className:'project-row'}));
  },
  session(path) {
    let session=this.sessions.get(path);if(session)return session;
    this.model.read(path);if(!path.endsWith('.rs'))throw Error('Open a Rust view source');
    const root=Dom.element('div','ui-session');root.hidden=true;this.designers.append(root);
    session=new UIStudioSession(this.app,{root,file:path});this.sessions.set(path,session);
    // Bound dormant workers/iframes while retaining all document/source settings.
    if(this.sessions.size>16)for(const [old,instance] of this.sessions)if(old!==path&&instance!==this.current){this.release(old,instance);break;}
    return session;
  },
  release(path,session) { session.dispose();session.root.remove();this.sessions.delete(path);for(const [source,owner] of this.sourceOwners)if(owner===path)this.sourceOwners.delete(source);if(this.current===session)this.current=null; },
  disposeSessions() { for(const [path,session] of this.sessions)this.release(path,session); },
  ensurePreview(session) {
    if(session.artifact){session.publishInspection();return;}
    if (session.startQueued || session.disposed || session.buildingGeneration != null) return;
    const generation = session.generation; session.startQueued = true;
    queueMicrotask(async () => {
      try {
        // Showing a document can queue this before an explicit agent/user preview starts.
        // Never let that older automatic request abort the newer build or replace native output.
        if (!session.disposed && !session.root.hidden && !session.artifact &&
            session.buildingGeneration == null && session.generation === generation) await session.build();
      } catch (error) { session.error(error); }
      finally { session.startQueued = false; }
    });
  },
  focusDocument() { /* Opening a document must not hide the user's compiler or output tools. */ },
  open(path) {
    path??=this.isView(this.model.active)?this.model.active:Object.keys(this.model.files).find(file=>this.isView(file));
    if(!path){this.app.dock.open('ui-studio');return;}
    this.model.read(path);this.sourceOwners.delete(path);this.model.setDocumentState(path,{mode:this.model.documentState(path).mode==='code'?'split':this.model.documentState(path).mode});
    this.model.open(path);this.focusDocument();this.sync(true);return this.current;
  },
  showSession(session) { this.current=session;this.model.open(session.entryFile);this.model.setDocumentState(session.entryFile,{mode:'split'});this.sync();this.focusDocument(); },
  revealSource(session,action) { this.revealing=session;try{action();this.sourceOwners.set(this.model.active,session.entryFile);if(this.model.documentState().mode==='code')this.model.setDocumentState(this.model.active,{mode:'split'});this.sync();}finally{this.revealing=null;} }
};
