import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile, readdir} from 'node:fs/promises';
import {resolve, dirname, relative} from 'node:path';
import {BrowserRuntime} from '../src/agent/browser/BrowserRuntime.js';
import {BrowserStore, BrowserLease} from '../src/agent/browser/BrowserStore.js';
import {BrowserWorkspace} from '../src/agent/browser/BrowserWorkspace.js';
import {BrowserCompiler} from '../src/agent/browser/BrowserCompiler.js';
import {BrowserTaskState, lineDiff} from '../src/agent/browser/BrowserTaskState.js';
import {BrowserProviderTransport} from '../src/agent/browser/BrowserProviderTransport.js';
import {BrowserApprovalGate} from '../src/agent/browser/BrowserApprovalGate.js';
import {QuestionGate} from '../src/agent/browser/QuestionGate.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {EventLog} from '../src/agent/core/EventLog.js';
import {ProviderRegistry} from '../src/agent/providers/ProviderRegistry.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {contentHash, sleep} from '../src/agent/core/Platform.js';
import {UnifiedPatch} from '../src/agent/tools/UnifiedPatch.js';

const files = () => ({'Cargo.toml':'[package]\nname="browser_demo"\nversion="0.1.0"\nedition="2021"\n','src/main.rs':'fn main() { let value = 3; println!("value = {}", value); }\n'});
const pureCompiler = () => { const operation = new CompilerOperation(); return {compile:async (files,command,options)=>operation.perform(files,command,options),close:async()=>{}}; };
async function runtime(t, options={}) {
  const value=await BrowserRuntime.create({model:new WorkspaceModel(files()),compiler:pureCompiler(),storeOptions:{indexedDB:null},leaseOptions:{locks:null},...options});t.after(()=>value.close());return value;
}
const config = {provider:'openai',model:'fixture',mode:'auto-edit',modelCompaction:false};

test('browser entry graph contains no Node modules, native server, or native filesystem imports',async()=>{
  const seen=new Set(), walk=async path=>{
    path=resolve(path);if(seen.has(path))return;seen.add(path);const source=await readFile(path,'utf8');
    for(const match of source.matchAll(/^import\s[^\n]*?from\s*['"]([^'"]+)['"]/gm)){
      assert.ok(match[1].startsWith('.'),'nonportable import '+path+' '+match[1]);const target=resolve(dirname(path),match[1]);
      assert.ok(!target.includes('/agent/server/'),'browser graph reaches native server '+target);await walk(target);
    }
  };
  await walk('src/agent/browser/BrowserRuntime.js'); assert.ok(seen.size>30);
});
test('Web Platform hashing is exact SHA-256 and cancellable delay rejects promptly',async()=>{
 assert.equal(await contentHash('abc'),'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');assert.equal(await contentHash(null),null);
 const controller=new AbortController(), waiting=sleep(10000,null,{signal:controller.signal});controller.abort();await assert.rejects(waiting,{name:'AbortError'});
});
test('browser store snapshots values, redacts complete records, enforces quota, and deletes accurately',async()=>{
 const store=await new BrowserStore('workspace',{indexedDB:null,sanitize:s=>s.replaceAll('private-secret','[REDACTED]'),maxRecordBytes:200,maxTotalBytes:250}).initialize();
 const input={nested:{key:'private-secret'}};const saved=store.write('sessions','task',input);input.nested.key='changed';await saved;
 assert.equal((await store.read('sessions','task')).nested.key,'[REDACTED]');assert.deepEqual(await store.list('sessions'),['task']);
 await assert.rejects(store.write('sessions','large',{text:'x'.repeat(300)}),{code:'SESSION_LIMIT'});
 await store.write('queues','queue',{text:'x'.repeat(180)});await assert.rejects(store.write('reviews','other',{text:'x'.repeat(100)}),{code:'STORE_QUOTA'});
 await store.delete('queues','queue');await store.write('reviews','other',{text:'x'.repeat(100)});await store.close();assert.throws(()=>store.write('sessions','task',{}),{code:'STORE_CLOSED'});
});
test('browser artifact ranges contain actual content and retain secret redaction',async t=>{
 const r=await runtime(t);r.providers.secrets.add('secret-credential');const id=await r.store.put('01234 secret-credential 56789');
 const value=await r.store.artifact(id,6,10);assert.equal(value.text,'[REDACTED]');assert.ok(value.nextOffset);await assert.rejects(r.store.artifact(id,-1),/range/);
});
test('browser mode advertises actual supported tools and rejects native process endpoints',async t=>{
 const r=await runtime(t),caps=r.capabilities();assert.equal(caps.environment,'browser');assert.equal(caps.nativeExecution,false);
 for(const name of ['browser_shell','cargo','compiler_execute','workspace_patch','rust_language','user_question'])assert.ok(caps.tools.some(t=>t.name===name));
 assert.ok(!caps.tools.some(t=>t.name==='process_exec'||t.name==='terminal_open'));
 await assert.rejects(r.route('/v1/terminals/open',{}),{code:'BROWSER_CAPABILITY'});
});
test('live browser edits create, replace, delete and undo as one transaction',async t=>{
 const r=await runtime(t),model=r.workspace.model,revision=model.revision;
 const before=await r.workspace.read('src/main.rs');const result=await r.workspace.apply([{path:'src/main.rs',expectedHash:before.hash,text:before.text.replace('= 3','= 4')},{path:'notes.txt',expectedHash:null,text:'notes'}]);
 assert.equal(model.revision,revision+1);assert.equal(model.files['notes.txt'],'notes');assert.equal((await r.store.read('checkpoints',result.checkpoint)).status,'applied');
 assert.equal(model.undoTransaction(),true);assert.ok(model.files['src/main.rs'].includes('= 3'));assert.ok(!Object.hasOwn(model.files,'notes.txt'));
 const removed=await r.workspace.apply([{path:'src/main.rs',expectedHash:before.hash,text:null}]);assert.ok(!Object.hasOwn(model.files,'src/main.rs'));await r.workspace.restore(removed.checkpoint);assert.equal(model.files['src/main.rs'],before.text);
});
test('browser checkpoint restoration rejects later manual changes without partial writes',async t=>{
 const r=await runtime(t),before=await r.workspace.read('src/main.rs'),result=await r.workspace.apply([{path:'src/main.rs',expectedHash:before.hash,text:'fn main() {}'}]);
 r.workspace.model.update('src/main.rs','fn main() { let user = 42; }');
 await assert.rejects(r.workspace.restore(result.checkpoint),{code:'EDIT_CONFLICT'});assert.ok(r.workspace.model.read('src/main.rs').includes('user = 42'));
});
test('edits occurring while checkpoint persistence awaits cannot be overwritten',async t=>{
 const r=await runtime(t),write=r.store.write.bind(r.store),before=await r.workspace.read('src/main.rs');
 r.store.write=(kind,id,value)=>{if(kind==='checkpoints'&&value.status==='prepared')r.workspace.model.update('src/main.rs','fn main() { let manual = 1; }');return write(kind,id,value);};
 await assert.rejects(r.workspace.apply([{path:'src/main.rs',expectedHash:before.hash,text:'fn main() {}'}]),{code:'EDIT_CONFLICT'});assert.match(r.workspace.model.read(),/manual/);
});
test('workspace replacement and revoked lifetime reject delayed edits and stale reads',async t=>{
 const r=await runtime(t),before=await r.workspace.read('src/main.rs');r.workspace.model.replace({'src/main.rs':'fn main() { let next = 5; }'});
 await assert.rejects(r.workspace.apply([{path:'src/main.rs',expectedHash:before.hash,text:'fn main() {}'}]),{code:'WORKSPACE_CHANGED'});await assert.rejects(r.workspace.snapshot(),{code:'WORKSPACE_CHANGED'});
});
test('credential files, traversal and generated folders are not exposed by workspace discovery',async t=>{
 const model=new WorkspaceModel({...files(),'.env':'dont-send','secrets.pem':'dont-send','target/cache.txt':'generated'}),r=await runtime(t,{model});
 const listing=await r.workspace.list();assert.ok(!listing.files.includes('.env'));assert.ok(!listing.files.includes('target/cache.txt'));
 await assert.rejects(r.workspace.read('.env'),{code:'PROTECTED_PATH'});await assert.rejects(r.workspace.read('src/../Cargo.toml'),{code:'UNSAFE_PATH'});
 const snap=await r.workspace.snapshot();assert.ok(!JSON.stringify(snap).includes('dont-send'));
});
test('browser shell performs real pipeline/redirection and retains per-session working directory',async t=>{
 const r=await runtime(t),ctx={mode:'trusted',sessionId:'one'};
 await r.tools.execute('browser_shell',{command:'cd src; printf "a\\nb\\n" > note.txt'},ctx);
 const result=await r.tools.execute('browser_shell',{command:'pwd; cat note.txt | wc -l'},ctx);assert.equal(result.text,'/src\n2\n');assert.equal(r.workspace.model.files['src/note.txt'],'a\nb\n');
 const other=await r.tools.execute('browser_shell',{command:'pwd'},{mode:'trusted',sessionId:'two'});assert.equal(other.text,'/\n');
 const unsupported=await r.tools.execute('browser_shell',{command:'curl https://example.com'},ctx);assert.equal(unsupported.code,1);
});
test('browser shell cannot read excluded credentials or write protected paths through redirection',async t=>{
 const r=await runtime(t,{model:new WorkspaceModel({...files(),'.env':'secret'})});
 const result=await r.tools.execute('browser_shell',{command:'cat .env'},{mode:'trusted'});assert.equal(result.code,1);assert.ok(!result.text.includes('secret'));
 await assert.rejects(r.tools.execute('browser_shell',{command:'echo overwrite > .env'},{mode:'trusted'}),{code:'PROTECTED_PATH'});assert.equal(r.workspace.model.files['.env'],'secret');
});
test('browser cargo genuinely compiles and runs Rust, while rejecting unsupported native operations',async t=>{
 const r=await runtime(t);const run=await r.tools.execute('cargo',{args:['run']},{mode:'trusted'});assert.equal(run.code,0);assert.match(run.text,/value = 3/);
 await assert.rejects(r.tools.execute('cargo',{args:['install','cargo-something']},{mode:'trusted'}),{code:'NATIVE_REQUIRED'});
 await assert.rejects(r.tools.execute('cargo',{args:['build','--jobs','8']},{mode:'trusted'}),{code:'NATIVE_REQUIRED'});
 const stages=await r.tools.execute('compiler_analyze',{});assert.equal(stages.stages.length,21);
});
test('browser language derives hover/definition/references and rename previews from typed binding identity',async t=>{
 const r=await runtime(t),text=r.workspace.model.read('src/main.rs'),character=text.lastIndexOf('value');
 const params={position:{line:0,character}};
 const hover=await r.language.request('textDocument/hover',{path:'src/main.rs',params});assert.match(hover.contents.value,/value: i32/);
 const def=await r.language.request('textDocument/definition',{path:'src/main.rs',params});assert.equal(def.range.start.character,text.indexOf('value'));
 const refs=await r.language.request('textDocument/references',{path:'src/main.rs',params});assert.equal(refs.length,2);
 const edit=await r.language.request('textDocument/rename',{path:'src/main.rs',params:{...params,newName:'answer'}});assert.equal(Object.values(edit.changes)[0].length,2);assert.equal(r.workspace.model.read('src/main.rs'),text);
 await assert.rejects(r.language.request('textDocument/rename',{path:'src/main.rs',params:{...params,newName:'fn'}}),/identifier/);
 await assert.rejects(r.language.request('textDocument/formatting',{path:'src/main.rs'}),{code:'BROWSER_LANGUAGE_METHOD'});
});
test('browser language keeps shadowed bindings distinct',async t=>{
 const source='fn main() { let n = 1; println!("{}", n); let n = 2; println!("{}", n); }';
 const r=await runtime(t,{model:new WorkspaceModel({...files(),'src/main.rs':source})});
 const refs=await r.language.request('textDocument/references',{path:'src/main.rs',params:{position:{line:0,character:source.lastIndexOf('n)')}}});
 assert.equal(refs.length,2);assert.ok(refs.every(ref=>ref.range.start.character>source.indexOf('let n = 2')));
});
test('browser provider transport never sends credentials to arbitrary endpoints and opts into Anthropic browser access',async()=>{
 const requests=[],transport=new BrowserProviderTransport({fetcher:async(url,options)=>{requests.push({url,options});return Response.json({data:[]});}});
 await transport.request('https://api.anthropic.com/v1/models?limit=100',{method:'GET',headers:{'x-api-key':'private'}});
 assert.equal(requests[0].options.headers['anthropic-dangerous-direct-browser-access'],'true');assert.equal(requests[0].options.credentials,'omit');assert.equal(requests[0].options.redirect,'error');
 await assert.rejects(transport.request('https://api.openai.com.evil.test/v1/responses',{headers:{Authorization:'Bearer private'}}),{code:'PROVIDER_ORIGIN'});
 await assert.rejects(transport.request('https://api.openai.com/v1/files',{headers:{Authorization:'Bearer private'}}),{code:'PROVIDER_ORIGIN'});assert.equal(requests.length,1);
});
test('browser API sign-in requires explicit consent and stores keys only in memory',async t=>{
 const providers=new ProviderRegistry({environment:{},transport:new BrowserProviderTransport({fetcher:async()=>Response.json({data:[{id:'fixture'}]})})}),r=await runtime(t,{providers});
 await assert.rejects(r.route('/v1/providers/connect',{provider:'openai',key:'secret-credential'}),{code:'BROWSER_KEY_CONSENT'});
 await r.route('/v1/providers/connect',{provider:'openai',key:'secret-credential',browserConsent:true});assert.equal(r.providers.list()[0].connected,true);
 await r.harness.create(config,{objective:'Never expose secret-credential'});assert.ok(!JSON.stringify([...r.store.memory.values()]).includes('secret-credential'));
 await r.route('/v1/providers/disconnect',{provider:'openai'});assert.equal(r.providers.list()[0].connected,false);
});
test('browser per-tool permissions deny reads and cannot grant writes in read-only mode',async()=>{
 const gate=new BrowserApprovalGate(new EventLog());let stopped;gate.onDenied=id=>{stopped=id;};
 await assert.rejects(gate.authorize({name:'workspace_read',risk:'read'},{},{sessionId:'task',mode:'trusted',session:{config:{toolRules:{workspace_read:'deny'}}}}),{code:'TOOL_DENIED'});assert.equal(stopped,'task');
 await assert.rejects(gate.authorize({name:'workspace_apply',risk:'edit'},{},{mode:'read-only',session:{config:{toolRules:{workspace_apply:'allow'}}}}),{code:'READ_ONLY'});
 const pending=gate.authorize({name:'workspace_read',risk:'read'},{},{interactive:true,mode:'read-only',session:{config:{toolRules:{workspace_read:'ask'}}}});assert.equal(gate.list().length,1);gate.resolve(gate.list()[0].id,true);await pending;
});
test('human questions are one-shot task data and cancellation removes pending UI requests',async()=>{
 const events=new EventLog(),gate=new QuestionGate(events);const question=gate.ask('Which name?',['Answer'],{interactive:true});const id=gate.list()[0].id;gate.answer(id,'Answer');assert.deepEqual(await question,{answer:'Answer',grantsPermissions:false});assert.throws(()=>gate.answer(id,'Again'));
 const c=new AbortController(),pending=gate.ask('Cancelled?',[],{interactive:true,signal:c.signal});c.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(gate.list().length,0);
});
test('line review preserves exact CRLF/final-newline and hunk restoration protects newer source',async t=>{
 const before='one\r\ntwo\r\nthree',after='one\r\nTWO\r\nthree\nfour';const diff=lineDiff(before,after);
 assert.equal(diff.rows.filter(r=>r.kind!=='+').map(r=>r.text).join(''),before);assert.equal(diff.rows.filter(r=>r.kind!=='-').map(r=>r.text).join(''),after);
 const r=await runtime(t),tasks=new BrowserTaskState(r);await tasks.begin('task');const source=await r.workspace.read('src/main.rs');await r.workspace.apply([{path:source.path,expectedHash:source.hash,text:source.text.replace('= 3','= 4')}]);
 const comparison=await tasks.compare('task');assert.equal(comparison.changes.length,1);await tasks.restore(comparison.changes[0],0);assert.equal(r.workspace.model.read('src/main.rs'),source.text);
 await assert.rejects(tasks.restore(comparison.changes[0]),{code:'EDIT_CONFLICT'});
});
test('follow-up queues persist explicit data, enforce versions, reorder and never launch a model',async t=>{
 const r=await runtime(t),tasks=new BrowserTaskState(r),one=await tasks.add('task','First'),two=await tasks.add('task','Second');
 await tasks.change('task',two.id,two.version,'up');assert.equal((await tasks.items('task'))[0].text,'Second');
 await tasks.change('task',one.id,one.version,'edit','Updated');await assert.rejects(tasks.change('task',one.id,one.version,'remove'),/changed/);
 assert.equal(r.harness.active.size,0);assert.equal(r.providers.providers.size,0);
});
test('in-page MCP discovery calls the real browser tool registry without a listener or process',async t=>{
 const r=await runtime(t);const init=await r.mcp.handle({jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-11-25',capabilities:{},clientInfo:{name:'fixture',version:'1'}}});assert.ok(init.result);
 await r.mcp.handle({jsonrpc:'2.0',method:'notifications/initialized'});
 const result=await r.mcp.handle({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'workspace_read',arguments:{path:'src/main.rs'}}});assert.ok(JSON.stringify(result).includes('value = {}'));
});
test('browser compiler abort destroys its worker and ignores late completion',async()=>{
 let terminated=0,worker;const compiler=new BrowserCompiler({workerFactory:()=>worker={postMessage(){},terminate(){terminated++;}},timeoutMs:5000});
 const c=new AbortController(),pending=compiler.compile(files(),'check',{},c.signal);await Promise.resolve();await Promise.resolve();c.abort();await assert.rejects(pending,{name:'AbortError'});assert.equal(terminated,1);await compiler.close();
});
test('shared harness runs an entire browser read-edit-compile task with real tool outcomes',async t=>{
 const providers=new ProviderRegistry({environment:{}});let turn=0;
 providers.providers.set('openai',{complete:async({messages})=>{
   const text=messages.findLast(m=>m.role==='tool')?.text,result=text?JSON.parse(text):null;
   const calls=++turn===1?[{id:'read',name:'workspace_read',arguments:{path:'src/main.rs'}}]:turn===2?[{id:'edit',name:'workspace_apply',arguments:{changes:[{path:'src/main.rs',expectedHash:result.hash,text:result.text.replace('= 3','= 9')}]}}]:turn===3?[{id:'run',name:'compiler_execute',arguments:{mode:'run'}}]:[];
   if(turn===4)assert.match(result.output,/value = 9/);
   return {role:'assistant',text:calls.length?'':'Verified browser output',calls,usage:{input:50,output:25}};
 }});
 const r=await runtime(t,{providers}),session=await r.harness.create({...config,mode:'trusted'});
 await assert.rejects(r.route('/v1/sessions/'+session.id+'/start',{prompt:'Fix',config:{...config,mode:'trusted'}}),{code:'BROWSER_FULL_CONSENT'});
 await r.route('/v1/sessions/'+session.id+'/start',{prompt:'Fix value and run it',fullAccessConfirmed:true});await r.harness.wait(session.id);
 assert.equal(session.status,'completed');assert.match(r.workspace.model.read('src/main.rs'),/= 9/);assert.equal(turn,4);assert.equal(session.usage.input,200);assert.equal((await r.store.list('checkpoints')).length,1);
});
