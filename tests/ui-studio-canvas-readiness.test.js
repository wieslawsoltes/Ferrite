import test from 'node:test';
import assert from 'node:assert/strict';
import {UIStudioSession as UIStudio} from '../src/ui/studio/UIStudioSession.js';

function fixture() {
  const pending = [], attributes = new Map();
  const studio = {generation: 1, assertLive() {}, assertSourcePreview() {},
    layoutMode: {value: 'move', dataset: {activeMode: 'off'}, setAttribute(k, v) {attributes.set(k, v);}, removeAttribute(k) {attributes.delete(k);}},
    frame: {style: {pointerEvents: ''}}, preview: {request(command, values) {
      assert.equal(command, 'layout');
      return new Promise((resolve, reject) => pending.push({values, resolve, reject}));
    }},
  };
  const configure = () => UIStudio.prototype.configureLayout.call(studio);
  return {studio, configure, pending, attributes};
}

test('canvas interaction waits for the opaque preview mode acknowledgement', async () => {
  const {studio, configure, pending, attributes} = fixture();
  const operation = configure();
  assert.equal(studio.frame.style.pointerEvents, 'none');
  assert.equal(studio.layoutMode.dataset.activeMode, 'off');
  assert.equal(attributes.get('aria-busy'), 'true');
  assert.deepEqual(pending[0].values, {mode: 'move', grid: 8, snap: true});
  pending[0].resolve({mode: 'move'}); await operation;
  assert.equal(studio.layoutMode.dataset.activeMode, 'move');
  assert.equal(studio.frame.style.pointerEvents, ''); assert.equal(attributes.has('aria-busy'), false);
});

test('late previous mode acknowledgement cannot unlock a pending replacement', async () => {
  const {studio, configure, pending} = fixture();
  const first = configure(); studio.layoutMode.value = 'resize'; const second = configure();
  pending[0].resolve({mode: 'move'}); await first;
  assert.equal(studio.frame.style.pointerEvents, 'none');
  pending[1].resolve({mode: 'resize'}); await second;
  assert.equal(studio.layoutMode.dataset.activeMode, 'resize');
});

test('preview replacement invalidates old canvas replies', async () => {
  const {studio, configure, pending} = fixture();
  const operation = configure(); studio.generation++;
  studio.layoutMode.dataset.activeMode = 'off'; studio.frame.style.pointerEvents = 'replacement';
  pending[0].resolve({mode: 'move'}); await operation;
  assert.equal(studio.layoutMode.dataset.activeMode, 'off');
  assert.equal(studio.frame.style.pointerEvents, 'replacement');
});

test('failed or mismatched mode replies keep uncertain design input disabled', async () => {
  for (const mismatch of [false, true]) {
    const {studio, configure, pending} = fixture();
    const operation = configure();
    if (mismatch) pending[0].resolve({mode: 'off'}); else pending[0].reject(Error('Disconnected'));
    await assert.rejects(operation);
    assert.equal(studio.frame.style.pointerEvents, 'none');
    assert.equal(studio.layoutMode.dataset.activeMode, 'unknown');
    const recovery = configure(); pending[1].resolve({mode: 'move'}); await recovery;
    assert.equal(studio.frame.style.pointerEvents, '');
  }
});
