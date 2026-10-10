import test from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {BrowserWorkspace} from '../src/agent/browser/BrowserWorkspace.js';
import {BrowserLanguageService} from '../src/agent/browser/BrowserLanguageService.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {RustDocument} from '../src/language/RustDocument.js';
import {RustLanguageIndex} from '../src/language/RustLanguageIndex.js';
import {UILanguageCatalog} from '../src/language/UILanguageCatalog.js';
import {UIAnalysis} from '../src/language/UIAnalysis.js';
import {UI_SAMPLES} from '../src/ui-framework/Samples.js';
import {WorkspaceEditPlan} from '../src/ui/model/WorkspaceEditPlan.js';

const file = 'src/app.ui.rs', uri = 'ferrite://workspace/' + file;
function service(source, extra = {}, overrides = {}) {
  const model = new WorkspaceModel({[file]:source,...extra}), workspace = new BrowserWorkspace(model), counts = {rust:0,ui:0};
  const compiler = {compile:async (files,command,options) => { counts.rust++; return new CompilerOperation().perform(files,command,options); }};
  const ui = {compile:async (files,command,options) => { counts.ui++; return UIAnalysis.compile(files,options); },close:async()=>{}};
  const language = new BrowserLanguageService(workspace,compiler,{uiCompilerFactory:()=>ui,...overrides});
  const request = (method, position = source.length, params = {}, path = file, options = {}) => language.request('textDocument/' + method,{path,params:{position:BrowserLanguageService.point(model.read(path),position),...params},options});
  return {model,language,counts,request};
}
function complete(source, marker = '|', candidates = []) {
  const position = source.indexOf(marker), text = source.replace(marker,'');
  const result = UILanguageCatalog.completion(new RustDocument(text,file),position,candidates);
  return {text,position,result,apply:label=>WorkspaceEditPlan.prepare({[file]:text},{[file]:[result.items.find(item=>item.label===label).textEdit]}).files[file]};
}

test('contextual tag, event, attribute and ABI completion replaces both prefix and suffix', () => {
  assert.equal(complete('fn app() { view! { <but|ton></button> } }').apply('button'),'fn app() { view! { <button></button> } }');
  assert.equal(complete('fn app() { view! { <button on:cl|ick={} /> } }').apply('on:click'),'fn app() { view! { <button on:click={} /> } }');
  assert.equal(complete('fn app() { ui::ge|t(x) }').apply('get'),'fn app() { ui::get(x) }');
  const attrs=complete('fn app() { view! { <input value="x" | /> } }').result.items;
  assert.ok(attrs.some(i=>i.label==='checked'));assert.ok(!attrs.some(i=>i.label==='value'));assert.ok(attrs.some(i=>i.label==='aria-label'));
  const component=complete('fn app() { view! { <Card | /> } }').result.items.map(i=>i.label);
  assert.deepEqual(component,['props','key']);
});
test('completion inside incomplete markup uses typed Rust context for expression islands', () => {
  for(const source of ['fn app() { view! { <but|','fn app() { view! { <button on:cl|','fn app() { view! { <input value={ui::ge|'])assert.ok(complete(source).result.items.length>0);
  const closing=complete('fn app() { view! { <button>Hello</bu|');assert.deepEqual(closing.result.items.map(i=>i.label),['button']);
  const generic=complete('fn app() { let x = ui::|');assert.ok(generic.result.items.some(i=>i.label==='Signal'));
});
test('no completion or markup injection in prose, comments or string literal bodies', () => {
  for(const source of ['fn app() { /* ui::ge| */ }','fn app() { let s = "ui::ge|"; }','fn app() { view! { <p>ui::ge| text</p> } }','fn app() { let s = r#"ui::ge|"#; }'])assert.equal(complete(source).result.items.length,0,source);
});
test('catalog signature help is compiler-owned and counts nested argument lists/closures', () => {
  for(const [source,parameter] of [['fn app() { ui::set(ui::use_state(0), ',1],['fn app() { ui::state::<i64>(',0],['fn app() { ui::modify(signal, |a,b| a + b',1]]){
    const result=UILanguageCatalog.signatureHelp(new RustDocument(source,file),source.length);assert.ok(result,source);assert.equal(result.activeParameter,parameter,source);
  }
  assert.equal(UILanguageCatalog.signatures.get('modify').parameters.length,2);
});
test('UI hover explains callback contracts and real ABI types without invoking the compiler',async()=>{
  const source='fn app() { view! { <button on_event:click={move |e: ui::Event| {}} /> } }',s=service(source);
  const hover=await s.request('hover',source.indexOf('on_event:click')+3);assert.match(hover.contents.value,/ui::Event/);
  const type=await s.request('hover',source.indexOf('ui::Event')+4);assert.match(type.contents.value,/UI ABI type/);
  assert.equal(s.counts.ui,0);
});
test('UI count references include both closure captures and exclude synthetic broad spans',async()=>{
  const source=UI_SAMPLES.counter,s=service(source),offset=source.indexOf('count');
  const hover=await s.request('hover',offset);assert.match(hover.contents.value,/count: ui::State/);
  const references=await s.request('references',offset);assert.equal(references.length,4);
  for(const reference of references){const span=WorkspaceEditPlan.span(file,source,reference.range);assert.equal(source.slice(span.start,span.end),'count');}
  const changes=await s.request('rename',offset,{newName:'counter'});assert.equal(changes.changes[uri].length,4);
  const renamed=WorkspaceEditPlan.prepare({[file]:source},{[file]:changes.changes[uri]}).files[file];
  assert.ok(renamed.includes('<section className="card">'));assert.ok(renamed.includes('|n| n - 1'));
  assert.doesNotThrow(()=>UIAnalysis.compile({[file]:renamed},{file}));assert.equal(s.model.read(file),source);
  assert.equal(s.counts.ui,1,'successful analysis is cached across read-only methods');
});
test('closure parameters stay distinct across view event handlers',async()=>{
  const source=UI_SAMPLES.counter,s=service(source),first=source.indexOf('|n|')+1;
  const references=await s.request('references',first);assert.equal(references.length,2);
  const rename=await s.request('rename',first,{newName:'amount'});assert.equal(rename.changes[uri].length,2);
  const result=WorkspaceEditPlan.prepare({[file]:source},{[file]:rename.changes[uri]}).files[file];assert.ok(result.includes('|amount| amount - 1'));assert.ok(result.includes('|n| n + 1'));
});
test('UI helper module definitions use original source, not expanded token offsets',async()=>{
  const source='mod helpers; fn app() -> ui::Node { let n = helpers::answer(); view! { <output>{n}</output> } }';
  const helper='pub fn answer() -> i64 { 42 }',s=service(source,{'src/helpers.rs':helper});
  const definition=await s.request('definition',source.indexOf('answer'));assert.equal(definition.uri,'ferrite://workspace/src/helpers.rs');assert.equal(definition.range.start.character,helper.indexOf('answer'));
  const symbols=await s.request('documentSymbol',0,{},'src/helpers.rs',{uiEntryFile:file});assert.equal(symbols[0].name,'answer');
});
test('component source references connect opening and closing tags to a resolved function',async()=>{
  const source='fn Card() -> ui::Node { view! { <div>Card</div> } } fn app() -> ui::Node { view! { <Card></Card> } }',s=service(source);
  const definition=await s.request('definition',source.indexOf('<Card>')+1);assert.ok(definition);assert.equal(definition.range.start.character,source.indexOf('Card'));
  const references=await s.request('references',source.indexOf('Card'));assert.equal(references.length,3);
});
test('invalid UI retains completions and original diagnostics but refuses speculative renaming',async()=>{
  const source='fn app() -> ui::Node { let count = ui::use_state(0); view! { <output>{cou',s=service(source);
  const completion=await s.request('completion');assert.ok(completion.items.some(i=>i.label==='count'&&i.detail.includes('syntax candidate')));
  const diagnostic=await s.request('diagnostic');assert.equal(diagnostic.kind,'full');assert.ok(diagnostic.items.length);assert.equal(diagnostic.items[0].source,'ferrite-ui');
  await assert.rejects(s.request('rename',source.indexOf('count'),{newName:'counter'}),{code:'RENAME_UNRESOLVED'});
});
test('safe Unicode and raw local rename preserves exact source spelling',async()=>{
  const source='fn app() -> ui::Node { let r#type = 1; view! { <p>{r#type}</p> } }',s=service(source),offset=source.indexOf('r#type');
  const refs=await s.request('references',offset);assert.equal(refs.length,2);assert.equal(refs[0].range.end.character-refs[0].range.start.character,6);
  for(const newName of ['r#match','liczba','żółw'])assert.equal((await s.request('rename',offset,{newName})).changes[uri].length,2);
  for(const newName of ['_','r#self','r#_','r#super','fn','not legal'])await assert.rejects(s.request('rename',offset,{newName}),/identifier/);
});
test('rename blocks accidental capture even when the other identifier is unresolved in HIR',async()=>{
  const source='fn app() -> ui::Node { let count = 1; view! { <p>{count}</p> } } fn other() { let count2 = 0; }',s=service(source);
  await assert.rejects(s.request('rename',source.indexOf('count'),{newName:'count2'}),{code:'RENAME_COLLISION'});
});
test('resolved completion excludes locals from a completed sibling scope and future declarations',()=>{
  const source='fn main() { let outer = 1; { let inner = 2; println!("{}",inner); } println!("{}",outer); let future = 3; }',build=new CompilerOperation().perform({'Cargo.toml':'[package]\nname="test"\nversion="0.1.0"\n','src/main.rs':source},'check',{});
  const index=new RustLanguageIndex(build,{'src/main.rs':source}),labels=index.candidates('src/main.rs',source.lastIndexOf('outer')).map(i=>i.label);
  assert.ok(labels.includes('outer'));assert.ok(!labels.includes('inner'));assert.ok(!labels.includes('future'));
});
test('stale asynchronous analysis cannot return edits for a newer source revision',async()=>{
  let release;const delayed={compile:()=>new Promise(resolve=>release=resolve),close:async()=>{}};
  const source=UI_SAMPLES.counter,s=service(source,{}, {uiCompilerFactory:()=>delayed});
  const pending=s.request('references',source.indexOf('count'));while(!release)await new Promise(resolve=>setTimeout(resolve,0));
  s.model.update(file,source+'\n');release(UIAnalysis.compile({[file]:source},{file}));await assert.rejects(pending,{code:'STALE_LANGUAGE_RESULT'});
});
test('semantic token methods support incomplete UI without compiling or losing UTF-16 ranges',async()=>{
  const source='fn app() { view! { <button on:cl',s=service(source);
  const result=await s.request('semanticTokens/full');assert.ok(result.data.length);assert.equal(result.data.length%5,0);assert.equal(s.counts.ui,0);assert.equal(s.counts.rust,0);
});
