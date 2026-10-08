import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm, readFile, stat, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {StateLease} from '../src/agent/server/StateLease.js';

test('state lease excludes concurrent writers, is private and never removes another owner', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-lease-'));
  try {
    const first = await StateLease.acquire(root);
    assert.equal((await stat(first.path)).mode & 0o777, 0o600);
    assert.equal(JSON.parse(await readFile(first.path, 'utf8')).pid, process.pid);
    await assert.rejects(StateLease.acquire(root), {code: 'STATE_BUSY'});
    await first.release(); await first.release();
    const second = await StateLease.acquire(root);
    await writeFile(second.path, JSON.stringify({pid: process.pid, nonce: 'different-owner'}));
    await second.release();
    assert.equal(JSON.parse(await readFile(second.path, 'utf8')).nonce, 'different-owner');
    await assert.rejects(StateLease.acquire(root), {code: 'STATE_BUSY'});
  } finally { await rm(root, {recursive:true, force:true}); }
});
