import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderRegistry} from '../src/agent/providers/ProviderRegistry.js';

test('provider sign-out cancels in-flight API login and cannot be undone by late discovery', async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const registry = new ProviderRegistry({environment: {}, transport: {request: () => response}});
  const login = registry.connect('openai', 'pending-private-key');
  const rejected = assert.rejects(login, {name: 'AbortError'});
  registry.disconnect('openai');
  resolve({data: [{id: 'model'}]});
  await rejected;
  assert.equal(registry.list()[0].connected, false);
  assert.deepEqual(registry.list()[0].models, []);
  assert.equal(registry.redact('pending-private-key'), '[REDACTED]');
});

test('model-list response for a revoked account cannot repopulate its catalog', async () => {
  let resolve;
  const response = new Promise(done => { resolve = done; });
  const registry = new ProviderRegistry({environment: {OPENAI_API_KEY: 'private-test-key'}, transport: {request: () => response}});
  const discovery = registry.models('openai');
  const rejected = assert.rejects(discovery, {name: 'AbortError'});
  registry.disconnect('openai');
  resolve({data: [{id: 'old-model'}]});
  await rejected;
  assert.deepEqual(registry.list()[0].models, []);
});

test('Google API key alias initializes Gemini without replacing an explicit Gemini key', () => {
  assert.equal(new ProviderRegistry({environment: {GOOGLE_API_KEY: 'alias-key'}}).get('gemini').key, 'alias-key');
  assert.equal(new ProviderRegistry({environment: {GOOGLE_API_KEY: 'alias', GEMINI_API_KEY: 'explicit'}}).get('gemini').key, 'explicit');
});
