import {Dom} from '../views/Dom.js';
import {DialogService} from '../views/DialogService.js';
import {ProjectStore} from '../model/ProjectStore.js';
import {LocalFolderImporter} from '../services/LocalFolderImporter.js';
import {UIProject} from '../../ui-framework/UIProject.js';
import {UI_SAMPLES, UI_SAMPLE_CSS} from '../../ui-framework/Samples.js';
import {VirtualFileSystem as V} from '../../project/VirtualFileSystem.js';

export const EMPTY_VIEW = 'fn app() -> ui::Node {\n    view! {\n        <main className="app">\n            <h1>New view</h1>\n        </main>\n    }\n}\n';
export const EMPTY_CSS = 'body { margin: 0; font: 16px system-ui, sans-serif; color: #172033; background: #f5f7fb; }\n.app { padding: 32px; }\n';

/** Project/file commands shared by toolbar, tree, tabs and Search Everywhere. */
export class ProjectController {
  constructor(app) { this.app=app; this.model=app.model; this.store=new ProjectStore(this.model); }
  error(error) { this.app.status(error.message,'error'); }
  run(action) { return Promise.resolve().then(action).catch(error=>this.error(error)); }
  guard() { const epoch=this.model.workspaceEpoch,revision=this.model.revision; return ()=>{if(epoch!==this.model.workspaceEpoch||revision!==this.model.revision)throw Error('Workspace changed while the dialog was open; repeat the operation.');}; }
  directory(path) { return this.model.folders.has(path)?path:V.directory(path||'untitled'); }
  menu(path='') {
    const folder=this.directory(path),exists=!!path;
    return [
      {label:'New UI View…',icon:'fit',execute:()=>this.newView(folder)}, {label:'New File…',icon:'file',execute:()=>this.createFile(folder)}, {label:'New Folder…',icon:'folder',execute:()=>this.createFolder(folder)}, null,
      {label:'Open in Right Split',icon:'split',disabled:!Object.hasOwn(this.model.files,path),execute:()=>this.split(path)},
      {label:'Rename / Move…',disabled:!exists,execute:()=>this.rename(path)}, {label:'Duplicate…',disabled:!exists,execute:()=>this.duplicate(path)},
      {label:'Copy Path',disabled:!exists,execute:()=>navigator.clipboard.writeText(path)}, {label:'Delete…',disabled:!exists,icon:'trash',execute:()=>this.remove(path)}
    ];
  }
  split(path,orientation='right') { this.model.open(path); this.app.studio.split(path,orientation); }
  async createFile(folder=this.app.projectView.directory) {
    const check=this.guard(),value=await DialogService.ask({title:'New project file',label:'Project-relative path',value:(folder?folder+'/':'')+'new_module.rs',confirm:'Create file'});
    if(value===null)return; return this.run(()=>{check();this.model.create(value,value.endsWith('.rs')?'// New Rust module\n':'');this.model.save();});
  }
  async createFolder(folder=this.app.projectView.directory) {
    const check=this.guard(),value=await DialogService.ask({title:'New project folder',label:'Project-relative path',value:(folder?folder+'/':'')+'new-folder',confirm:'Create folder'});
    if(value===null)return;return this.run(()=>{check();this.model.createFolder(value);this.app.projectView.reveal(value);this.model.save();});
  }
  async rename(path=this.model.active) {
    if(!path)return;const check=this.guard(),value=await DialogService.ask({title:'Rename / move path',label:'Project-relative path',value:path,message:'Folders move recursively. UI sidecars are updated together. Rust module declarations and Cargo target paths are not rewritten; use semantic refactoring for symbols.',confirm:'Rename'});
    if(value===null||value===path)return;return this.run(()=>{check();this.app.editor.capture();this.model.rename(path,value);this.app.projectView.reveal(value);this.model.save();});
  }
  async duplicate(path) {
    const check=this.guard(),value=await DialogService.ask({title:'Duplicate file or folder',label:'New project-relative path',value:path.replace(/(\.[^/.]+)?$/, '-copy$1'),confirm:'Duplicate'});
    if(value===null)return;return this.run(()=>{check();this.model.movePath(path,value,{copy:true});if(Object.hasOwn(this.model.files,value))this.model.open(value);this.model.save();});
  }
  move(path,target) { return this.run(()=>{this.app.editor.capture();this.model.movePath(path,target);this.model.save();}); }
  async remove(path=this.model.active) {
    if(!path)return;const check=this.guard(),count=Object.keys(this.model.files).filter(file=>file===path||file.startsWith(path+'/')).length;
    const yes=await DialogService.ask({title:'Delete project path?',message:`Delete ${path}${this.model.folders.has(path)?` and ${count} contained files`:''}? This can be undone until newer source edits conflict with the operation.`,input:false,confirm:'Delete',danger:true});
    if(yes)return this.run(()=>{check();this.model.remove(path);this.model.save();});
  }
  form({title,fields,confirm}) {
    return new Promise(resolve=>{
      const dialog=Dom.element('dialog','form-dialog project-dialog'),form=Dom.element('form');form.append(Dom.element('h2','',title));const inputs={};
      for(const spec of fields){const label=Dom.element('label','field-label',spec.label),input=Dom.element(spec.options?'select':'input','text-field');input.setAttribute('aria-label',spec.label);input.required=true;
        if(spec.options)for(const [value,name] of spec.options){const option=Dom.element('option','',name);option.value=value;input.append(option);}input.value=spec.value;inputs[spec.name]=input;label.append(input);form.append(label);}
      const buttons=Dom.element('div','dialog-actions'),ok=Dom.button(confirm,null,{className:'primary-button'});ok.type='submit';buttons.append(Dom.button('Cancel',()=>dialog.close()),ok);form.append(buttons);dialog.append(form);document.body.append(dialog);
      let result=null;form.onsubmit=event=>{event.preventDefault();result=Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value]));dialog.close();};dialog.onclose=()=>{dialog.remove();resolve(result);};dialog.showModal();Object.values(inputs)[0]?.focus();
    });
  }
  async newView(folder=this.app.projectView.directory) {
    const check=this.guard(); const result=await this.form({title:'New UI View',confirm:'Create view',fields:[
      {name:'path',label:'View file path',value:(folder?folder+'/':'src/')+'view.ui.rs'},
      {name:'template',label:'View template',value:'blank',options:[['blank','Blank view'],['counter','Counter'],['form','Form'],['components','Components']]}
    ]});if(!result)return;return this.run(()=>{check();return this.createView(result.path,result.template);});
  }
  createView(path,template='blank') {
    path=V.path(path); if(!path.endsWith('.rs'))throw Error('Use a .ui.rs or .rs view filename');
    const source=template==='blank'?EMPTY_VIEW:UI_SAMPLES[template];if(!source)throw Error('Unknown view template');
    const files={...this.model.files,[path]:source},project=UIProject.load({[path]:source},path,{css:template==='blank'?EMPTY_CSS:UI_SAMPLE_CSS});
    const changes={[path]:source,...project.changes()};for(const file of Object.keys(changes))if(Object.hasOwn(this.model.files,file)||this.model.folders.has(file))throw Error(`Path already exists: ${file}`);
    V.validate(files);this.model.applyWorkspaceTransaction(changes);this.model.setDocumentState(path,{mode:'split'});this.model.open(path);this.model.save();this.app.studio.open(path);return path;
  }
  async newProject() {
    const check=this.guard(),result=await this.form({title:'New Project',confirm:'Create project',fields:[
      {name:'name',label:'Project name',value:'my-app'}, {name:'kind',label:'Project type',value:'ui',options:[['ui','Rust UI application'],['binary','Rust binary'],['library','Rust library']]}
    ]});if(!result)return;return this.run(()=>{
      check();if(!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(result.name))throw Error('Project names must start with a letter and contain up to 64 letters, digits, dashes or underscores');
      this.app.editor.capture();this.store.archive();this.app.stop(false);
      const files={'Cargo.toml':`[package]\nname = "${result.name}"\nversion = "0.1.0"\nedition = "2021"\n`};
      files[result.kind==='library'?'src/lib.rs':'src/main.rs']=result.kind==='library'?'pub fn answer() -> i64 { 42 }\n':'fn main() {\n    println!("Hello, Ferrite!");\n}\n';
      this.model.replace(files);this.model.name=result.name;this.app.options={};this.app.cargo.options={};this.app.backend='browser';this.app.$('backend-select').value='browser';
      if(result.kind==='ui')this.createView('src/app.ui.rs');this.model.save();this.store.archive();this.app.renderWorkspace();
    });
  }
  openFolder() {
    const input=Dom.element('input');input.type='file';input.webkitdirectory=true;input.multiple=true;input.hidden=true;input.setAttribute('aria-label','Open project folder');document.body.append(input);const check=this.guard();
    input.onchange=async()=>{try{if(!input.files.length)return;const result=await LocalFolderImporter.read(input.files);check();this.app.editor.capture();this.store.archive();this.app.stop(false);this.model.replace(result.files);this.app.backend='browser';this.app.$('backend-select').value='browser';this.app.options={};this.app.cargo.options={};this.model.name=input.files[0].webkitRelativePath.split('/')[0];this.model.save();this.app.status(`Opened browser copy of folder · ${result.omitted.length} unsupported files omitted. Use a native repository for disk synchronization.`,'success');}catch(error){this.error(error);}finally{input.remove();}};
    input.oncancel=()=>input.remove();input.click();
  }
  showProjects() {
    const dialog=Dom.element('dialog','form-dialog project-dialog');dialog.setAttribute('aria-label','Projects');dialog.append(Dom.element('h2','','Projects'));
    const buttons=Dom.element('div','project-commands');for(const [label,action] of [['New Project…',()=>this.newProject()],['Open Folder…',()=>this.openFolder()],['Open Repository…',()=>this.app.dock.open('repositories')],['Import Project…',()=>this.app.$('import-input').click()]])buttons.append(Dom.button(label,()=>{dialog.close();action();},{icon:'folder'}));dialog.append(buttons,Dom.element('h3','','Recent projects'));
    const list=Dom.element('div','recent-projects');for(const project of this.store.list())list.append(Dom.button(project.name,()=>{dialog.close();this.run(()=>{this.app.editor.capture();this.app.stop(false);this.store.open(project.id);});},{icon:'cargo',title:project.name}));if(!list.children.length)list.append(Dom.element('p','muted','Projects appear here after creating or switching a project.'));
    dialog.append(list,Dom.button('Close',()=>dialog.close()));dialog.onclose=()=>dialog.remove();document.body.append(dialog);dialog.showModal();
  }
}
