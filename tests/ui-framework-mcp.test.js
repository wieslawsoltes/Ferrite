import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
import {BrowserRuntime} from '../src/agent/browser/BrowserRuntime.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {McpServer} from '../src/agent/mcp/McpServer.js';
import {UI_SAMPLES} from '../src/ui-framework/Samples.js';

const trusted = {sessionId: 'ui-test', mode: 'trusted', interactive: false};
const files = () => ({'Cargo.toml': '[package]\nname="ui_test"\nversion="0.1.0"\n', 'src/main.rs': 'fn main() {}', 'src/app.ui.rs': UI_SAMPLES.counter});
async function fixture(t, backend) {
  if (backend === 'browser') {
    const operation = new CompilerOperation();
    const runtime = await BrowserRuntime.create({model: new WorkspaceModel(files()), compiler: {compile: async (...args) => operation.perform(...args), close: async () => {}}, storeOptions: {indexedDB: null}, leaseOptions: {locks: null}});
    t.after(() => runtime.close()); return runtime;
  }
  const root = await mkdtemp(join(tmpdir(), 'ferrite-ui-'));
  await mkdir(join(root, 'workspace', 'src'), {recursive: true});
  for (const [file, source] of Object.entries(files())) await writeFile(join(root, 'workspace', file), source);
  const runtime = await AgentRuntime.create({root: join(root, 'workspace'), state: join(root, 'state'), environment: {}});
  t.after(async () => { await runtime.close(); await rm(root, {recursive: true, force: true}); }); return runtime;
}
async function complete(runtime, value) {
  if (!value.truncated) return value;
  const parts = []; let offset = 0;
  while (true) {
    const result = await runtime.store.artifact(value.artifact, offset, 16000); parts.push(result.text);
    if (result.nextOffset == null) return JSON.parse(parts.join(''));
    offset = result.nextOffset;
  }
}
for (const backend of ['browser', 'native']) {
  test(`${backend} MCP tools validate and checkpoint source edits; stale hashes and denied execution never mutate`, async t => {
    const runtime = await fixture(t, backend), path = 'src/app.ui.rs';
    const inspected = await complete(runtime, await runtime.tools.execute('ui_design_inspect', {path}));
    const node = inspected.nodes.find(node => node.tag === 'h1'); assert.ok(node);
    const operation = {op: 'setAttribute', node: node.id, name: 'data-mcp', value: 'verified'};
    const request = {path, expectedHash: inspected.hash, operation};
    await assert.rejects(runtime.tools.execute('ui_design_edit', request, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    assert.equal(await runtime.workspace.text(path), UI_SAMPLES.counter);
    const edit = await runtime.tools.execute('ui_design_edit', request, trusted);
    assert.ok(edit.checkpoint); assert.match(await runtime.workspace.text(path), /data-mcp="verified"/);
    await assert.rejects(runtime.tools.execute('ui_design_edit', request, trusted), {code: 'EDIT_CONFLICT'});
    await runtime.tools.execute('checkpoint_restore', {id: edit.checkpoint}, trusted);
    assert.equal(await runtime.workspace.text(path), UI_SAMPLES.counter);
    const invalid = {...request, operation: {...operation, name: 'on:click', kind: 'expression', value: '42'}};
    await assert.rejects(runtime.tools.execute('ui_design_edit', invalid, trusted)); assert.equal(await runtime.workspace.text(path), UI_SAMPLES.counter);
    await assert.rejects(runtime.tools.execute('ui_preview', {path}, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    await assert.rejects(runtime.tools.execute('ui_inspect', {}, trusted));
    await assert.rejects(runtime.tools.execute('ide_command', {command: 'ui.preview', arguments: {file: path}}, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
  });
  test(`${backend} MCP publishes UI schemas and produces actual offline export artifacts without executing source`, async t => {
    const runtime = await fixture(t, backend), server = new McpServer(runtime); t.after(() => server.close());
    const metadata = {_meta: McpServer.metadata()};
    const response = await server.handle({jsonrpc: '2.0', id: 1, method: 'tools/list', params: metadata});
    assert.ok(response.result.tools.some(tool => tool.name === 'ui_design_edit'));
    const analysis = await complete(runtime, await runtime.tools.execute('ui_analyze', {path: 'src/app.ui.rs'}));
    assert.deepEqual(analysis.backends, ['javascript', 'wasm', 'mir']); assert.ok(analysis.hash);
    const exported = await complete(runtime, await runtime.tools.execute('ui_export_html', {path: 'src/app.ui.rs', backend: 'wasm'}));
    assert.ok(exported.html.startsWith('<!doctype html>')); assert.match(exported.html, /WebAssemblyRuntime/); assert.ok(exported.hash);
    assert.ok(!exported.html.includes('<script src='));
  });
}
for (const backend of ['browser', 'native']) {
  test(`${backend} MCP server rendering cannot downgrade execution authority; project sidecars are atomic`, async t => {
    const runtime = await fixture(t, backend), path = 'src/app.ui.rs';
    await assert.rejects(runtime.tools.execute('ui_render_html', {path}, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    const rendered = await complete(runtime, await runtime.tools.execute('ui_render_html', {path, backend: 'wasm'}, trusted));
    assert.match(rendered.html, /<output[^>]*>0<\/output>/); assert.match(rendered.html, /hydrate:true/);
    const settings = await complete(runtime, await runtime.tools.execute('ui_project_inspect', {path}));
    assert.equal(settings.hashes.manifest, null); assert.equal(settings.hashes.stylesheet, null);
    const args = {path, expectedHashes: settings.hashes, settings: {backend: 'wasm', grid: 16}, css: 'button{color:red}'};
    await assert.rejects(runtime.tools.execute('ui_project_set', args, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    const applied = await runtime.tools.execute('ui_project_set', args, trusted);
    assert.equal(JSON.parse(await runtime.workspace.text(settings.manifest)).backend, 'wasm');
    assert.equal(await runtime.workspace.text(settings.settings.stylesheet), 'button{color:red}');
    await assert.rejects(runtime.tools.execute('ui_project_set', args, trusted), {code: 'EDIT_CONFLICT'});
    await runtime.tools.execute('checkpoint_restore', {id: applied.checkpoint}, trusted);
    assert.equal(await runtime.workspace.text(settings.manifest, {optional: true}), null);
    assert.equal(await runtime.workspace.text(settings.settings.stylesheet, {optional: true}), null);
  });
}

for (const backend of ['browser', 'native']) {
  test(`${backend} MCP native binary tools cannot downgrade execution through ide_command`, async t => {
    const runtime = await fixture(t, backend);
    const wasm = Buffer.from([0,97,115,109,1,0,0,0,5,4,1,1,1,2]).toString('base64');
    await assert.rejects(runtime.tools.execute('ui_native_preview', {wasm}, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    await assert.rejects(runtime.tools.execute('ide_command', {command: 'ui.native.preview', arguments: {wasm}}, {mode: 'ask', interactive: false}), {code: 'APPROVAL_REQUIRED'});
    const exported = await complete(runtime, await runtime.tools.execute('ui_native_export_html', {wasm}));
    assert.equal(exported.backend, 'native-wasm'); assert.match(exported.html, /connect-src 'none'/);
    await assert.rejects(runtime.tools.execute('ui_native_export_html', {wasm: 'not-wasm'}));
  });
}
