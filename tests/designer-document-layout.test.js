import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {PanelLayout} from '../src/ui/docking/PanelLayout.js';
import {designerLayout, DESIGNER_PANELS, restoreDesignerLayout} from '../src/ui/studio/DesignerLayout.js';
import {literalRectangle} from '../src/ui/studio/DesignerProperties.js';
import {insertElement} from '../src/ui/studio/DesignerView.js';
const files={'src/a.ui.rs':'fn app() {}','src/b.ui.rs':'fn app() {}'};

test('each document retains validated docking through persistence, rename, close and reopen',()=>{
 const model=new WorkspaceModel(files),layout=new PanelLayout(DESIGNER_PANELS,designerLayout());
 layout.float('properties',{x:110,y:160});layout.close('debug');
 const revision=model.revision;model.setDocumentState('src/a.ui.rs',{mode:'design',designerLayout:layout.snapshot()});
 assert.equal(model.revision,revision);assert.equal(model.documentState('src/b.ui.rs').designerLayout,undefined);
 const restored=new WorkspaceModel(files);restored.loadWorkspace(JSON.parse(JSON.stringify(model.workspaceData())));
 assert.deepEqual(restored.documentState('src/a.ui.rs').designerLayout,layout.snapshot());
 restored.movePath('src/a.ui.rs','src/renamed.ui.rs');restored.close('src/renamed.ui.rs');restored.open('src/renamed.ui.rs');
 assert.deepEqual(restored.documentState('src/renamed.ui.rs').designerLayout,layout.snapshot());
});
test('untrusted layouts fall back without changing source or accepting duplicate panels',()=>{
 const model=new WorkspaceModel(files),before=model.snapshot();
 for(const saved of [null,{}, {version:900}, {...designerLayout(),hidden:new Array(1000).fill('canvas')}]){
  model.setDocumentState('src/a.ui.rs',{designerLayout:saved});
  assert.deepEqual(model.documentState('src/a.ui.rs').designerLayout,designerLayout());
 }
 assert.deepEqual(model.snapshot(),before);
 const saved=designerLayout();saved.root.first.first.tabs.push('canvas');
 assert.deepEqual(restoreDesignerLayout(saved),designerLayout());
});
test('saved layouts are copied, not aliased to callers',()=>{
 const model=new WorkspaceModel(files),saved=designerLayout();model.setDocumentState('src/a.ui.rs',{designerLayout:saved});
 saved.hidden.push('canvas');assert.ok(!model.documentState('src/a.ui.rs').designerLayout.hidden.includes('canvas'));
});
test('geometry projects only literal pixels; no fabricated 120px rectangle or percentage conversion',()=>{
 const node=value=>({attributes:[{name:'style',kind:'string',value}]});
 assert.deepEqual(literalRectangle(node('left: -1.5px; top:0; width:50%; height:calc(100px - 1em)')),{x:'-1.5',y:'0',width:'',height:''});
 assert.deepEqual(literalRectangle(node('width:24px; width:auto; top: 5px')),{x:'',y:'5',width:'',height:''});
 assert.deepEqual(literalRectangle({attributes:[{name:'style',kind:'expression',value:'styles'}]}),{x:'',y:'',width:'',height:''});
});
test('toolbox inserts child/sibling explicitly and rejects void destinations',()=>{
 const a={id:'a',kind:'element',tag:'input'},b={id:'b',kind:'element',tag:'p'},root={id:'r',kind:'element',tag:'div',children:[a,b]};
 const s={selected:'a',designer:{index:new Map([['a',a],['b',b],['r',root]]),parents:new Map([['a',root],['b',root]])},edit:op=>op};
 assert.throws(()=>insertElement(s,'<p>X</p>'),/cannot contain/);
 assert.deepEqual(insertElement(s,'<p>X</p>','a','after'),{op:'insert',node:'r',markup:'<p>X</p>',before:'b'});
 assert.deepEqual(insertElement(s,'<p>X</p>','b','before'),{op:'insert',node:'r',markup:'<p>X</p>',before:'b'});
 assert.equal(insertElement(s,'<p>X</p>','b','after').before,null);
 assert.throws(()=>insertElement(s,'<p>X</p>','r','before'),/root view/);
});
