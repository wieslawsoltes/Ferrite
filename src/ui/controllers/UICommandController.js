import {BrowserCompiler} from '../../agent/browser/BrowserCompiler.js';
import {UIProject} from '../../ui-framework/UIProject.js';

/** Main IDE Run/Build/Check targets the selected UI document, not a fictional Rust main. */
export class UICommandController {
  constructor(app){this.app=app;this.compiler=new BrowserCompiler();this.generation=0;}
  entry(){
    const {model,studio}=this.app,path=model.active;
    const linked=studio.sourceOwners.get(path);
    if(linked&&Object.hasOwn(model.files,linked))return linked;
    if(studio.isView(path))return path;
    // A helper in a standalone UI project inherits its sole explicit entry manifest.
    if(!Object.hasOwn(model.files,'Cargo.toml')){
      const entries=Object.keys(model.files).filter(file=>file.endsWith('.ui.rs'));
      if(entries.length===1)return entries[0];
    }
    return null;
  }
  cancel(){this.generation++;this.request?.abort();this.checkRequest?.abort();}
  async run(command,file){
    if(command==='check')this.checkRequest?.abort();else this.cancel();const app=this.app,model=app.model,epoch=model.workspaceEpoch,revision=model.revision,generation=this.generation;
    const controller=new AbortController();if(command==='check')this.checkRequest=controller;else this.request=controller;const live=()=>!controller.signal.aborted&&generation===this.generation&&epoch===model.workspaceEpoch;const current=()=>live()&&revision===model.revision;
    try{
      if(command==='test'){app.status('UI view selected. Run previews it; the sample regression suites are npm tests, not Cargo test targets.','');return;}
      const project=UIProject.load(model.files,file),options={file,entry:project.settings.entry,css:project.css,backend:app.backend==='wasm'?'wasm':project.settings.backend,maxSteps:project.settings.maxSteps??250000};
      if(command==='check'){
        app.status('Checking Rust UI source…','busy');
        const result=await this.compiler.compile(model.files,'ui-analyze',options,controller.signal);
        if(current()){app.problems.render(result.diagnostics??[]);app.status('Rust UI source checked · preview state unchanged','success');}
      }else if(command==='build'){
        const result=await this.compiler.compile(model.files,'ui-export',options,controller.signal);
        if(current()){app.download(file.split('/').pop().replace(/\.rs$/,'.html'),result.html,'text/html;charset=utf-8');app.status('Standalone Rust UI HTML exported','success');}
      }else{
        const session=app.studio.session(file);session.backend=options.backend;session.backendSelect.value=options.backend;
        // Avoid a second queued automatic preview; this command owns the build.
        session.armOnReady=command==='debug';session.startQueued=true;try{app.studio.showSession(session);await session.build({signal:controller.signal});}finally{session.startQueued=false;}
        if(live()&&this.entry()===file){
          if(command==='debug')session.dock.open('debug');
          app.status('Rust UI preview loading','success');
        }
      }
    }catch(error){if((['check','build'].includes(command)?current():live()&&this.entry()===file)&&error.name!=='AbortError')app.error(error);}
  }
  dispose(){this.cancel();void this.compiler.close();}
}
