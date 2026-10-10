import test from 'node:test';
import assert from 'node:assert/strict';
import {SampleProjects} from '../src/ui/model/SampleProjects.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {ProjectStore} from '../src/ui/model/ProjectStore.js';
import {UIProject} from '../src/ui-framework/UIProject.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {UICompiler} from '../src/ui-framework/UICompiler.js';
import {UISession} from '../src/ui-framework/UISession.js';
import {createUIRuntime} from '../src/ui-framework/Runtime.js';
import {createDocument,elements} from './fixtures/ui-dom.js';

const sample=SampleProjects.find('7guis-cells');
test('sample catalog is discoverable by task/category/tags without modifying its source',()=>{
  assert.equal(SampleProjects.search('','7GUIs').length,7);assert.equal(SampleProjects.search('spreadsheet','7GUIs')[0],sample);
  assert.ok(SampleProjects.search('','Native Rust').length);assert.throws(()=>SampleProjects.find('../bad'));
  for(const item of SampleProjects.search('','7GUIs')){const p=UIProject.load(item.files,item.entry);assert.equal(p.settings.maxSteps,item.maxSteps);}
});
test('adding samples preserves all existing files, relocates sidecars and is undoable',()=>{
  const model=new WorkspaceModel({'src/main.rs':'fn main() {}'}),store=new ProjectStore(model),original={...model.files};
  const one=SampleProjects.install(model,store,sample,{add:true});assert.equal(model.files['src/main.rs'],original['src/main.rs']);
  const first=UIProject.load(model.files,one.entry);assert.equal(first.settings.stylesheet,'samples/7guis/cells/src/main.ui.css');assert.ok(model.files[first.settings.stylesheet]);
  const two=SampleProjects.install(model,store,sample,{add:true});assert.notEqual(one.entry,two.entry);assert.ok(two.entry.includes('cells-2'));
  assert.equal(model.undoTransaction(),true);assert.ok(!Object.hasOwn(model.files,two.entry));assert.ok(Object.hasOwn(model.files,one.entry));assert.equal(model.undoTransaction(),true);assert.deepEqual({...model.files},original);
});
test('empty directories count as occupied and parent files block installs atomically',()=>{
  const model=new WorkspaceModel({samples:'not a directory'}),store=new ProjectStore(model),before=model.workspaceData();
  assert.throws(()=>SampleProjects.install(model,store,sample,{add:true}),/blocks directory/);assert.deepEqual(model.workspaceData(),before);
  const result=SampleProjects.plan(sample,{'src/main.rs':''},['samples/7guis/cells']);assert.ok(result.entry.includes('cells-2'));
});
test('new project is archived before replacement; quota failure and stale leases never discard source',()=>{
  const model=new WorkspaceModel({'src/main.rs':'user edits'}),store=new ProjectStore(model),id=model.workspaceId;
  SampleProjects.install(model,store,sample);assert.equal(model.name,'Cells');store.open(id);assert.equal(model.files['src/main.rs'],'user edits');
  const broken=new ProjectStore(model,{getItem:()=>null,setItem:()=>{throw Error('Quota exceeded');}}),before=model.workspaceData();
  assert.throws(()=>SampleProjects.install(model,broken,sample),/Quota/);assert.deepEqual(model.workspaceData(),before);
  assert.throws(()=>SampleProjects.install(model,store,sample,{expectedRevision:-1}),/Workspace changed/);assert.deepEqual(model.workspaceData(),before);
});
test('large render budget is explicit, bounded, persisted and used by worker exports',()=>{
  const project=UIProject.load(sample.files,sample.entry);
  for(const maxSteps of [0,NaN,Infinity,2_000_001,1.5])assert.throws(()=>project.changes({maxSteps}),/budget/);
  const operation=new CompilerOperation(),result=operation.perform(sample.files,'ui-compile',{file:sample.entry,maxSteps:2_000_000});assert.equal(result.artifact.maxSteps,2_000_000);
  assert.throws(()=>operation.perform(sample.files,'ui-compile',{file:sample.entry,maxSteps:2_000_001}),/budget/);
});
for(const backend of ['javascript','mir','wasm'])test(`${backend}: owned component props are cloned on subsequent renders`,()=>{
  const artifact=UICompiler.compile(`#[derive(Clone)] struct Props {name:String} fn Child(p:Props)->ui::Node {view!{<p>{p.name.clone()}</p>}} fn app()->ui::Node {let count=ui::use_state(0);view!{<section><Child props={Props{name:String::from("owned")}}/><button on:click={move ||ui::set(count,ui::get(count)+1)}>{ui::get(count)}</button></section>}}`);
  const runtime=createUIRuntime(),container=createDocument().createElement('main'),session=new UISession(artifact,{backend,runtime}).mount(container);
  try{elements(container,'button')[0].dispatchEvent(new Event('click'));runtime.flushSync();assert.equal(elements(container,'button')[0].textContent,'1');assert.equal(elements(container,'p')[0].textContent,'owned');}finally{session.dispose();}
});
