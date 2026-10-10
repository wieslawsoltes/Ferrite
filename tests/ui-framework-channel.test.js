import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {PreviewChannel} from '../src/ui/studio/PreviewChannel.js';

function fixture(options = {}) {
  const host = new EventTarget(); host.crypto = webcrypto;
  const sent = [], attributes = new Map(), contentWindow = {postMessage: value => sent.push(value)};
  const frame = {contentWindow, setAttribute: (k, v) => attributes.set(k, v), removeAttribute: key => attributes.delete(key)};
  const events = [], channel = new PreviewChannel(frame, {window: host, onEvent: value => events.push(value), ...options});
  const token = channel.reset();
  const receive = (data, changes = {}) => channel.receive({source: contentWindow, origin: 'null', data: {type: 'ferrite-ui', channel: token, ...data}, ...changes});
  return {channel, token, frame, host, sent, attributes, events, receive};
}

test('preview requires matching opaque origin, exact frame and capability', async () => {
  const f = fixture();
  assert.equal(f.attributes.get('sandbox'), 'allow-scripts');
  for (const change of [{source: {}}, {origin: 'https://example.com'}, {data: {type: 'ferrite-ui', channel: 'bad', event: 'ready'}}]) f.receive({event: 'ready'}, change);
  assert.equal(f.channel.ready, false); assert.equal(f.events.length, 0);
  await assert.rejects(f.channel.request('inspect'), /Compile/);
  f.receive({event: 'ready'}); const pending = f.channel.request('inspect', {channel: 'forged', id: 'forged', command: 'forged'});
  const message = f.sent.at(-1); assert.equal(message.channel, f.token); assert.equal(message.command, 'inspect');
  f.receive({reply: message.id, result: {commits: 3}}); assert.deepEqual(await pending, {commits: 3});
  assert.equal(f.channel.pending.size, 0); f.channel.dispose();
});
test('replacement rejects pending work and refuses stale HTML and old replies', async () => {
  const f = fixture(); f.receive({event: 'ready'}); const pending = f.channel.request('inspect');
  const rejected = assert.rejects(pending, {name: 'AbortError'}); const next = f.channel.reset(); await rejected;
  assert.notEqual(next, f.token); assert.equal(f.channel.ready, false);
  assert.throws(() => f.channel.load('<p>old</p>', f.token), /Stale/);
  f.channel.load('<p>new</p>', next); assert.equal(f.frame.srcdoc, '<p>new</p>');
  f.receive({event: 'ready'}); assert.equal(f.channel.ready, false); f.channel.dispose();
});
test('preview abort, timeout, errors and disposal release pending handlers', async () => {
  const f = fixture({timeoutMs: 10}); f.receive({event: 'ready'});
  const abort = new AbortController(), pending = f.channel.request('inspect', {}, {signal: abort.signal}); abort.abort();
  await assert.rejects(pending, {name: 'AbortError'}); assert.equal(f.channel.pending.size, 0);
  await assert.rejects(f.channel.request('inspect'), /timed out/);
  const failed = f.channel.request('inspect'); f.receive({reply: f.sent.at(-1).id, error: {code: 'R_UI', message: 'failed'}});
  await assert.rejects(failed, {code: 'R_UI'});
  const disposed = f.channel.request('inspect'); const rejection = assert.rejects(disposed, {name: 'AbortError'}); f.channel.dispose(); await rejection;
  assert.equal(f.channel.pending.size, 0); assert.equal(f.channel.ready, false); f.channel.dispose();
});

test('readiness waiters resolve once, handle already-ready previews and release listeners', async () => {
  const f=fixture();const first=f.channel.waitUntilReady(), second=f.channel.waitUntilReady();
  f.receive({event:'ready'});await Promise.all([first,second]);await f.channel.waitUntilReady();assert.equal(f.channel.pending.size,0);f.channel.dispose();
});
test('readiness cannot arm a replaced, failed, stopped or timed-out preview', async () => {
  for(const action of ['replace','error','stop','timeout']) {
    const f=fixture({timeoutMs:10}), abort=new AbortController();
    const pending=f.channel.waitUntilReady({signal:abort.signal}), rejected=assert.rejects(pending);
    if(action==='replace')f.channel.reset();else if(action==='error')f.receive({event:'error',error:{message:'Mount failed'}});else if(action==='stop')abort.abort();
    await rejected;assert.equal(f.channel.pending.size,0);f.channel.dispose();
  }
});
