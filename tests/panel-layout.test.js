import test from 'node:test';
import assert from 'node:assert/strict';
import {PanelLayout, clampBox} from '../src/ui/docking/PanelLayout.js';
import {designerLayout, DESIGNER_PANELS} from '../src/ui/studio/DesignerLayout.js';
const make = saved => new PanelLayout(DESIGNER_PANELS, designerLayout(), saved);
function invariant(model) {
  assert.deepEqual([...model.nodes().filter(node=>node.type==='group').flatMap(node=>node.tabs)].sort(),[...DESIGNER_PANELS].sort());
  assert.deepEqual(model.validate(model.snapshot()),model.snapshot());
}
test('designer panes have separate groups, and every pane can split, stack and float', () => {
  for(const id of DESIGNER_PANELS) {
    const model=make(),target=id==='canvas'?'structure':'canvas';
    for(const side of ['left','right','top','bottom']) { assert.equal(model.dock(id,target,side),true);invariant(model); }
    model.dock(id,target,'center');assert.equal(model.group(id),model.group(target));
    model.float(id,{x:140,y:210,width:550,height:360});assert.equal(model.floating(id).x,140);invariant(model);
    model.redock(id);assert.equal(model.floating(id),undefined);assert.equal(model.group(id),model.group(target));invariant(model);
  }
});
test('closing and reopening keeps exact group/order, and all panels may be hidden',()=>{
  const model=make(),before=model.snapshot().root;
  for(const id of DESIGNER_PANELS)model.close(id);
  assert.equal(model.measure(1200,800).groups.length,0);assert.deepEqual(model.snapshot().root,before);
  model.open('styles');assert.equal(model.measure(1200,800).groups[0].node.active,'styles');
  invariant(model);
});
test('floating geometry, active tabs, hidden panels and return homes survive serialization',()=>{
  const model=make();model.open('debug');model.float('toolbox');model.close('toolbox');model.setRatio('content',.54);
  const saved=JSON.parse(JSON.stringify(model.snapshot())),restored=make(saved);assert.deepEqual(restored.snapshot(),saved);
  restored.open('toolbox');assert.ok(restored.floating('toolbox'));restored.redock('toolbox');assert.ok(!restored.floating('toolbox'));invariant(restored);
});
test('invalid, duplicate, missing, nonfinite or excessively deep saved layouts fall back atomically',()=>{
  const initial=make().snapshot();
  for(const change of [s=>s.version=77,s=>s.root.first.first.tabs.push('canvas'),s=>s.root.first.first.tabs[0]='unknown',s=>s.root.first=null,s=>s.root.ratio=NaN,s=>s.floating=[{node:{type:'group',id:'bad',tabs:['canvas']},x:Infinity,y:0,width:2,height:2}],s=>s.root.id=s.root.first.id]) {
    const value=structuredClone(initial);change(value);assert.deepEqual(make(value).snapshot(),initial);
  }
});
test('tab reordering, self-drops, split collapse and outer edge docking preserve uniqueness',()=>{
  const model=make();assert.equal(model.dock('canvas','canvas','left'),false);
  model.reorder('debug','properties');assert.deepEqual(model.group('debug').tabs,['debug','properties','styles','settings']);
  model.float('canvas');model.dock('canvas',null,'bottom');invariant(model);
  assert.throws(()=>model.dock('unknown','canvas'));assert.throws(()=>model.dock('canvas','properties','sideways'));invariant(model);
});
test('floating tab groups support grouping and splitting one tab back out',()=>{
  const model=make();model.float('properties');model.dock('styles','properties');assert.equal(model.floating('styles'),model.floating('properties'));
  const before=model.snapshot();assert.throws(()=>model.dock('toolbox','styles','left'));assert.deepEqual(model.snapshot(),before);
  model.float('styles');assert.notEqual(model.floating('styles'),model.floating('properties'));invariant(model);
});
test('all floating then redocking the canvas recovers an empty workspace',()=>{
  const model=make();for(const id of DESIGNER_PANELS)model.float(id);assert.equal(model.snapshot().root,null);
  model.redock('canvas');assert.ok(model.snapshot().root);invariant(model);
});
test('geometry is nonnegative, bounded, and does not rewrite saved proportions at narrow widths',()=>{
  const model=make(),before=model.snapshot();
  for(const width of [0,50,375,650,1800])for(const height of [0,50,800]) {
    const {groups}=model.measure(width,height);
    for(const box of groups){assert.ok(box.width>=0&&box.height>=0);assert.ok(box.x+box.width<=width+11);assert.ok(box.y+box.height<=height+11);}
  }
  assert.deepEqual(model.snapshot(),before);
  assert.deepEqual(clampBox({x:-200,y:20000,width:2000,height:3000},375,600),{x:8,y:8,width:359,height:584});
});
test('five hundred deterministic layout operations retain all registered panels and round-trip',()=>{
  const model=make();let seed=712367;
  const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let i=0;i<500;i++){
    const id=DESIGNER_PANELS[next()%DESIGNER_PANELS.length],target=DESIGNER_PANELS[next()%DESIGNER_PANELS.length];
    switch(next()%6){case 0:model.float(id);break;case 1:model.close(id);break;case 2:model.open(id);break;case 3:model.redock(id);break;default:model.dock(id,target,model.floating(target)?'center':['left','right','top','bottom','center'][next()%5]);}
    invariant(model);const saved=JSON.parse(JSON.stringify(model.snapshot()));assert.deepEqual(make(saved).snapshot(),saved);
  }
});
