import test from 'node:test';
import assert from 'node:assert/strict';
import {StudioDocuments} from '../src/ui/studio/StudioDocuments.js';
import {StudioPreview} from '../src/ui/studio/StudioPreview.js';

const flush = () => new Promise(resolve => queueMicrotask(resolve));
function fixture() {
  const operations = [], errors = [], mounted = [];
  const source = 'fn app() { view! { <h1>Timer</h1> } }';
  const session = {
    root: {hidden: false}, generation: 0, entryFile: 'src/main.ui.rs', entry: 'app', backend: 'javascript',
    model: {files: {'src/main.ui.rs': source}, revision: 1, workspaceEpoch: 0}, css: {value: ''},
    layoutMode: {value: 'off', dataset: {}, removeAttribute() {}}, frame: {style: {}}, pickButton: {setAttribute() {}},
    status: {dataset: {}}, saveProject() {}, renderOutline() {}, renderState() {}, publishInspection() {},
    app: {settings: {optimize: true}, publishUIBuild() {}, failUIBuild() {}},
    preview: {reset: () => 'channel', load: html => mounted.push(html)},
    compiler: {compile(files, command, options, signal) {
      assert.equal(command, 'ui-compile');
      return new Promise((resolve, reject) => {
        const abort = () => reject(signal.reason);
        signal.addEventListener('abort', abort, {once: true});
        operations.push({signal, finish() {
          signal.removeEventListener('abort', abort);
          resolve({artifact: {files, entry: options.entry, nodes: []}, html: '<h1>Timer</h1>'});
        }, fail(error) { signal.removeEventListener('abort', abort); reject(error); }});
      });
    }},
    error: error => errors.push(error),
  };
  session.build = options => StudioPreview.build.call(session, options);
  return {session, operations, errors, mounted, ensure: () => StudioDocuments.ensurePreview(session)};
}

test('queued automatic preview cannot cancel a subsequently requested agent build', async () => {
  const {session, operations, errors, mounted, ensure} = fixture();
  ensure(); ensure();
  const task = session.build(); task.catch(() => {});
  await flush();
  assert.equal(operations.length, 1);
  assert.equal(operations[0].signal.aborted, false);
  operations[0].finish(); await task; await flush();
  assert.equal(session.startQueued, false); assert.deepEqual(errors, []); assert.equal(mounted.length, 1);
});

test('revealing a document during an explicit preview leaves its build intact', async () => {
  const {session, operations, errors, ensure} = fixture();
  const task = session.build(); task.catch(() => {});
  ensure(); await flush();
  assert.equal(operations.length, 1); assert.equal(operations[0].signal.aborted, false);
  operations[0].finish(); await task; assert.deepEqual(errors, []);
});

test('automatic preview requests coalesce and do not rebuild an existing artifact', async () => {
  const {session, operations, errors, ensure} = fixture();
  ensure(); ensure(); await flush(); ensure();
  assert.equal(operations.length, 1);
  operations[0].finish(); await flush(); await flush(); ensure(); await flush();
  assert.equal(operations.length, 1); assert.equal(session.startQueued, false); assert.deepEqual(errors, []);
});

test('queued automatic builds honor document lifetime, visibility and generation', async () => {
  for (const invalidate of [session => { session.disposed = true; }, session => { session.root.hidden = true; },
    session => { session.generation++; }, session => { session.artifact = {format: 'ferrite-native-ui-v1'}; }]) {
    const {session, operations, ensure} = fixture();
    ensure(); invalidate(session); await flush();
    assert.equal(operations.length, 0); assert.equal(session.startQueued, false);
  }
});

test('explicit replacement cancels the old build without clearing the new build ownership', async () => {
  const {session, operations, errors, mounted, ensure} = fixture();
  const first = session.build(); const rejected = assert.rejects(first, {name: 'AbortError'});
  const second = session.build(); await rejected;
  ensure(); await flush();
  assert.equal(operations.length, 2); assert.equal(operations[1].signal.aborted, false);
  operations[1].finish(); await second;
  assert.equal(session.buildingGeneration, null); assert.equal(mounted.length, 1); assert.deepEqual(errors, []);
});

test('failed automatic compilation releases scheduling ownership for a later retry', async () => {
  const {session, operations, errors, ensure} = fixture();
  ensure(); await flush(); operations[0].fail(Error('compiler failure')); await flush(); await flush();
  assert.equal(errors.length, 1); assert.equal(session.startQueued, false); assert.equal(session.buildingGeneration, null);
  ensure(); await flush(); assert.equal(operations.length, 2);
  operations[1].finish(); await flush(); await flush(); assert.equal(session.startQueued, false);
});

test('an already cancelled preview cannot save settings, compile or invalidate an existing preview', async () => {
  const {session, operations} = fixture(); let saves = 0;
  session.saveProject = () => saves++;
  await assert.rejects(session.build({signal: AbortSignal.abort()}), {name: 'AbortError'});
  assert.equal(saves, 0); assert.equal(session.generation, 0); assert.equal(operations.length, 0);
});


test('agent preview resets stale debugger inspection and retains compiled backend settings', async () => {
  const {session, operations} = fixture();
  const old = {state: 'paused'}; let stopped = 0, rendered = 0;
  session.snapshot = {debugger: old}; session.inspection = old; session.artifact = old;
  session.stopDebugging = () => stopped++;
  session.renderState = () => {
    rendered++;
    assert.equal(session.snapshot, null); assert.equal(session.inspection, null); assert.equal(session.artifact, null);
  };
  const task = session.build();
  assert.equal(stopped, 1); assert.equal(rendered, 1);
  assert.equal(session.buildingGeneration, session.generation);
  operations[0].finish(); await task;
  assert.equal(session.compiledBackend, 'javascript'); assert.equal(session.compiledOptimize, true);
  assert.equal(session.compiledGeneration, session.generation); assert.equal(session.buildingGeneration, null);
});
