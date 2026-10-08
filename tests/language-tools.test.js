import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough,Writable} from 'node:stream';
import {setTimeout as delay} from 'node:timers/promises';
import {JsonRpcPeer} from '../src/native/lsp/JsonRpcPeer.js';
import {LanguageResultMapper} from '../src/native/lsp/LanguageResultMapper.js';
import {WorkspaceEditPlan as Edits} from '../src/ui/model/WorkspaceEditPlan.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {RustAnalyzerSession} from '../src/native/lsp/RustAnalyzerSession.js';
import {CargoBridgeServer} from '../src/native/CargoBridgeServer.js';
import {NativeCargoClient} from '../src/ui/services/NativeCargoClient.js';
const range=(line,start,end)=>({start:{line,character:start},end:{line,character:end}});
const frame=value=>{const body=Buffer.from(JSON.stringify({jsonrpc:'2.0',...value}));return Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`),body]);};
function peer(){const input=new PassThrough(),written=[];const output=new Writable({write(chunk,encoding,done){written.push(Buffer.from(chunk));done();}});return {input,written,peer:new JsonRpcPeer(input,output)};}
test('LSP framing uses UTF-8 byte counts and accepts split headers and JSON code points',async()=>{
 const p=peer();try{const request=p.peer.request('test',{});const value=frame({id:1,result:'Zażółć 🚀'});for(const byte of value)p.input.write(Buffer.from([byte]));assert.equal(await request,'Zażółć 🚀');assert(p.written[0].toString().includes('Content-Length:'));}finally{p.peer.close();}
});
test('LSP request cancellation sends cancel notification and discards late results',async()=>{
 const p=peer(),controller=new AbortController();try{const request=p.peer.request('test',{}, {signal:controller.signal});controller.abort();await assert.rejects(request,e=>e.name==='AbortError');assert(p.written.at(-1).toString().includes('$/cancelRequest'));p.input.write(frame({id:1,result:4}));assert.equal(p.peer.pending.size,0);}finally{p.peer.close();}
});
test('malformed LSP headers close transport and reject pending work',async()=>{
 const p=peer();const request=p.peer.request('test',{});p.input.write('Content-Length: 3\r\nContent-Length: 3\r\n\r\n{}');await assert.rejects(request,/Content-Length/);assert(p.peer.closed);
});
test('LSP failed requests preserve protocol error codes and can be retried',async()=>{
 const p=peer();try{const request=p.peer.request('test',{});p.input.write(frame({id:1,error:{code:-32801,message:'changed'}}));await assert.rejects(request,e=>e.code===-32801);const next=p.peer.request('test',{});p.input.write(frame({id:2,result:null}));assert.equal(await next,null);}finally{p.peer.close();}
});
test('workspace edits validate UTF-16 ranges, overlap, unknown paths and atomic transaction undo',()=>{
 const files={'src/main.rs':'let emoji = "🚀";\nlet name = 1;\n','src/lib.rs':'fn name(){}'};
 const changes={'src/main.rs':[{range:range(1,4,8),newText:'value'}],'src/lib.rs':[{range:range(0,3,7),newText:'value'}]};
 const plan=Edits.prepare(files,changes);assert.equal(plan.count,2);assert(plan.files['src/main.rs'].includes('let value'));
 const model=new WorkspaceModel(files);model.applyTransaction(plan.files);assert(model.files['src/lib.rs'].includes('value'));assert(model.undoTransaction());assert.deepEqual({...model.files},files);
 model.applyTransaction(plan.files);model.update('src/lib.rs','newer text');assert.throws(()=>model.undoTransaction(),/newer edits/);
 assert.throws(()=>Edits.prepare(files,{'src/main.rs':[{range:range(1,4,8),newText:'x'},{range:range(1,7,9),newText:'y'}]}),/Overlapping/);
 assert.throws(()=>Edits.prepare(files,{'outside.rs':[]}));assert.throws(()=>Edits.offset(files['src/main.rs'],{line:99,character:0}));
});
test('language result mapping drops external locations and rejects external workspace edits',()=>{
 const files={'src/main.rs':'fn main(){}'},mapper=new LanguageResultMapper('/owned',files);
 const local={uri:'file:///owned/src/main.rs',range:range(0,3,7)},outside={uri:'file:///outside/src/main.rs',range:range(0,3,7)};
 assert.equal(mapper.locations([local,outside]).length,1);assert.throws(()=>mapper.edits({changes:{[outside.uri]:[{range:outside.range,newText:'bad'}]}}),/outside/);
 const completion=mapper.map('textDocument/completion',[{label:'main',textEdit:{range:range(0,3,7),newText:'main'}}],'src/main.rs',{line:0,character:4});assert.equal(completion.items.length,1);
});
test('language boundary validates method, file, name and positions before starting any process',async()=>{
 const session=new RustAnalyzerSession({spawnProcess:()=>assert.fail('Unexpected process launch')}),snapshot={files:{'Cargo.toml':'[package]\nname="test"\nversion="0.1.0"','src/main.rs':'fn main(){}'}};
 await assert.rejects(()=>session.request(snapshot,'workspace/executeCommand',{}),/Unsupported/);
 await assert.rejects(()=>session.request(snapshot,'textDocument/rename',{file:'src/main.rs',position:{line:0,character:3},newName:'bad name'}),/valid Rust/);
 await assert.rejects(()=>session.request(snapshot,'textDocument/definition',{file:'src/main.rs',position:{line:12,character:0}}),/outside/);
});
test('authenticated bridge carries language requests without exposing bearer credentials in snapshots',async()=>{
 const requests=[],language={request:async(...args)=>{requests.push(args);return {backend:'rust-analyzer',method:'textDocument/hover',text:'i32'};},dispose:async()=>{}};
 const bridge=new CargoBridgeServer({language}),connection=await bridge.listen(),client=new NativeCargoClient();
 try{await client.connect(connection.url,connection.token);const files={'Cargo.toml':'','src/main.rs':'fn main(){}'};const result=await client.language(files,'textDocument/hover',{file:'src/main.rs',position:{line:0,character:4}});assert.equal(result.text,'i32');assert.deepEqual(requests[0][0],{files});const unauthorized=await fetch(connection.url+'/v1/lsp',{method:'POST'});assert.equal(unauthorized.status,401);}finally{client.disconnect();await bridge.close();}
});
