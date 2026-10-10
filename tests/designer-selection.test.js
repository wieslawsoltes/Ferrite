import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceDesigner} from '../src/ui-framework/SourceDesigner.js';
import {captureDesignerSelection,restoreDesignerSelection} from '../src/ui/studio/DesignerSelection.js';
const source='fn app() -> ui::Node { view! { <section><h1>Old long heading</h1><p>Second</p></section> } }';
function edit(select, operation) {
 const d=new SourceDesigner(source,{validate:false});
 const selected=d.nodes.find(select),op=operation(d),saved=captureDesignerSelection(d,selected.id,op);
 d.apply(op,0);return {node:restoreDesignerSelection(d,saved,source),d};
}
test('shorter literal text preserves the owning heading selection instead of selecting its ancestor',()=>{
 const result=edit(n=>n.tag==='h1',d=>({op:'setText',node:d.nodes.find(n=>n.kind==='text').id,value:'Hi'}));
 assert.equal(result.node.tag,'h1');
});
test('inserting before a selected sibling maps its shifted source offset',()=>{
 const result=edit(n=>n.tag==='p',d=>({op:'insert',node:d.nodes.find(n=>n.tag==='section').id,before:d.nodes.find(n=>n.tag==='p').id,markup:'<button>New</button>'}));
 assert.equal(result.node.tag,'p');
});
test('deletion selects the surviving parent instead of an unrelated node at the old offset',()=>{
 const result=edit(n=>n.tag==='h1',d=>({op:'remove',node:d.nodes.find(n=>n.tag==='h1').id}));
 assert.equal(result.node.tag,'section');
});
test('renaming both tag delimiters retains the element selection',()=>{
 const result=edit(n=>n.tag==='h1',d=>({op:'setTag',node:d.nodes.find(n=>n.tag==='h1').id,value:'header'}));
 assert.equal(result.node.tag,'header');
});
