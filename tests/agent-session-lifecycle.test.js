import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventLog} from '../src/agent/core/EventLog.js';
import {ApprovalGate} from '../src/agent/core/ApprovalGate.js';
import {PrivateStore} from '../src/agent/server/PrivateStore.js';
import {NativeWorkspace} from '../src/agent/server/NativeWorkspace.js';
import {ToolRegistry} from '../src/agent/core/ToolRegistry.js';
import {AgentHarness} from '../src/agent/core/AgentHarness.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-agent-test-')); t.after(() => rm(root, {recursive:true,force:true}));
  await mkdir(join(root,'workspace')); const events = new EventLog();
  const store = await new PrivateStore(join(root,'state')).initialize();
  const workspace = await new NativeWorkspace(join(root,'workspace'), {store,events}).initialize();
  return {root,store,workspace,events};
}

async function harnessFixture(t,responses){
  const f=await fixture(t),approvals=new ApprovalGate(f.events),tools=new ToolRegistry({events:f.events,approvals,artifacts:f.store});
  const provider={complete:async request=>{const next=responses.shift();if(next instanceof Error)throw next;return typeof next==='function'?next(request):next;}};
  const providers={get:()=>provider,redact:text=>String(text).replaceAll('secret-key','[REDACTED]')};
  const harness=new AgentHarness({...f,tools,providers,retryDelay:async()=>{}});t.after(()=>harness.close());
  return {...f,tools,harness,approvals};
}
const answer=(text,calls=[])=>({role:'assistant',text,calls,usage:{input:10,output:4}});
const config={provider:'openai',model:'fixture',modelCompaction:false};

test('concurrent session hydration shares a single mutable session and recovery pass', async t => {
  const f = await harnessFixture(t, []);
  const original = await f.harness.create(config);
  f.harness.sessions.delete(original.id);
  const read = f.store.read.bind(f.store); let reads = 0;
  f.store.read = async (...args) => { reads++; await new Promise(resolve => setImmediate(resolve)); return read(...args); };
  const [first, second] = await Promise.all([f.harness.get(original.id), f.harness.get(original.id)]);
  assert.equal(first, second);
  assert.equal(reads, 1);
});

test('manual compaction reserves the session before IO and can be stopped without losing history', async t => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  const f = await harnessFixture(t, [async () => { entered(); return pending; }]);
  const session = await f.harness.create({...config, modelCompaction: true});
  session.messages = Array.from({length: 10}, (_, index) => ({role: index % 2 ? 'assistant' : 'user', text: 'turn ' + index}));
  session.transcript = structuredClone(session.messages);
  const before = structuredClone(session.messages);
  const operation = f.harness.compactIdle(session.id);
  const rejected = assert.rejects(operation, {name: 'AbortError'});
  await assert.rejects(f.harness.start(session.id, 'Race the compaction'), {code: 'SESSION_BUSY'});
  await assert.rejects(f.harness.compactIdle(session.id), {code: 'SESSION_BUSY'});
  await assert.rejects(f.harness.fork(session.id), {code: 'SESSION_BUSY'});
  await started;
  await f.harness.cancel(session.id);
  finish(answer('Late summary must not replace history'));
  await rejected;
  assert.deepEqual(session.messages, before);
  assert.equal(session.status, 'idle');
  assert.equal(session.summary, '');
  assert.equal(f.harness.active.size, 0);
  assert.ok(session.events.some(event => event.type === 'context.compaction-finished' && event.cancelled));
});

test('late provider completion after stop cannot mark the session successful', async t => {
  let entered, finish;
  const started = new Promise(resolve => { entered = resolve; });
  const pending = new Promise(resolve => { finish = resolve; });
  const f = await harnessFixture(t, [async () => { entered(); return pending; }]);
  const session = await f.harness.create(config);
  await f.harness.start(session.id, 'Task'); await started;
  await f.harness.cancel(session.id);
  finish(answer('Late completion'));
  await f.harness.wait(session.id);
  assert.equal(session.status, 'cancelled');
  assert.ok(!session.transcript.some(message => message.text === 'Late completion'));
});
