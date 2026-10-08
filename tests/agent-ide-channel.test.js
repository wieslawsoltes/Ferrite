import test from 'node:test';
import assert from 'node:assert/strict';
import {IdeChannel} from '../src/agent/server/IdeChannel.js';
import {EventLog} from '../src/agent/core/EventLog.js';

test('IDE channel rejects null ownership and clears stale state on disconnect', () => {
  const channel = new IdeChannel(new EventLog());
  assert.throws(() => channel.heartbeat(null, {revision: 1}), {code: 'IDE_OWNER'});
  const owner = channel.connect();
  channel.heartbeat(owner, {revision: 2});
  assert.equal(channel.inspect().connected, true);
  assert.equal(channel.inspect().state.revision, 2);
  channel.disconnect('someone-else');
  assert.equal(channel.inspect().connected, true);
  channel.disconnect(owner);
  assert.equal(channel.inspect().state, null);
  assert.throws(() => channel.heartbeat(owner, {revision: 3}), {code: 'IDE_OWNER'});
});
