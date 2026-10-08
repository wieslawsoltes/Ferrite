import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {SelectionModel} from '../src/ui/model/SelectionModel.js';
import {CompilationService} from '../src/ui/services/CompilationService.js';
import {NativeCargoClient} from '../src/ui/services/NativeCargoClient.js';
const files = {'Cargo.toml':'[package]\nname="demo"\nversion="0.1.0"','src/main.rs':'fn main(){}'};
test('workspace revision, rename, close, remove and persistence are consistent', () => {
  const values = new Map(), storage = {getItem:key=>values.get(key),setItem:(key,value)=>values.set(key,value)};
  const model = new WorkspaceModel(files,{storage}); const revision = model.revision;
  model.update('src/main.rs','fn main(){println!("ok");}'); assert.equal(model.revision,revision+1);
  model.create('src/notes.rs','fn notes(){}'); model.rename('src/notes.rs','src/note.rs');
  assert.equal(model.active,'src/note.rs'); assert(!Object.hasOwn(model.files,'src/notes.rs'));
  model.toggleBreakpoint('src/note.rs',1); model.rename('src/note.rs','src/library.rs');
  assert.deepEqual(model.breakpointList,[{file:'src/library.rs',line:1}]);
  model.remove('src/library.rs'); assert(!Object.hasOwn(model.files,'src/library.rs'));
  assert.throws(()=>model.update('src/library.rs','resurrected'),/does not exist/);
  assert(model.save()); const restored = new WorkspaceModel(files,{storage}); assert(restored.restore());
  assert.equal(restored.read(),model.read()); assert(!restored.dirty(restored.active));
});
test('workspace rejects dangerous and duplicate paths',()=>{
  const model = new WorkspaceModel(files);
  assert.throws(()=>model.create('../escape.rs'));
  assert.throws(()=>model.create('src/main.rs'));
  assert.throws(()=>model.replace({'__proto__/bad.rs':'bad'}));
});
test('selection rejects old revisions and matches half-open per-file spans',()=>{
  const model = new SelectionModel(); model.reset(3);
  const span={file:'src/a.rs',start:5,end:8};
  assert(!model.select(span,'old',2)); assert(model.select(span,'editor',3));
  assert(SelectionModel.overlaps(span,{file:'src/a.rs',start:7,end:7}));
  assert(!SelectionModel.overlaps(span,{file:'src/a.rs',start:8,end:8}));
  assert(!SelectionModel.overlaps(span,{file:'src/b.rs',start:5,end:8}));
});
test('compiler service coalesces pending changes, preserves cache worker and cancels safely',async()=>{
  const sent=[];let starts=0;const worker={postMessage:x=>sent.push(x),terminate(){}};
  const service=new CompilationService({workerFactory:()=>{starts++;return worker;}});
  const a=service.request(files,'check',{},1);
  const b=service.request(files,'check',{},2).catch(error=>error.name);
  const c=service.request(files,'check',{},3);
  assert.equal(await b,'AbortError'); assert.equal(sent.length,1);
  worker.onmessage({data:{id:sent[0].id,build:{cacheHit:false}}}); assert.equal((await a).revision,1);
  assert.equal(sent.length,2); worker.onmessage({data:{id:sent[1].id,build:{cacheHit:true}}});
  assert.equal((await c).revision,3); assert.equal(starts,1);
  const cancelled=service.request(files,'check',{},4).catch(error=>error.name);service.cancel();assert.equal(await cancelled,'AbortError');
});
test('native bridge validates loopback and joins split UTF-8 NDJSON chunks',async()=>{
  const events=[],bytes=new TextEncoder().encode('{"type":"log","text":"café"}\n{"type":"result","result":{"exitCode":0}}\n');
  let called=0;
  const client=new NativeCargoClient({fetcher:async(url,request)=>{
    called++;assert(request.headers.Authorization.startsWith('Bearer '));
    if(url.endsWith('capabilities'))return new Response(JSON.stringify({backend:'native-cargo',protocol:1,commands:['check']}));
    return new Response(new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,28));controller.enqueue(bytes.slice(28,31));controller.enqueue(bytes.slice(31));controller.close();}}));
  }});
  await assert.rejects(()=>client.connect('https://evil.example','a'.repeat(32)),/loopback/);assert.equal(called,0);
  await client.connect('http://127.0.0.1:8787','b'.repeat(32));
  const result=await client.run(files,'check',{},e=>events.push(e));assert.equal(result.exitCode,0);assert.equal(events[0].text,'café');
  client.disconnect();assert.equal(client.token,null);
});

test('rustc byte offsets map to UTF-16 ranges without losing Unicode',async()=>{
  const {NativeDiagnosticMapper}=await import('../src/ui/services/NativeDiagnosticMapper.js');
  const text='// 🦀\nlet café = 1;';const start=new TextEncoder().encode('// 🦀\nlet ').length;
  const result=NativeDiagnosticMapper.map({message:'test',spans:[{file:'src/main.rs',byteStart:start,byteEnd:start+5,primary:true}]},{'src/main.rs':text});
  assert.equal(text.slice(result.span.start,result.span.end),'café');assert.equal(result.span.line,2);
});

test('native file updates are atomic, preserve active document and validate all paths',()=>{
  const model = new WorkspaceModel({'Cargo.toml':'[package]\nname="t"','src/main.rs':'fn main(){}'});
  const revision=model.revision,events=[];model.subscribe(event=>events.push(event));
  const changed=model.applyFiles({'src/main.rs':'fn main() {}\n','Cargo.lock':'version = 3\n'});
  assert.deepEqual(changed,['src/main.rs','Cargo.lock']);assert.equal(model.active,'src/main.rs');
  assert.equal(model.revision,revision+1);assert.equal(events.length,1);
  assert.throws(()=>model.applyFiles({'../escaped.rs':'bad'}));
  assert.equal(model.revision,revision+1);assert.equal(model.read('src/main.rs'),'fn main() {}\n');
});

test('compiler worker startup failures reject promptly and allow a clean retry',async()=>{
  let fail=true;const worker={postMessage(message){queueMicrotask(()=>this.onmessage({data:{id:message.id,build:{ok:true}}}));},terminate(){}};
  const service=new CompilationService({workerFactory:()=>{if(fail)throw Error('worker start blocked');return worker;}});
  await assert.rejects(service.request({},'check',{},1),/worker start blocked/);fail=false;
  const result=await service.request({},'check',{},2);assert(result.build.ok);service.cancel();
});
