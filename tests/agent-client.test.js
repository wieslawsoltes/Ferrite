import test from 'node:test';
import assert from 'node:assert/strict';
import {AgentClient} from '../src/ui/agent/AgentClient.js';

for (const injected of [false, true]) {
  test(`agent fetch has the global receiver (${injected ? 'injected' : 'default'})`, async t => {
    const calls = [];
    async function fetcher(url, options) {
      assert.equal(this, globalThis, 'Native Window.fetch rejects an AgentClient receiver');
      calls.push({url, options});
      return Response.json(url.endsWith('/connect') ? {clientId: 'browser-owner'} : {version: '0.7'});
    }
    if (!injected) t.mock.method(globalThis, 'fetch', fetcher);
    const client = new AgentClient(injected ? {fetcher} : {});
    assert.deepEqual(await client.connect('http://127.0.0.1:8790', 'test-private-token'), {version: '0.7'});
    assert.equal(client.clientId, 'browser-owner');
    await client.disconnect();
    assert.deepEqual(calls.map(call => new URL(call.url).pathname), [
      '/v1/capabilities', '/v1/ide/connect', '/v1/ide/disconnect'
    ]);
    for (const {url, options} of calls) {
      assert.equal(options.headers.Authorization, 'Bearer test-private-token');
      assert.equal(options.redirect, 'error');
      assert.equal(options.cache, 'no-store');
      assert.ok(options.signal instanceof AbortSignal);
      assert.ok(!url.includes('test-private-token'));
    }
    assert.equal(client.token, null);
    assert.equal(client.clientId, null);
  });
}

test('agent client rejects a missing transport before retaining credentials', () => {
  assert.throws(() => new AgentClient({fetcher: null}), /fetch implementation/);
});
