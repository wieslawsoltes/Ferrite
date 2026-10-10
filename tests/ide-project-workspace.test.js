import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {ProjectStore} from '../src/ui/model/ProjectStore.js';
import {UIProject} from '../src/ui-framework/UIProject.js';
const base = {'Cargo.toml': '[package]\nname="project"', 'src/main.rs': 'fn main() {}', 'src/other.rs': '// other'};
const memory = () => { const map = new Map(); return {getItem: key => map.get(key) ?? null, setItem: (key,value) => map.set(key,value)}; };

test('folders survive empty creation, export/import and browser restore', () => {
  const storage = memory(), model = new WorkspaceModel(base, {storage});
  model.createFolder('src/views/empty'); model.save(); const other = new WorkspaceModel(base, {storage}); assert(other.restore());
  assert(other.folders.has('src/views/empty')); other.loadWorkspace(model.snapshot()); assert(other.folders.has('src/views'));
});
test('folder rename is one revision, preserves document state and is undoable', () => {
  const model = new WorkspaceModel(base); model.open('src/other.rs'); model.pin('src/other.rs'); model.setDocumentState('src/other.rs', {mode:'split'});
  model.toggleBreakpoint('src/other.rs',1); model.positions.set('src/other.rs',{start:2,end:2,top:0,left:0}); model.createFolder('src/empty'); const rev = model.revision;
  let event; model.subscribe(value => { event = value; }); model.movePath('src','code');
  assert.equal(model.revision, rev+1); assert.equal(model.active,'code/other.rs'); assert(model.pinned.has('code/other.rs')); assert(model.breakpoints.get('code/other.rs').has(1));
  assert.equal(model.documentState().mode,'split'); assert.equal(model.positions.get(model.active).start,2); assert(model.folders.has('code/empty'));
  assert.equal(event.renamed['src/main.rs'],'code/main.rs'); assert(model.undoTransaction()); assert.equal(model.active,'src/other.rs'); assert.equal(model.read('src/main.rs'),base['src/main.rs']);
});
test('collision, cyclic moves, file-as-directory and unsafe paths are rejected atomically', () => {
  const model = new WorkspaceModel(base), original = model.workspaceData();
  for (const action of [() => model.movePath('src','src/nested'), () => model.movePath('src/main.rs','src/other.rs'), () => model.createFolder('Cargo.toml/assets'), () => model.create('src/main.rs/nested','x'), () => model.createFolder('../outside')]) assert.throws(action);
  assert.deepEqual(model.workspaceData(),original);
});
test('UI view rename moves sidecars and updates entryFile/stylesheet references', () => {
  const model = new WorkspaceModel({...base,'src/view.ui.rs':'fn app() -> ui::Node { view! { <div /> } }'});
  model.applyFiles(UIProject.load(model.files,'src/view.ui.rs').changes({},'div { color: red; }'));
  model.rename('src/view.ui.rs','src/pages/home.ui.rs'); const project = UIProject.load(model.files,'src/pages/home.ui.rs');
  assert.equal(project.settings.entryFile,'src/pages/home.ui.rs'); assert.equal(project.settings.stylesheet,'src/pages/home.ui.css'); assert.equal(project.css,'div { color: red; }');
  assert(!Object.hasOwn(model.files,'src/view.ui.json')); assert(model.undoTransaction()); assert(Object.hasOwn(model.files,'src/view.ui.json'));
});
test('duplicate UI view creates independent settings and does not rewrite the original', () => {
  const model = new WorkspaceModel({...base,'src/view.ui.rs':'// UI'}); model.applyFiles(UIProject.load(model.files,'src/view.ui.rs').changes({},'body {}'));
  model.movePath('src/view.ui.rs','src/copy.ui.rs',{copy:true});
  assert.equal(UIProject.load(model.files,'src/view.ui.rs').settings.entryFile,'src/view.ui.rs');
  assert.equal(UIProject.load(model.files,'src/copy.ui.rs').settings.stylesheet,'src/copy.ui.css');
});
test('folder delete protects nonempty project boundary and keeps unrelated files', () => {
  const model = new WorkspaceModel(base); model.createFolder('src/empty'); model.remove('src');
  assert.deepEqual(Object.keys(model.files),['Cargo.toml']); assert(!model.folders.has('src')); assert.throws(() => model.remove('Cargo.toml')); assert(model.undoTransaction()); assert(model.folders.has('src/empty'));
});
test('preview tabs promote on edit, pins protect bulk close, reorder and reopen are deterministic', () => {
  const model = new WorkspaceModel(base); model.open('src/other.rs',{preview:true}); model.open('Cargo.toml',{preview:true});
  assert(!model.tabs.includes('src/other.rs')); model.update('Cargo.toml','new'); model.open('src/other.rs',{preview:true}); assert(model.tabs.includes('Cargo.toml'));
  model.pin('Cargo.toml'); model.reorderTab('Cargo.toml','src/main.rs'); assert.equal(model.tabs[0],'Cargo.toml');
  model.closeTabs('all'); assert.deepEqual(model.tabs,['Cargo.toml']); model.reopenClosed(); assert.equal(model.active,'src/other.rs');
});
test('per-file layouts and explicitly closed editor persist without reopening arbitrary files', () => {
  const storage = memory(), model = new WorkspaceModel(base,{storage}); model.setDocumentState('src/main.rs',{mode:'design',orientation:'down',ratio:71});
  model.setDocumentState('src/other.rs',{mode:'split',ratio:1}); model.close('src/main.rs'); model.save(); const restored = new WorkspaceModel(base,{storage}); restored.restore();
  assert.equal(restored.active,null); assert.deepEqual(restored.tabs,[]); assert.equal(restored.documentState('src/main.rs').mode,'design'); assert.equal(restored.documentState('src/other.rs').ratio,20);
});
test('named browser projects restore files, tabs and layouts independently', () => {
  const storage = memory(), model = new WorkspaceModel(base,{storage}), store = new ProjectStore(model); model.name='One'; model.setDocumentState('src/main.rs',{mode:'split'}); const first=store.archive();
  model.replace({'Cargo.toml':'[package]\nname="two"','src/main.rs':'fn main(){ }'}); model.name='Two'; const second=store.archive();
  store.open(first); assert.equal(model.name,'One'); assert.equal(model.documentState().mode,'split'); store.open(second); assert.equal(model.name,'Two'); assert.equal(store.list().length,2);
});
test('quota failure refuses switching and stale undo refuses source loss', () => {
  const model = new WorkspaceModel(base,{storage:memory()}), store = new ProjectStore(model); const first=store.archive(); model.update('src/main.rs','changed'); store.storage={getItem:()=>null,setItem:()=>{throw Error('quota');}};
  assert.throws(()=>store.open(first),/quota/); assert.equal(model.read(),'changed'); model.movePath('src','code'); model.update('code/main.rs','newer'); assert.throws(()=>model.undoTransaction(),/newer/); assert.equal(model.read(),'newer');
});

test('tree undo preserves breakpoint and unsaved baseline; empty folder creation is undoable', () => {
  const model=new WorkspaceModel(base);model.update('src/main.rs','// unsaved');model.toggleBreakpoint('src/main.rs',2);
  model.movePath('src','code');model.undoTransaction();assert(model.dirty('src/main.rs'));assert(model.breakpoints.get('src/main.rs').has(2));
  model.createFolder('assets/empty');assert(model.folders.has('assets/empty'));model.undoTransaction();assert(!model.folders.has('assets'));
});
test('project catalog works without localStorage and preserves breakpoint settings', () => {
  const model=new WorkspaceModel(base),store=new ProjectStore(model,null);model.toggleBreakpoint('src/main.rs',1);const id=store.archive();
  model.replace({'Cargo.toml':'[package]','src/lib.rs':'// next'});store.archive();assert.equal(store.list().length,2);store.open(id);assert(model.breakpoints.get('src/main.rs').has(1));
});
