import test from 'node:test';
import assert from 'node:assert/strict';
import {CompletionEdits} from '../src/language/CompletionEdits.js';
import {EditorLanguageResult} from '../src/ui/services/EditorLanguageResult.js';
import {LanguageResultMapper} from '../src/native/lsp/LanguageResultMapper.js';
import {WorkspaceEditPlan} from '../src/ui/model/WorkspaceEditPlan.js';
import {SyntaxHighlighter} from '../src/ui/services/SyntaxHighlighter.js';
import {RustDocument} from '../src/language/RustDocument.js';

const file='src/main.rs',uri='ferrite://workspace/'+file;
const position=character=>({line:0,character}),range=(start,end)=>({start:position(start),end:position(end)});
function apply(source,position,raw){const files={[file]:source},items=CompletionEdits.items(files,file,position,raw);return WorkspaceEditPlan.prepare(files,items[0].changes).files[file];}

test('native and browser completion fallback replaces the full token, not just its prefix',()=>{
  const files={[file]:'fn main() { count }'},offset=files[file].indexOf('count')+2,raw=[{label:'counter'}];
  for(const mapper of [new EditorLanguageResult(files),new LanguageResultMapper('/project',files)]){
    const method=mapper instanceof EditorLanguageResult?'completion':'textDocument/completion';
    const result=mapper.map(method,raw,file,position(offset),'test');
    assert.equal(WorkspaceEditPlan.prepare(files,result.items[0].changes).files[file],'fn main() { counter }');
  }
});
test('plain CompletionList defaults, insert/replace ranges and textEditText follow edit precedence',()=>{
  const source='fn main() { count }',start=source.indexOf('count'),replace=range(start,start+5),insert=range(start,start+2);
  assert.equal(apply(source,position(start+2),{itemDefaults:{editRange:{insert,replace}},items:[{label:'display label',textEditText:'counter'}]}),'fn main() { counter }');
  assert.equal(apply(source,position(start+2),{itemDefaults:{editRange:replace},items:[{label:'display',textEditText:'ignored',textEdit:{range:replace,newText:'chosen'}}]}),'fn main() { chosen }');
});
test('completions reject snippet defaults and malformed/overlapping edits individually',()=>{
  const source='fn main() { count }',files={[file]:source},point=position(source.indexOf('count'));
  assert.equal(CompletionEdits.items(files,file,point,{itemDefaults:{insertTextFormat:2},items:[{label:'fn',insertText:'${1:name}'}]}).length,0);
  const items=CompletionEdits.items(files,file,point,{items:[{label:'bad',textEdit:{range:range(900,901),newText:'bad'}},{label:'overlap',textEdit:{range:range(12,17),newText:'x'},additionalTextEdits:[{range:range(12,17),newText:'y'}]},{label:'counter'}]});
  assert.deepEqual(items.map(i=>i.label),['counter']);
});
test('fallback raw identifiers retain r# and use UTF-16 positions after Unicode',()=>{
  const source='fn main() { println!("🦀"); r#type }',offset=source.indexOf('r#type')+4;
  assert.equal(apply(source,position(offset),[{label:'type2'}]),source.replace('r#type','r#type2'));
});
test('browser edit mapper never edits or navigates outside the supplied workspace',()=>{
  const files={[file]:'fn main() {}'},mapper=new EditorLanguageResult(files);
  for(const target of ['file:///etc/passwd','https://example.org/'+file,'ferrite://elsewhere/'+file,'ferrite://workspace/src/unknown.rs']){
    assert.deepEqual(mapper.map('definition',{uri:target,range:range(0,2)},file,position(0),'test').locations,[]);
    assert.throws(()=>mapper.edits({changes:{[target]:[{range:range(0,2),newText:'x'}]}}),/outside/);
  }
  assert.throws(()=>mapper.edits({documentChanges:[{kind:'delete',uri}]}),/File operations/);
});
test('completion extra edits are atomic and preserve original CRLF file content',()=>{
  const source='fn main() {\r\n    cou\r\n}\r\n',files={[file]:source},point={line:1,character:7};
  const item=CompletionEdits.items(files,file,point,[{label:'counter',additionalTextEdits:[{range:range(0,0),newText:'use crate::counter;\r\n'}]}])[0];
  const plan=WorkspaceEditPlan.prepare(files,item.changes);
  assert.equal(plan.files[file],'use crate::counter;\r\nfn main() {\r\n    counter\r\n}\r\n');assert.equal(plan.count,2);
});
test('diagnostic decoration is lossless, escaped and independent of syntax token boundaries',()=>{
  const source='fn app() { view! { <p>{42}</p> } }',document=new RustDocument(source,file);
  const diagnostics=[{span:{start:source.indexOf('<p>'),end:source.indexOf('</p>')+4},message:'<img src=x onerror="alert(1)">',severity:1},{span:{start:source.indexOf('42'),end:source.indexOf('42')+2},message:'warning',severity:2}];
  const html=SyntaxHighlighter.html(source,file,document,diagnostics);
  assert.ok(html.includes('editor-diagnostic'));assert.ok(html.includes('syntax-number'));assert.ok(!html.includes('<img'));assert.ok(html.includes('&lt;img'));
  const plain=html.replace(/<[^>]*>/g,'').replaceAll('&lt;','<').replaceAll('&gt;','>').replaceAll('&quot;','"').replaceAll('&#39;',"'").replaceAll('&amp;','&');assert.equal(plain,source);
});
test('signature-specific active parameter overrides the top-level LSP fallback',()=>{
  const files={[file]:''},raw={activeParameter:0,signatures:[{label:'fn f(a: i32, b: i32)',activeParameter:1,parameters:[{label:'a: i32'},{label:'b: i32'}]}]};
  const browser=new EditorLanguageResult(files).map('signatureHelp',raw,file,position(0),'test');
  const native=new LanguageResultMapper('/project',files).map('textDocument/signatureHelp',raw,file,position(0));
  assert.match(browser.text,/Parameter: b: i32/);assert.match(native.text,/Parameter: b: i32/);
});

test('browser agent runtime disposes its separate UI analysis worker exactly once',async t=>{
  const {BrowserRuntime}=await import('../src/agent/browser/BrowserRuntime.js');
  const {WorkspaceModel}=await import('../src/ui/model/WorkspaceModel.js');
  let closed=0;
  const runtime=await BrowserRuntime.create({model:new WorkspaceModel({[file]:'fn main() {}'}),compiler:{close:async()=>{}},storeOptions:{indexedDB:null},leaseOptions:{locks:null}});
  t.after(()=>runtime.close());runtime.language.uiCompiler={close:async()=>{closed++;}};
  await runtime.close();await runtime.close();assert.equal(closed,1);
});


test('signature documentation belongs to the selected provider, not a coincidental function name',async()=>{
  const {UILanguageCatalog}=await import('../src/language/UILanguageCatalog.js');
  for(const [name,enabled] of [['ui::use_state',false],['update',true]]){
    const source=`fn main() { ${name}(`,document=new RustDocument(source,file);
    const result=UILanguageCatalog.signatureHelp(document,source.length,[{name,qualifiedName:name,label:`fn ${name}(value: i32) -> i32`,parameters:[{label:'value: i32'}]}],enabled);
    assert.equal(result.signatures[0].documentation.value,'Rust function signature from source.');
  }
  const source='fn app() { ui::use_state(',result=UILanguageCatalog.signatureHelp(new RustDocument(source,file),source.length);
  assert.match(result.signatures[0].documentation.value,/stable i64 state handle/);
});
