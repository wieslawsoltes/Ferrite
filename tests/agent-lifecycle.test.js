import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {TerminalView} from '../src/ui/agent/TerminalView.js';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
import {AgentBridgeServer} from '../src/agent/server/AgentBridgeServer.js';
import {JsonSchema} from '../src/agent/core/JsonSchema.js';

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return {promise, resolve};
}

test('closing a terminal cannot close a different tab selected during the request', async () => {
  const pending = deferred(), requests = [];
  const view = {
    active: 'first', sessions: new Map([['browser', {}], ['first', {}], ['second', {}]]),
    client: {request(path) { requests.push(path); return pending.promise; }},
    updateTabs() {}, draw() {}, onError(error) { throw error; }
  };
  const closing = TerminalView.prototype.closeActive.call(view);
  view.active = 'second';
  pending.resolve({closed: true});
  await closing;
  assert.deepEqual(requests, ['/v1/terminals/first/close']);
  assert.equal(view.active, 'second');
  assert.deepEqual([...view.sessions.keys()], ['browser', 'second']);
});

test('disconnect drops native terminal views without closing the host processes', () => {
  const browser = {}, view = {
    active: 'first', sessions: new Map([['browser', browser], ['first', {}]]),
    updateTabs() {}, draw() {}
  };
  TerminalView.prototype.disconnect.call(view);
  assert.equal(view.active, 'browser');
  assert.deepEqual([...view.sessions], [['browser', browser]]);
});

test('HTTP provider sign-out cancels an active run before a late response can execute tools', async t => {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-account-lifecycle-'));
  await mkdir(join(root, 'workspace'));
  const runtime = await AgentRuntime.create({root: join(root, 'workspace'), state: join(root, 'state'), environment: {}});
  const bridge = new AgentBridgeServer(runtime), pending = deferred(), entered = deferred();
  t.after(async () => {
    pending.resolve({role: 'assistant', text: '', calls: [], usage: {}});
    await bridge.close();
    await rm(root, {recursive: true, force: true});
  });
  let effects = 0;
  runtime.tools.register({name: 'late_effect', description: 'Test-only effect', risk: 'edit', inputSchema: JsonSchema.object(), run: () => { effects++; return {}; }});
  runtime.providers.providers.set('openai', {complete: async () => { entered.resolve(); return pending.promise; }});
  const connection = await bridge.listen();
  const session = await runtime.harness.create({provider: 'openai', model: 'fixture', mode: 'auto-edit', modelCompaction: false});
  await runtime.harness.start(session.id, 'Exercise cancellation');
  await entered.promise;
  const response = await fetch(connection.url + '/v1/providers/disconnect', {
    method: 'POST', headers: {Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json'},
    body: JSON.stringify({provider: 'openai'})
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {disconnected: true});
  pending.resolve({role: 'assistant', text: 'Too late', calls: [{id: 'late', name: 'late_effect', arguments: {}}], usage: {}});
  await runtime.harness.wait(session.id);
  assert.equal(session.status, 'cancelled');
  assert.equal(effects, 0);
  assert.throws(() => runtime.providers.get('openai'), {code: 'PROVIDER_NOT_CONNECTED'});
});
