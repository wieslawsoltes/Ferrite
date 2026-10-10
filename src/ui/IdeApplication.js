import {EditorLanguageController} from './controllers/EditorLanguageController.js';
import {ProjectController} from './controllers/ProjectController.js';
import {UIStudio} from './studio/UIStudio.js';
import {AgentWorkbench} from './agent/AgentWorkbench.js';
import {RepositoryController} from './controllers/RepositoryController.js';
import {RepositoryView} from './views/RepositoryView.js';
import {DependencyView} from './views/DependencyView.js';
import {SearchView} from './views/SearchView.js';
import {LanguageToolsView} from './views/LanguageToolsView.js';
import {NativeArtifactsView} from './views/NativeArtifactsView.js';
import {CargoOptions} from '../cargo/CargoOptions.js';
import {WorkspaceModel} from './model/WorkspaceModel.js';
import {SelectionModel} from './model/SelectionModel.js';
import {SampleCatalog} from './model/SampleCatalog.js';
import {CompilationService} from './services/CompilationService.js';
import {ExecutionService} from './services/ExecutionService.js';
import {NativeCargoClient} from './services/NativeCargoClient.js';
import {NativeDiagnosticMapper} from './services/NativeDiagnosticMapper.js';
import {Dom} from './views/Dom.js';
import {CodeEditor} from './views/CodeEditor.js';
import {ProjectView} from './views/ProjectView.js';
import {TabStrip} from './views/TabStrip.js';
import {DockLayout} from './views/DockLayout.js';
import {InspectorView} from './views/InspectorView.js';
import {ProfileView} from './views/ProfileView.js';
import {DiagnosticsView} from './views/DiagnosticsView.js';
import {DebuggerView} from './views/DebuggerView.js';
import {TestsView} from './views/TestsView.js';
import {CargoView} from './views/CargoView.js';
import {CommandPalette} from './views/CommandPalette.js';
import {DialogService} from './views/DialogService.js';
import {SpanRegistry} from './views/SpanRegistry.js';

/** Composition root: commands coordinate independent model, compiler and presentation services. */
export class IdeApplication {
  constructor(documentRoot=document){
    this.document=documentRoot;this.$=id=>documentRoot.getElementById(id);let storage=null;
    try{storage=window.localStorage;}catch{}this.storage=storage;
    this.model=new WorkspaceModel(SampleCatalog.projects[0].files,{storage});this.model.restore();
    this.selection=new SelectionModel();this.selection.reset(this.model.revision);this.compiler=new CompilationService();
    this.native=new NativeCargoClient();this.execution=new ExecutionService(event=>this.executionEvent(event));
    this.build=null;this.buildRevision=-1;this.requestSerial=0;this.options={};this.backend='browser';this.runMode=null;this.nativeArgs=[];
    this.settings={auto:true,optimize:true};try{Object.assign(this.settings,JSON.parse(storage?.getItem('ferrite.settings.v3')??'{}'));}catch{}
    this.settings.auto=this.settings.auto!==false;this.settings.optimize=this.settings.optimize!==false;
    const definitions=[['ui-studio','Rust UI Studio','fit'],['agent','Coding Agent','code'],['terminal','Terminal','console'],['project','Project','folder'],['structure','Structure','tree'],['search','Find in Files','search'],['cargo','Cargo','cargo'],['repositories','Repositories','folder'],['crates','Crates','cargo'],['compiler','Compiler','code'],['profile','Profile','chart'],['language','Rust tooling','search'],['native-artifacts','Native artifacts','code'],['run','Run','console'],['problems','Problems','warning'],['debugger','Debugger','debug'],['tests','Tests','test']].map(([id,title,icon])=>({id,title,icon,element:Dom.element('div','tool-panel')}));
    this.panels=new Map(definitions.map(d=>[d.id,d.element]));
    this.dock=new DockLayout(this.$('dock-layout'),definitions,{storage});
    this.editor=new CodeEditor(this.$('editor-root'),this.model,this.selection);this.projects=new ProjectController(this);this.tabs=new TabStrip(this.$('document-tabs'),this.model,{onSplit:(path,side)=>this.projects.split(path,side),onReveal:path=>{this.dock.open('project');this.projectView.reveal(path);}});
    const projectHeading=Dom.element('div','project-heading');projectHeading.append(Dom.icon('folder'),Dom.element('span','','Project files'));const filter=Dom.element('input','project-filter');filter.placeholder='Filter files';filter.setAttribute('aria-label','Filter project files');const projectTree=Dom.element('div','project-tree');projectTree.id='project-tree';this.projectView=new ProjectView(projectTree,this.model,{actions:this.projects});
    const projectTools=Dom.element('div','project-tools');for(const [label,icon,action] of [['New UI View','fit',()=>this.projects.newView()],['New Folder','folder',()=>this.projects.createFolder()],['Reveal Active File','fit',()=>{filter.value='';this.projectView.reveal();}],['Collapse All','minus',()=>{this.projectView.collapsed=new Set(this.model.folders);this.projectView.render();}],['Expand All','plus',()=>{this.projectView.collapsed.clear();this.projectView.render();}]])projectTools.append(Dom.button('',action,{icon,title:label,className:'icon-button'}));projectHeading.append(projectTools);filter.oninput=()=>{this.projectView.filter=filter.value;this.projectView.render();};
    this.projectFooter=Dom.element('div','project-footer');this.panels.get('project').append(projectHeading,filter,projectTree,this.projectFooter);
    this.inspector=new InspectorView(this.panels.get('compiler'),this.selection);this.profile=new ProfileView(this.panels.get('profile'),this.selection);
    this.languageTools=new LanguageToolsView(this.panels.get('language'),this.model,this.selection,command=>this.languageCommand(command));
    this.search=new SearchView(this.panels.get('search'),this.model,this.selection);
    this.nativeArtifacts=new NativeArtifactsView(this.panels.get('native-artifacts'),this.selection);
    this.problems=new DiagnosticsView(this.panels.get('problems'),this.selection);this.problems.render([]);
    this.debugger=new DebuggerView(this.panels.get('debugger'),this.selection,command=>this.execution.command(command,this.model.breakpointList));
    this.tests=new TestsView(this.panels.get('tests'),this.selection);this.tests.reset();
    this.repositories=new RepositoryController(this.model,this.native,{onLoaded:()=>{this.backend='native';this.$('backend-select').value='native';this.options={};if(this.cargo)this.cargo.options={};},onChanged:()=>{if(this.nativeRepositoryAttached&&!this.repositories.session){this.backend='browser';this.$('backend-select').value='browser';this.options={};if(this.cargo)this.cargo.options={};}this.nativeRepositoryAttached=!!this.repositories.session;if(this.cargo){this.cargo.repository=this.repositories.session;this.cargo.render();}this.repositoryView?.render();this.dependencyView?.render();},onLog:event=>{if(event.type==='log')this.runOutput.textContent+=event.text??'';}});
    this.repositoryView=new RepositoryView(this.panels.get('repositories'),this.repositories,{onError:error=>this.error(error),onBrowserFolder:result=>{this.stop(false);this.backend='browser';this.$('backend-select').value='browser';this.editor.clearHistory();this.model.replace(result.files);this.model.save();this.status(`Imported local folder: ${result.omitted.length} files omitted from the text-only browser project`,'success');}});
    this.dependencyView=new DependencyView(this.panels.get('crates'),this.repositories,{getPackage:()=>this.options.package??this.cargo?.currentPackage,onError:error=>this.error(error),onResult:result=>{clearTimeout(this.compileTimer);this.writeOutput(result.stdout+result.stderr);this.dock.open('run');this.status(`Cargo dependency edit · exit ${result.exitCode}`,result.exitCode?'error':'success');}});
    this.cargo=new CargoView(this.panels.get('cargo'),this.model,this.native,{onCommand:command=>this.compile(command),onOptions:options=>{this.options=options;this.invalidate();this.schedule();},onConnected:connected=>{if(!connected)this.repositories.detach();this.repositoryView.render();this.dependencyView.render();this.backend=connected?'native':'browser';this.$('backend-select').value=this.backend;this.status(connected?'Connected to the trusted native Cargo toolchain.':'Native bridge disconnected.','success');}});
    this.structureRegistry=new SpanRegistry(this.selection,'structure');this.runOutput=Dom.element('pre','run-output');this.runOutput.id='terminal';this.runOutput.setAttribute('aria-label','Program output');
    this.runLabel=Dom.element('span','','No program running');const runHeader=Dom.element('div','run-header');runHeader.append(Dom.icon('console'),this.runLabel,Dom.button('Clear',()=>{this.runOutput.textContent='';},{className:'subtle-button'}));this.panels.get('run').append(runHeader,this.runOutput);
    this.studio=new UIStudio(this);this.editorLanguage=new EditorLanguageController(this);
    this.agent=new AgentWorkbench(this);
    const stdinForm=Dom.element('form','native-stdin'),stdin=Dom.element('input','text-field');stdin.placeholder='Native stdin (line input; not a PTY)';stdin.setAttribute('aria-label','Native standard input');const send=Dom.button('Send input',null);send.type='submit';stdinForm.append(stdin,send);stdinForm.onsubmit=async event=>{event.preventDefault();try{if(!this.repositories.session)throw Error('Open a native repository to send input');await this.native.sendInput(this.repositories.session.id,stdin.value+'\n');stdin.value='';}catch(error){this.status(error.message,'error');}};this.panels.get('run').append(stdinForm);stdinForm.append(Dom.button('Close stdin',async()=>{try{if(!this.repositories.session)throw Error('Open a native repository first');await this.native.sendInput(this.repositories.session.id,null);}catch(error){this.status(error.message,'error');}},{className:'subtle-button'}));
    this.palette=new CommandPalette(()=>this.commands());this.toolbar(definitions);this.events();
    this.model.subscribe(event=>this.modelChanged(event));this.renderWorkspace();this.cargo.render();this.compile('check');
    // Read-only inspection hook used by browser acceptance tests and embedders.
    Object.defineProperty(window,'ferrite',{value:Object.freeze({version:'0.8.0',getSnapshot:()=>this.model.snapshot(),getBuild:()=>this.build,getRevision:()=>this.model.revision,getSelection:()=>this.selection.value,getUIState:()=>this.studio.state()}),configurable:true});
  }
  toolbar(definitions){
    for(const [command,title,icon] of [['check','Check','check'],['build','Build','build'],['run','Run','run'],['debug','Debug','debug'],['test','Test','test']]){
      const button=Dom.button(title,()=>this.compile(command),{icon,className:`${command}-action ${command==='run'?'primary-run':''}`});button.id=command;button.title=command==='run'?'Run (Ctrl/Cmd+Enter)':command==='debug'?'Debug executable MIR (F5)':`Compile: ${command}`;this.$('run-actions').append(button);
    }
    this.$('stop').append(Dom.icon('stop'));this.$('stop').onclick=()=>this.stop();this.$('layout-reset').append(Dom.icon('reset'));this.$('layout-reset').onclick=()=>this.dock.reset();
    for(const [title,icon,action] of [['Project','cargo',()=>this.projects.newProject()],['Folder','folder',()=>this.projects.openFolder()],['UI View','fit',()=>this.projects.newView()],['New','plus',()=>this.createFile()],['Rename','file',()=>this.renameFile()],['Delete','trash',()=>this.removeFile()],['Save','save',()=>{this.model.save();this.status('Workspace saved in this browser.','success');}],['Import','import',()=>this.$('import-input').click()],['Repository','folder',()=>this.dock.open('repositories')],['Export','export',()=>this.download('ferrite-project.ferrite.json',JSON.stringify(this.model.snapshot(),null,2))]]){
      const button=Dom.button(title,action,{icon});button.id=`file-${title.toLowerCase().replaceAll(' ','-')}`;this.$('file-actions').append(button);
    }
    this.$('auto-check').checked=this.settings.auto;this.$('optimize').checked=this.settings.optimize;
    for(const [id,key] of [['auto-check','auto'],['optimize','optimize']])this.$(id).onchange=()=>{this.settings[key]=this.$(id).checked;try{this.storage?.setItem('ferrite.settings.v3',JSON.stringify(this.settings));}catch{}if(key==='optimize')this.invalidate();if(this.settings.auto)this.schedule();};
    this.$('backend-select').onchange=()=>{this.backend=this.$('backend-select').value;if(this.backend==='native'&&!this.native.capabilities)this.cargo.connect();};
    this.$('search-everywhere').onclick=()=>this.palette.open();this.$('project-menu').onclick=()=>this.projects.showProjects();this.$('native-connect').onclick=()=>this.cargo.connect();
    for(const id of ['project','structure','search','repositories','crates','cargo','problems','debugger','tests','run','terminal','compiler','profile','native-artifacts','language','agent','ui-studio']){const definition=definitions.find(d=>d.id===id);const button=Dom.button('',()=>id==='ui-studio'?this.studio.open():this.dock.toggle(id),{icon:definition.icon,className:'rail-button',title:`${definition.title} tool window`});button.dataset.tool=id;this.$(['compiler','profile','native-artifacts','language','agent','ui-studio'].includes(id)?'right-rail':'left-rail').append(button);}
  }
  events(){
    document.addEventListener('keydown',event=>{
      if(event.defaultPrevented||event.isComposing||event.target.closest('dialog'))return;
      const modifier=event.ctrlKey||event.metaKey,key=event.key.toLowerCase();
      if(modifier&&key==='w'){event.preventDefault();if(this.model.active)this.model.close(this.model.active);}
      else if(modifier&&event.shiftKey&&key==='t'){event.preventDefault();this.model.reopenClosed();}
      else if(event.ctrlKey&&event.key==='Tab'){event.preventDefault();const tabs=this.model.tabs,index=tabs.indexOf(this.model.active);if(tabs.length)this.model.open(tabs[(index+(event.shiftKey?-1:1)+tabs.length)%tabs.length]);}
      else if(modifier&&key==='n'){event.preventDefault();event.shiftKey?this.projects.newProject():this.projects.createFile();}
      else if(modifier&&key==='p'&&!event.shiftKey){event.preventDefault();this.palette.open('Open ');}
      else if(modifier&&['f','h'].includes(key)){event.preventDefault();this.openSearch(!event.shiftKey);}
      else if(modifier&&event.shiftKey&&event.code==='Space'){event.preventDefault();this.languageCommand('signatureHelp');}
      else if(modifier&&event.code==='Space'){event.preventDefault();this.languageCommand('completion');}
      else if(event.key==='F12'||modifier&&key==='b'){event.preventDefault();this.languageCommand('definition');}
      else if(event.shiftKey&&event.key==='F6'){event.preventDefault();this.languageCommand('rename');}
      else if(event.altKey&&event.key==='F7'){event.preventDefault();this.languageCommand('references');}
      else if(modifier&&key==='q'){event.preventDefault();this.languageCommand('hover');}
      else if(modifier&&event.shiftKey&&key==='p'){event.preventDefault();this.palette.open();}
      else if(modifier&&key==='s'){event.preventDefault();this.model.save();this.status('Workspace saved.','success');}
      else if(modifier&&event.key==='Enter'){event.preventDefault();this.compile('run');}
      else if(event.key==='F5'){event.preventDefault();if(this.execution.worker)this.execution.command('continue',this.model.breakpointList);else this.compile('debug');}
      else if(event.key==='F10'){event.preventDefault();this.execution.command('step-line');}
      else if(event.key==='F11'){event.preventDefault();this.execution.command('step');}
      else if(event.altKey&&event.key==='1'){event.preventDefault();this.dock.toggle('project');}
    });
    this.$('editor-root').addEventListener('editor-position',e=>{this.$('source-position').textContent=`${e.detail.line}:${e.detail.column}`;});
    this.$('import-input').onchange=async()=>{const file=this.$('import-input').files[0];this.$('import-input').value='';if(!file)return;try{if(file.size>12*1024*1024)throw Error('Snapshot exceeds 12 MiB');const snapshot=JSON.parse(await file.text());if(snapshot.format&&snapshot.format!=='ferrite-project-v1')throw Error('Unknown snapshot format');this.stop(false);this.editor.clearHistory();this.projects.store.archive();this.model.loadWorkspace(snapshot);this.model.save();this.status('Project imported.','success');}catch(error){this.error(error);}};
    window.addEventListener('beforeunload',()=>{clearTimeout(this.saveTimer);this.model.save();});
  }
  commands(){return [
    {label:'New Project',icon:'cargo',execute:()=>this.projects.newProject()},
    {label:'Open Folder',icon:'folder',execute:()=>this.projects.openFolder()},
    {label:'Recent Projects',icon:'folder',execute:()=>this.projects.showProjects()},
    {label:'New UI View',icon:'fit',execute:()=>this.projects.newView()},
    {label:'New Folder',icon:'folder',execute:()=>this.projects.createFolder()},
    {label:'Undo file or workspace operation',icon:'reset',execute:()=>this.projects.run(()=>{this.model.undoTransaction();this.model.save();})},
    {label:'Reopen Closed Tab',icon:'file',execute:()=>this.model.reopenClosed()},
    {label:'Split Editor Right',icon:'split',execute:()=>this.studio.split()},
    {label:'Split Editor Down',icon:'split',execute:()=>this.studio.split(this.model.active,'down')},
    ...['code','split','design','preview'].map(mode=>({label:`View: ${mode}`,icon:'fit',execute:()=>this.studio.setMode(mode)})),
    ...['check','build','run','debug','test'].map(command=>({label:`${command[0].toUpperCase()+command.slice(1)} current project`,icon:command==='run'?'run':'code',execute:()=>this.compile(command)})),
    {label:'Open Git repository or local Cargo directory',icon:'folder',execute:()=>this.dock.open('repositories')},
    {label:'Add remote or local Cargo crate',icon:'cargo',execute:()=>this.dock.open('crates')},
    {label:'Find in Files',icon:'search',execute:()=>this.openSearch(false)},
    {label:'Replace in Files',icon:'search',execute:()=>this.openSearch(false)},
    {label:'New project file',icon:'plus',execute:()=>this.createFile()},{label:'Rename current file',icon:'file',execute:()=>this.renameFile()},
    {label:'Reset docking layout',icon:'reset',execute:()=>this.dock.reset()},{label:'Connect native Cargo',icon:'connect',execute:()=>this.cargo.connect()},
    ...['completion','definition','references','hover','rename','documentSymbol','signatureHelp'].map(command=>({label:'Rust semantic '+command,icon:'search',execute:()=>this.languageCommand(command)})),
    {label:'Inspect native MIR, LLVM IR, assembly and object',icon:'code',execute:()=>this.compile('inspect')},
    {label:'Native Cargo arguments (JSON array)',icon:'cargo',execute:()=>this.configureArguments()},
    ...this.dock.definitions.map(panel=>({label:`Show ${panel.title} tool window`,icon:panel.icon,execute:()=>panel.id==='ui-studio'?this.studio.open():this.dock.open(panel.id)})),
    ...Object.keys(this.model.files).map(path=>({label:`Open ${path}`,icon:'file',execute:()=>this.model.open(path)})),
    ...(this.build?.stages??[]).map(stage=>({label:`Inspect ${stage.name}`,icon:'code',execute:()=>{this.dock.open('compiler');this.inspector.showStage(stage.name);}})),
    ...SampleCatalog.projects.map(sample=>({label:`Example: ${sample.name}`,icon:'cargo',execute:()=>this.chooseSample(sample.name)}))
  ];}
  modelChanged(event){
    if(event.kind==='document'){clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.model.save(),500);}
    else if(event.kind==='edit'){
      this.tabs.render();this.projectView.render();this.invalidate();this.schedule();clearTimeout(this.saveTimer);this.saveTimer=setTimeout(()=>this.model.save(),800);
    }else if(['files','replace'].includes(event.kind)){if(event.kind==='replace'||!Object.hasOwn(this.model.files,this.projectView.selected)&&!this.model.folders.has(this.projectView.selected))this.projectView.selected=this.model.active;this.renderWorkspace();this.cargo.render();this.invalidate();if(!event.native)this.schedule();}
    else if(event.kind==='open'){this.projectView.selected=this.model.active;this.renderWorkspace();}else if(event.kind==='saved'){this.tabs.render();this.projectView.render();}
    else if(event.kind==='storage-error')this.status('Browser storage could not save this workspace. Export a snapshot.','error');
  }
  renderWorkspace(){this.tabs.render();this.projectView.render();this.editor.open(this.model.active);this.$('active-path').textContent=this.model.active??'No file open';this.$('editor-language').textContent=this.model.active?.endsWith('.rs')?'Rust':this.model.active?.endsWith('.toml')?'TOML':'Text';this.projectFooter.textContent=`${Object.keys(this.model.files).length} files · ${this.model.folders.size} folders · ${this.repositories.session?'native checkout (sync on command)':'browser workspace'}`;const manifest=this.model.files[this.repositories.session?.manifest??'Cargo.toml']??'';this.$('project-name').textContent=this.model.name||/^name\s*=\s*"([^"]+)"/m.exec(manifest)?.[1]||'Cargo workspace';}
  invalidate(){this.languageTools.invalidate();this.native.languageActive?.abort();this.nativeArtifacts.invalidate();this.profile.invalidate();this.buildRevision=-1;this.selection.reset(this.model.revision);if(this.build)this.inspector.invalidate();this.execution.stop(false);this.debugger.render(null);this.structureRegistry.clear();Dom.empty(this.panels.get('structure'),'Compile the current source to refresh symbols.');this.status('Modified · compiler results are stale','');}
  schedule(){clearTimeout(this.compileTimer);if(this.backend==='native'&&this.native.active){this.nativeCheckPending=this.settings.auto;return;}if(this.settings.auto)this.compileTimer=setTimeout(()=>this.compile('check'),260);}
  async chooseSample(name){const sample=SampleCatalog.projects.find(s=>s.name===name);if(!sample)return;try{this.projects.store.archive();}catch(error){this.projects.error(error);return;}this.stop(false);this.options={};this.cargo.options={};this.editor.clearHistory();this.model.replace(sample.files);this.model.save();this.backend=sample.native?'native':'browser';this.$('backend-select').value=this.backend;if(sample.native){clearTimeout(this.compileTimer);this.status('This example uses full Rust; connect Native Cargo to compile it.','');this.dock.open('cargo');}else await this.compile('check');}
  async compile(command='check'){
    clearTimeout(this.compileTimer);if(this.backend==='native'&&this.native.active){if(command==='check')this.nativeCheckPending=true;else this.status('Stop the current native operation before starting another.','');return;}const serial=++this.requestSerial,revision=this.model.revision;
    if(this.backend==='native'||!['check','build','run','debug','test'].includes(command))return this.nativeCommand(command,serial,revision);
    this.execution.stop(false);this.status(`Compiling ${command}…`,'busy');this.$('status').dataset.command=command;
    try{
      const result=await this.compiler.request(this.model.files,command==='test'?'test':'check',{...this.options,optimize:this.settings.optimize},revision);
      if(serial!==this.requestSerial||result.revision!==this.model.revision)return;
      this.build=result.build;this.buildRevision=revision;this.selection.reset(revision);this.inspector.setBuild(this.build);this.profile.render(this.build);this.problems.render(this.build.diagnostics??[]);this.renderStructure();this.cargo.render();
      this.status(`${this.build.cacheHit?'Cache hit':'Compiled'} · ${this.build.elapsedMs.toFixed(2)} ms · ${this.build.sem.instances.length} instances · ${this.build.cache.reusedFiles} files reused`,'success');
      if(command==='build'&&this.backend==='wasm'){this.download('ferrite.wasm',new Uint8Array(this.build.wasm.bytes),'application/wasm');this.writeOutput('Build succeeded. Real WebAssembly downloaded. This module requires the Ferrite checked host ABI (WebAssemblyRuntime); it is not a WASI executable.');}
      else if(command==='build'){this.download('ferrite-generated.mjs',`const postMessage = text => process.stdout.write(String(text));\n${this.build.js}`,'text/javascript');this.writeOutput('Build succeeded. Generated JavaScript downloaded as ferrite-generated.mjs.\nRun with Node.js 20+; this is not a native executable.');}
      else if(['run','debug','test'].includes(command)){
        this.runMode=command;this.writeOutput('');this.runLabel.textContent=command==='debug'?'Executable MIR debugger':this.backend==='wasm'?'WebAssembly execution · checked host ABI':'Ferrite MIR execution';
        if(command==='test'){this.tests.reset();this.dock.open('tests');}
        else if(command==='debug')this.dock.open('debugger');else this.dock.open('run');
        if(command!=='test'&&!this.build.entry){this.writeOutput('Library target checked successfully. Select a binary target to run.');return;}
        this.execution.start(this.build,command,this.model.breakpointList,this.backend);
      }
    }catch(error){if(error.name==='AbortError')return;if(serial===this.requestSerial&&revision===this.model.revision){this.buildRevision=-1;this.inspector.invalidate();this.error(error);}}
  }
  async languageCommand(command){return this.editorLanguage.command(command);}
  async nativeCommand(command,serial,revision){
    if(command==='debug'){this.error(Error('The browser debugger operates on Ferrite MIR. Native debugger integration is not implemented.'));return;}
    if(!this.native.capabilities){this.status('Connect the trusted native Cargo bridge to run this command.','error');this.dock.open('cargo');return;}
    this.compiler.cancel();this.execution.stop(false);this.runLabel.textContent=`Native Cargo · ${command}`;this.writeOutput('');this.dock.open('run');this.status(`Native cargo ${command}…`,'busy');
    const effectiveOptions=this.repositories.session?{...this.options,package:this.options.package??this.cargo.currentPackage,target:this.options.target??this.cargo.currentTarget?.name,targetKind:this.options.targetKind??this.cargo.currentTarget?.kind}:this.options;
    try{
      const args=[...this.nativeArgs,...CargoOptions.arguments(command,effectiveOptions)];
      const nativeOptions={args,json:true,offline:!!this.options.offline,locked:!!this.options.locked,jobs:this.options.jobs||undefined,toolchain:this.options.toolchain||'',timeoutMs:(this.options.timeoutSeconds||120)*1000};
      const result=await (this.repositories.session?this.repositories.run(command,nativeOptions,event=>this.nativeLog(event)):this.native.run(this.model.files,command,nativeOptions,event=>this.nativeLog(event)));
      /* native logs are streamed by nativeLog; repository reconciliation is handled independently of editor revision. */
      if(this.repositories.session){this.cargo.repository=this.repositories.session;this.cargo.render();}

      if(serial!==this.requestSerial||(revision!==this.model.revision&&(!result.repository||result.ideHadConcurrentEdits)))return;
      const diagnostics=(result.diagnostics??[]).map(d=>NativeDiagnosticMapper.map(d,this.model.files,{root:result.sourceRoot,cwd:result.workingDirectory}));this.selection.reset(this.model.revision);this.problems.render(diagnostics);
      if(result.exitCode!==0)this.dock.open('problems');
      this.status(`Native cargo ${command} · exit ${result.exitCode} · ${result.elapsedMs?.toFixed(0)??'?'} ms`,result.exitCode===0?'success':'error');
      if(!this.runOutput.textContent)this.writeOutput(result.stdout+result.stderr);
      if(result.artifacts?.length){this.runOutput.textContent+='\nArtifacts:\n'+result.artifacts.map(a=>a.executable??a.filenames.join('\n')).join('\n')+'\n';}
      const changed=Object.entries(this.repositories.session?{}:(result.files??{})).filter(([path,text])=>typeof text==='string'&&text!==this.model.files[path]);
      if(changed.length){clearTimeout(this.compileTimer);this.model.applyFiles(Object.fromEntries(changed));clearTimeout(this.compileTimer);this.editor.open(this.model.active);this.model.save();this.status(`Native cargo ${command} · exit ${result.exitCode} · ${changed.length} generated/updated files synchronized`,result.exitCode===0?'success':'error');}
      if(result.buildSummary)this.profile.native(result);
      if(command==='inspect'){this.nativeArtifacts.update(result.compilerArtifacts);this.dock.open('native-artifacts');}
    }catch(error){if(error.name!=='AbortError'&&serial===this.requestSerial&&revision===this.model.revision)this.error(error);}
    finally{this.repositoryView.render();this.dependencyView.render();if(this.nativeCheckPending&&!this.repositories.needsReload){this.nativeCheckPending=false;this.schedule();}}
  }
  nativeLog(event){if(event.type==='log'){this.runOutput.textContent+=event.text??event.data??'';this.runOutput.scrollTop=this.runOutput.scrollHeight;}}
  renderStructure(){const root=this.panels.get('structure');this.structureRegistry.clear();root.replaceChildren();for(const item of this.build.sem.symbols){const row=Dom.button(item.name,null,{icon:item.kind==='fn'?'code':'tree',className:'project-row'});row.append(Dom.element('small','muted',item.kind));this.structureRegistry.bind(row,item.span);root.append(row);}}
  executionEvent(event){
    this.lastExecutionEvent={...event,generation:this.execution.generation};this.executionEventSerial=(this.executionEventSerial??0)+1;
    if(event.type==='output')this.writeOutput(event.text);
    else if(event.type==='paused'||event.type==='done'){
      this.debugger.render(event.state);if(event.type==='paused'){this.status(`Paused · ${event.state.steps} instructions`,'');this.dock.open('debugger');const span=event.state.next??event.state.last?.span;if(span)this.selection.select(span,'debugger');}
      else{this.writeOutput(event.state.output);this.runLabel.textContent=`Process finished · ${event.state.steps.toLocaleString()} ${event.state.backend==='wasm'?'WebAssembly-lowered':'MIR'} instructions`;this.status('Process finished successfully','success');}
    }else if(event.type==='test')this.tests.append(event.result);
    else if(event.type==='tests-done'){const failures=event.results.filter(r=>r.status==='failed').length;this.status(`${event.results.length} tests · ${failures} failed`,failures?'error':'success');}
    else if(event.type==='error')this.error(event);else if(event.type==='stopped')this.status('Execution stopped','');
  }
  writeOutput(text){this.runOutput.classList.remove('error');this.runOutput.textContent=text;this.runOutput.scrollTop=this.runOutput.scrollHeight;}
  error(error){const diagnostic=error.toJSON?.()??{code:error.code??'ERROR',message:error.message??String(error),span:error.span??null,notes:error.notes??[]};this.status(`${diagnostic.code} · ${diagnostic.message}`,'error');this.problems.render([diagnostic]);this.dock.open('problems');this.runOutput.textContent=`${diagnostic.code}: ${diagnostic.message}\n${Dom.sourceLabel(diagnostic.span)}`;this.runOutput.classList.add('error');}
  stop(notify=true){this.nativeCheckPending=false;clearTimeout(this.compileTimer);this.requestSerial++;this.compiler.cancel();this.execution.stop(false);this.native.cancel().catch(()=>{});if(notify)this.status('Stopped','');}
  status(message,kind=''){const node=this.$('status');node.textContent=message;node.dataset.kind=kind;}
  openSearch(currentFile=false){const input=this.editor.textarea,text=input.value.slice(input.selectionStart,input.selectionEnd);this.dock.open('search');this.search.open(text.length<=1024?text:'',currentFile);}
  createFile(){return this.projects.createFile();}
  renameFile(){return this.projects.rename(this.projectView.selected??this.model.active);}
  removeFile(){return this.projects.remove(this.projectView.selected??this.model.active);}
  async configureArguments(){const value=await DialogService.ask({title:'Native Cargo arguments',label:'JSON array of arguments (no shell)',value:JSON.stringify(this.nativeArgs),message:'Arguments are sent to the trusted local Cargo process without a shell. Example: ["--release", "--all-features"].'});if(value!==null)try{const args=JSON.parse(value);if(!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('Expected a JSON string array');this.nativeArgs=args;this.status('Native Cargo arguments updated.','success');}catch(error){this.error(error);}}
  download(name,text,type='application/json'){const url=URL.createObjectURL(new Blob([text],{type}));const anchor=Dom.element('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
}
