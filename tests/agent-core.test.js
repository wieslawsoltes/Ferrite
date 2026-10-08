import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, readFile, symlink, stat, rm, mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventLog} from '../src/agent/core/EventLog.js';
import {JsonSchema} from '../src/agent/core/JsonSchema.js';
import {ApprovalGate} from '../src/agent/core/ApprovalGate.js';
import {PrivateStore} from '../src/agent/server/PrivateStore.js';
import {NativeWorkspace} from '../src/agent/server/NativeWorkspace.js';
import {ContextManager} from '../src/agent/core/ContextManager.js';
import {ToolRegistry} from '../src/agent/core/ToolRegistry.js';
import {AgentHarness} from '../src/agent/core/AgentHarness.js';
import {AgentError} from '../src/agent/core/AgentError.js';
import {TerminalManager} from '../src/agent/terminal/TerminalManager.js';
import {CompilerService} from '../src/agent/server/CompilerService.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-agent-test-')); t.after(() => rm(root, {recursive:true,force:true}));
  await mkdir(join(root,'workspace')); const events = new EventLog();
  const store = await new PrivateStore(join(root,'state')).initialize();
  const workspace = await new NativeWorkspace(join(root,'workspace'), {store,events}).initialize();
  return {root,store,workspace,events};
}

test('agent schemas reject extra fields, invalid ranges and prototype keys', () => {
  const schema=JsonSchema.object({path:{type:'string',minLength:1},count:{type:'integer',minimum:1,maximum:5}},['path']);
  assert.deepEqual(JsonSchema.validate({path:'x'},schema),{path:'x'});
  for(const value of [{path:''},{path:'x',count:6},{path:'x',approve:true},JSON.parse('{"path":"x","__proto__":{}}')]) assert.throws(()=>JsonSchema.validate(value,schema));
});
test('event replay reports gaps and isolates broken observers',()=>{
  const log=new EventLog({limit:2}); log.subscribe(()=>{throw Error('observer');});
  log.emit('one');log.emit('two');log.emit('three');
  assert.deepEqual(log.read(0).events.map(e=>e.type),['two','three']); assert.equal(log.read(0).gap,true);assert.equal(log.read(1).gap,false);assert.equal(log.read(10).gap,true);
});
test('approval gate is one-shot, deny-by-default and abortable',async()=>{
  const events=new EventLog(),gate=new ApprovalGate(events);const tool={name:'write',risk:'edit'};
  await assert.rejects(gate.authorize(tool,{},{}),{code:'APPROVAL_REQUIRED'});
  await assert.rejects(gate.authorize(tool,{}, {mode:'read-only',allow:new Set(['edit'])}),{code:'READ_ONLY'});
  const pending=gate.authorize(tool,{path:'x'},{interactive:true,sessionId:'one'},{before:'a',after:'b'});
  const [approval]=gate.list();assert.equal(approval.sessionId,'one');gate.resolve(approval.id,true);await pending;
  assert.throws(()=>gate.resolve(approval.id,true),{code:'APPROVAL_EXPIRED'});
  const abort=new AbortController(),cancelled=gate.authorize(tool,{}, {interactive:true,signal:abort.signal});abort.abort();await assert.rejects(cancelled,{code:'APPROVAL_DENIED'});assert.equal(gate.list().length,0);
});
test('private store supports restart and atomic writes with private permissions',async t=>{
  const {store}=await fixture(t);await store.write('sessions','one',{value:1});await store.initialize();
  await Promise.all([store.write('sessions','one',{value:2}),store.write('sessions','one',{value:3})]);assert.equal((await store.read('sessions','one')).value,3);
  assert.equal((await stat(store.path('sessions','one'))).mode&0o777,0o600);assert.throws(()=>store.path('sessions','../x'));
  const id=await store.put('abcdef');assert.equal((await store.artifact(id,2,2)).text,'cd');
});
test('private store refuses symbolic-link storage directories',async t=>{
  const {root}=await fixture(t),bad=join(root,'bad');await mkdir(bad);await symlink(join(root,'workspace'),join(bad,'sessions'));
  await assert.rejects(new PrivateStore(bad).initialize(),/real directories/);
});
test('workspace transactions enforce hashes, private paths and reversible checkpoints',async t=>{
  const {workspace,root}=await fixture(t);const change=await workspace.apply([{path:'src/main.rs',expectedHash:null,text:'fn main() {}\n'}]);
  const read=await workspace.read('src/main.rs');assert.equal(read.hash,NativeWorkspace.hash('fn main() {}\n'));
  await assert.rejects(workspace.apply([{path:'src/main.rs',expectedHash:null,text:'bad'}]),{code:'EDIT_CONFLICT'});
  for(const path of ['../x','.git/config','.env','keys/private.pem']) await assert.rejects(workspace.read(path));
  await symlink(join(root,'state'),join(workspace.root,'outside'));await assert.rejects(workspace.text('outside/test'),{code:'SYMLINK_DENIED'});
  await workspace.restore(change.checkpoint);assert.equal(await workspace.text('src/main.rs',{optional:true}),null);
});
test('workspace compensates earlier writes after later write failure',async t=>{
  const {workspace}=await fixture(t);await writeFile(join(workspace.root,'one'),'old');
  const write=workspace.atomicWrite.bind(workspace);workspace.atomicWrite=async(path,text)=>{if(path==='two')throw Error('injected failure');return write(path,text);};
  await assert.rejects(workspace.apply([{path:'one',expectedHash:NativeWorkspace.hash('old'),text:'new'},{path:'two',expectedHash:null,text:'x'}]),/injected/);
  assert.equal(await workspace.text('one'),'old');const checkpoints=await workspace.store.list('checkpoints');assert.equal((await workspace.store.read('checkpoints',checkpoints[0])).status,'failed');
});
test('compaction retains complete tool transactions and full transcript',async()=>{
  const messages=[{role:'user',text:'Do not change public API'}];
  for(let n=0;n<12;n++)messages.push({role:'assistant',text:'Investigating '+n,calls:[{id:'c'+n,name:'read',arguments:{}}]},{role:'tool',callId:'c'+n,name:'read',text:'long source '.repeat(1000)});
  const session={objective:'Preserve API',messages,transcript:structuredClone(messages),summary:'',plan:[{step:'test',status:'pending'}]};
  const manager=new ContextManager({contextTokens:16384,outputTokens:1024}),result=await manager.compact(session,{force:true});
  assert.ok(result.removedMessages>0);assert.doesNotThrow(()=>ContextManager.groups(session.messages));assert.equal(session.transcript.length,messages.length);assert.match(manager.system(session,''),/Preserve API/);assert.ok(manager.measure(session,'',[])<16384);
});
test('compaction rejects orphaned protocol messages and uses deterministic fallback',async()=>{
  assert.throws(()=>ContextManager.groups([{role:'tool',callId:'a'}]),{code:'INVALID_HISTORY'});
  const session={messages:Array.from({length:8},(_,i)=>({role:i%2?'assistant':'user',text:'turn '+i})),objective:'keep',summary:''};
  const result=await new ContextManager().compact(session,{force:true,summarize:async()=>{throw Error('offline');}});assert.equal(result.method,'deterministic-fallback');
});

async function harnessFixture(t,responses){
  const f=await fixture(t),approvals=new ApprovalGate(f.events),tools=new ToolRegistry({events:f.events,approvals,artifacts:f.store});
  const provider={complete:async request=>{const next=responses.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(request):next;}};
  const providers={get:()=>provider,redact:text=>String(text).replaceAll('secret-key','[REDACTED]')};
  const harness=new AgentHarness({...f,tools,providers,retryDelay:async()=>{}});t.after(()=>harness.close());
  return {...f,tools,harness,approvals};
}
const answer=(text,calls=[])=>({role:'assistant',text,calls,usage:{input:10,output:4}});
const config={provider:'openai',model:'fixture',modelCompaction:false};
test('harness retries transient model failures but executes side effects once',async t=>{
  let count=0;const f=await harnessFixture(t,[new AgentError('RETRY','retry',{retryable:true}),answer('editing',[{id:'call1',name:'edit',arguments:{}}]),answer('done')]);
  f.tools.register({name:'edit',description:'Edit fixture',inputSchema:JsonSchema.object(),risk:'edit',run:async()=>({count:++count})});
  const s=await f.harness.create({...config,mode:'auto-edit'});await f.harness.start(s.id,'Fix secret-key');await f.harness.wait(s.id);
  assert.equal(s.status,'completed');assert.equal(count,1);assert.equal(s.ledger.call1.status,'completed');assert.match(s.objective,/REDACTED/);assert.ok(s.events.some(e=>e.type==='model.retry'));
});
test('denied tool results return to the model without executing and duplicate runs are rejected',async t=>{
  let count=0;const f=await harnessFixture(t,[answer('try',[{id:'call1',name:'edit',arguments:{}}]),answer('denied')]);
  f.tools.register({name:'edit',description:'Edit fixture',inputSchema:JsonSchema.object(),risk:'edit',run:async()=>({count:++count})});
  const s=await f.harness.create({...config,mode:'read-only'});await f.harness.start(s.id,'read only');await assert.rejects(f.harness.start(s.id,'duplicate'),{code:'SESSION_BUSY'});await f.harness.wait(s.id);
  assert.equal(count,0);assert.equal(s.messages[2].error,true);assert.match(s.messages[2].text,/READ_ONLY/);
});
test('restart repairs uncertain tool outcomes without re-execution',async t=>{
  const f=await harnessFixture(t,[]);const s=await f.harness.create(config);s.status='running';s.messages=[{role:'user',text:'task'},answer('running',[{id:'c1',name:'edit',arguments:{}}])];s.transcript=structuredClone(s.messages);s.ledger.c1={status:'started'};await f.harness.save(s);f.harness.sessions.clear();
  const loaded=await f.harness.get(s.id);assert.equal(loaded.status,'interrupted');assert.match(loaded.messages.at(-1).text,/INTERRUPTED_OUTCOME_UNKNOWN/);assert.doesNotThrow(()=>ContextManager.groups(loaded.messages));
});
test('compiler runs off-thread and exposes the real compiler stages',async t=>{
  const service=new CompilerService();t.after(()=>service.close());const build=await service.compile({'Cargo.toml':'[package]\nname="agent_test"\nversion="0.1.0"\n','src/main.rs':'fn main() { println!("hello"); }'});
  assert.equal(build.diagnostics.filter(d=>d.severity==='error').length,0);assert.ok(build.stages.length>=20);
});
test('native PTY supports interactive input, Unicode, resize and exit', {skip:process.platform==='win32',timeout:15000},async t=>{
  const f=await fixture(t),terminals=new TerminalManager(f.workspace,f.events);t.after(()=>terminals.dispose());
  const terminal=await terminals.start({executable:'/bin/sh',args:['-i'],cols:80,rows:24});terminals.resize(terminal.id,97,31);
  terminals.input(terminal.id,"printf 'PTY_OK_Żółć\\n'; stty size; exit 7\n");
  await terminals.get(terminal.id).exited;const result=terminals.read(terminal.id);assert.equal(result.exitCode,7);const text=result.events.filter(e=>e.type==='data').map(e=>e.text).join('');assert.match(text,/PTY_OK_Żółć/);assert.match(text,/31 97/);
});
