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

function deferred() {
  let resolve;
  const promise = new Promise(value => { resolve = value; });
  return {promise, resolve};
}

function fixture({deferConnect, deferRelease, deferRequest, maxResponseBytes} = {}) {
  const calls = [];
  const client = new AgentClient({maxResponseBytes, fetcher: async (url, options) => {
    calls.push({url, options});
    if (url.endsWith('/capabilities')) return Response.json({version: '0.7'});
    if (url.endsWith('/ide/connect')) return deferConnect ? deferConnect.promise : Response.json({clientId: 'owner-id'});
    if (url.endsWith('/ide/disconnect')) return deferRelease ? deferRelease.promise : Response.json({disconnected: true});
    return deferRequest ? deferRequest.promise : Response.json({ok: true});
  }});
  return {client, calls};
}

async function until(predicate) {
  for (let i = 0; i < 100 && !predicate(); i++) await new Promise(resolve => setImmediate(resolve));
  assert.ok(predicate(), 'Fixture did not reach its expected state');
}

test('connection credentials and owner publish atomically after a delayed handshake', async () => {
  const gate = deferred(), {client, calls} = fixture({deferConnect: gate});
  const operation = client.connect('http://127.0.0.1:8790', 'test-private-token');
  await until(() => calls.length === 2);
  assert.ok(client.connecting);
  assert.equal(client.connected, false);
  assert.equal(client.url, null);
  assert.equal(client.token, null);
  assert.equal(client.clientId, null);
  await assert.rejects(client.request('/v1/ide/heartbeat', {}), /Connect the agent/);
  await assert.rejects(client.connect('http://127.0.0.1:8790', 'another-private-token'), /Disconnect/);
  assert.equal(calls.length, 2);
  gate.resolve(Response.json({clientId: 'delayed-owner'}));
  await operation;
  assert.equal(client.clientId, 'delayed-owner');
  assert.ok(client.connected);
  assert.equal(client.connecting, false);
  await client.disconnect();
});

test('disconnect cancels an in-flight handshake without clearing a subsequent connection', async () => {
  const gate = deferred(), {client, calls} = fixture({deferConnect: gate});
  const first = client.connect('http://127.0.0.1:8790', 'test-private-token');
  const rejected = assert.rejects(first, {name: 'AbortError'});
  await until(() => calls.length === 2);
  await client.disconnect();
  // The old transport deliberately ignores cancellation and returns late.
  const second = client.connect('http://127.0.0.1:8791', 'second-private-token');
  await until(() => calls.length === 4);
  gate.resolve(Response.json({clientId: 'new-owner'}));
  await rejected;
  await second;
  assert.equal(client.token, 'second-private-token');
  assert.equal(client.url, 'http://127.0.0.1:8791');
  assert.equal(client.clientId, 'new-owner');
  await client.disconnect();
});

test('disconnect aborts pending tools without retrying effects or accepting late output', async () => {
  const gate = deferred(), {client, calls} = fixture({deferRequest: gate});
  await client.connect('http://127.0.0.1:8790', 'test-private-token');
  const operation = client.request('/v1/tools/call', {name: 'workspace_apply'});
  const rejected = assert.rejects(operation, {name: 'AbortError'});
  await until(() => calls.length === 3);
  const toolSignal = calls[2].options.signal;
  await client.disconnect();
  assert.ok(toolSignal.aborted);
  gate.resolve(Response.json({ok: true}));
  await rejected;
  assert.equal(calls.filter(call => call.url.endsWith('/tools/call')).length, 1);
});

test('slow owner release cannot clear newly connected credentials', async () => {
  const release = deferred(), {client, calls} = fixture({deferRelease: release});
  await client.connect('http://127.0.0.1:8790', 'test-private-token');
  const closing = client.disconnect();
  assert.equal(client.url, null);
  await client.connect('http://127.0.0.1:8791', 'next-private-token');
  assert.equal(calls[2].options.headers.Authorization, 'Bearer test-private-token');
  release.resolve(Response.json({disconnected: true}));
  await closing;
  assert.equal(client.token, 'next-private-token');
});

test('bounded response reader counts streamed UTF-8 bytes and cancels overflow', async () => {
  const gate = deferred(), {client} = fixture({deferRequest: gate, maxResponseBytes: 64});
  await client.connect('http://127.0.0.1:8790', 'test-private-token');
  let cancelled = false;
  gate.resolve(new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('"' + '界'.repeat(22))); },
    cancel() { cancelled = true; }
  })));
  await assert.rejects(client.request('/v1/large'), /size limit/);
  assert.ok(cancelled);
  await client.disconnect();
});

test('invalid UTF-8 and JSON are rejected without manufacturing bridge results', async () => {
  for (const body of [new Uint8Array([0xff]), new TextEncoder().encode('{broken')]) {
    const gate = deferred(), {client} = fixture({deferRequest: gate});
    await client.connect('http://127.0.0.1:8790', 'test-private-token');
    gate.resolve(new Response(body));
    await assert.rejects(client.request('/v1/broken'));
    await client.disconnect();
  }
});

test('normalized traversal cannot send bearer credentials outside the API root', async () => {
  const {client, calls} = fixture();
  await client.connect('http://127.0.0.1:8790', 'test-private-token');
  for (const path of ['/v1/../mcp', '/v1/%2e%2e/mcp', '//example.com/v1/x', '/v1/\\x', '/v1/x#secret']) {
    await assert.rejects(client.request(path), /Invalid bridge/);
  }
  assert.equal(calls.length, 2);
  await client.disconnect();
});
