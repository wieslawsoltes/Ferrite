import test from 'node:test';
import assert from 'node:assert/strict';
import {UICommandController} from '../src/ui/controllers/UICommandController.js';
import {IdeApplication} from '../src/ui/IdeApplication.js';
import {StudioPreview} from '../src/ui/studio/StudioPreview.js';
import {StudioDocuments} from '../src/ui/studio/StudioDocuments.js';

const file = 'src/main.ui.rs';
const source = 'fn app() -> ui::Node { view! { <button>Count</button> } }';
function fixture() {
  const calls = [], model = {files: {[file]: source}, active: file, revision: 4, workspaceEpoch: 2};
  const build = {file, frontend: 'rust-ui', optimize: true, unit: {modules: [file]}, stages: [], diagnostics: []};
  const app = {
    model, backend: 'browser', settings: {optimize: true}, buildRevision: -1,
    studio: {sourceOwners: new Map(), isView: path => path.endsWith('.ui.rs'), session() { throw Error('Check/Build must not start a preview'); }},
    dock: {open: id => calls.push(['open', id])},
    publishBuild(value, revision) { this.build = value; this.buildRevision = revision; calls.push(['build', value]); },
    isCurrentUI: IdeApplication.prototype.isCurrentUI,
    publishUIBuild: IdeApplication.prototype.publishUIBuild,
    failUIBuild(error, path, revision, epoch) { if (this.isCurrentUI(path, revision, epoch)) calls.push(['failure', error]); },
    status: (...args) => calls.push(['status', ...args]),
    download: (...args) => calls.push(['download', ...args]),
    uiBuildOutput: (...args) => calls.push(['output', ...args])
  };
  const commands = new UICommandController(app); app.uiCommands = commands;
  commands.compiler = {compile: async (_files, command, options) => { calls.push(['compile', command, options]); return {build, html: '<!doctype html>', diagnostics: []}; }, close: async () => {}};
  return {app, commands, calls, model, build};
}

for (const command of ['check', 'build', 'test']) test(`UI ${command} publishes compiler artifacts without replacing a live preview`, async () => {
  const {app, commands, calls, build} = fixture();
  await commands.run(command, file);
  assert.equal(app.build, build);
  assert.equal(app.buildRevision, app.model.revision);
  assert.equal(calls.filter(call => call[0] === 'compile').length, 1);
  assert.equal(calls.find(call => call[0] === 'compile')[2].inspection, true);
  assert.equal(calls.find(call => call[0] === 'compile')[2].optimize, true);
  assert.equal(calls.some(call => call[0] === 'download'), command === 'build');
  assert.equal(calls.some(call => call[0] === 'output'), command !== 'check');
  assert.equal(calls.some(call => call[0] === 'failure'), false);
});

test('automatic UI checks refresh results without stealing the selected tool window', async () => {
  const {app, commands, calls, build} = fixture();
  await commands.run('check', file, {automatic: true});
  assert.equal(app.build, build);
  assert.equal(calls.some(call => call[0] === 'open'), false);
});

const contextChanges = [
  ['source revision', f => f.model.revision++],
  ['workspace epoch', f => f.model.workspaceEpoch++],
  ['active UI document', f => { f.model.active = 'src/other.ui.rs'; f.model.files[f.model.active] = source; }],
  ['Wasm backend', f => { f.app.backend = 'wasm'; }],
  ['native backend', f => { f.app.backend = 'native'; }],
  ['optimization settings', f => { f.app.settings.optimize = false; }],
  ['explicit cancellation', f => f.commands.cancel()]
];
for (const [label, mutate] of contextChanges) test(`a late UI build cannot overwrite results after changing ${label}`, async () => {
  const f = fixture(); let complete;
  f.commands.compiler.compile = () => new Promise(resolve => { complete = resolve; });
  const pending = f.commands.run('build', file);
  mutate(f); complete({build: f.build, html: '<!doctype html>'}); await pending;
  assert.equal(f.app.build, undefined);
  assert.equal(f.calls.some(call => ['download', 'failure', 'output'].includes(call[0])), false);
});

test('only a current UI failure reaches diagnostics', async () => {
  const f = fixture();
  const error = Object.assign(Error('bad source'), {code: 'F_TEST'});
  f.commands.compiler.compile = async () => { throw error; };
  await f.commands.run('check', file);
  assert.equal(f.calls.find(call => call[0] === 'failure')[1], error);
  assert.equal(f.app.build, undefined);
});

test('helper modules inherit their UI owner after publishing source-linked results', () => {
  const f = fixture(); f.build.unit.modules.push('src/components.rs'); f.model.files['src/components.rs'] = 'pub fn x() {}';
  assert.equal(f.app.publishUIBuild(f.build, file, f.model.revision, f.model.workspaceEpoch), true);
  f.model.active = 'src/components.rs';
  assert.equal(f.commands.entry(), file);
});

test('retained preview inspection is restored for the active tab without compiling or resetting state', () => {
  const f = fixture(), session = {app: f.app, model: f.model, entryFile: file, artifact: {files: {[file]: source}},
    inspection: f.build, inspectionEpoch: f.model.workspaceEpoch, compiledGeneration: 2, generation: 2};
  assert.equal(StudioPreview.publishInspection.call(session), true);
  assert.equal(f.app.build, f.build);
  assert.equal(f.calls.some(call => call[0] === 'compile'), false);
  f.model.files[file] += ' ';
  assert.equal(StudioPreview.publishInspection.call(session), false);
  f.model.files[file] = source; f.model.workspaceEpoch++;
  assert.equal(StudioPreview.publishInspection.call(session), false);
});

test('designer focus never hides compiler or output tools', () => {
  let collapsed = false;
  StudioDocuments.focusDocument.call({app: {dock: {collapse() { collapsed = true; }}}});
  assert.equal(collapsed, false);
});

for (const [label, mutate] of contextChanges) test(`a late UI failure cannot overwrite results after changing ${label}`, async () => {
  const f = fixture(); let reject;
  f.commands.compiler.compile = () => new Promise((_resolve, fail) => { reject = fail; });
  const pending = f.commands.run('check', file);
  mutate(f); reject(Error('obsolete diagnostic')); await pending;
  assert.equal(f.calls.some(call => call[0] === 'failure'), false);
});

test('preview and export failures are scoped to their original optimization settings', () => {
  const f = fixture(); f.app.settings.optimize = false;
  f.app.inspector = {failed() { assert.fail('obsolete diagnostic reached the inspector'); }};
  IdeApplication.prototype.failUIBuild.call(f.app, Error('old optimization pass'), file, f.model.revision, f.model.workspaceEpoch, true);
});
