import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
import {AgentBridgeServer} from '../src/agent/server/AgentBridgeServer.js';
import {McpServer} from '../src/agent/mcp/McpServer.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'ferrite-terminal-mcp-'));
  await mkdir(join(root, 'workspace'));
  const runtime = await AgentRuntime.create({root: join(root, 'workspace'), state: join(root, 'state'), environment: {}});
  t.after(async () => { await runtime.close(); await rm(root, {recursive: true, force: true}); });
  return runtime;
}
const context = {sessionId: 'owner-one', mode: 'trusted', interactive: false};
const native = {skip: process.platform === 'win32', timeout: 15000};

test('terminal MCP operations are owner-scoped, approval-gated and schema-validated', native, async t => {
  const runtime = await fixture(t), run = (name, args, ctx = context) => runtime.tools.execute(name, args, ctx);
  const session = await run('terminal_open', {cols: 80, rows: 24});
  const id = session.id;
  for (const [name, args] of [
    ['terminal_read', {id}], ['terminal_screen', {id}], ['terminal_wait', {id, timeoutMs: 0}],
    ['terminal_input', {id, text: 'secret'}], ['terminal_key', {id, key: 'Enter'}], ['terminal_paste', {id, text: 'paste'}],
    ['terminal_mouse', {id, column: 1, row: 1}], ['terminal_resize', {id, cols: 90, rows: 30}],
    ['terminal_signal', {id}], ['terminal_close', {id}]
  ]) await assert.rejects(run(name, args, {...context, sessionId: 'owner-two'}), {code: 'TERMINAL_OWNER'}, name);
  assert.deepEqual(await run('terminal_list', {}, {...context, sessionId: 'owner-two'}), []);
  for (const [name, args] of [['terminal_key', {id, key: 'Enter'}], ['terminal_paste', {id, text: 'paste'}], ['terminal_mouse', {id, column: 1, row: 1}], ['terminal_resize', {id, cols: 90, rows: 30}]]) {
    await assert.rejects(run(name, args, {sessionId: context.sessionId, interactive: false}), {code: 'APPROVAL_REQUIRED'}, name);
  }
  await assert.rejects(run('terminal_key', {id, key: 'Enter', count: 101}));
  await assert.rejects(run('terminal_wait', {id, timeoutMs: 30001}));
  await assert.rejects(run('terminal_mouse', {id, column: 0, row: 1}));
  // Semantic validation happens in an ordered operation but must not kill the PTY.
  await assert.rejects(run('terminal_screen', {id, startRow: 100}), {code: 'TERMINAL_RANGE'});
  await assert.rejects(run('terminal_key', {id, key: 'not-a-key'}));
  await run('terminal_input', {id, text: "printf '\\033[2J\\033[H%s\\n' 'MCP_READY'\r"});
  const ready = await run('terminal_wait', {id, contains: 'MCP_READY', timeoutMs: 3000});
  assert.equal(ready.matched, true); assert.equal(ready.screen.engine.name, 'xterm.js');
  assert.equal(runtime.terminals.get(id).closed, false);
  await run('terminal_close', {id});
  assert.equal((await run('terminal_screen', {id})).closed, true);
});

test('MCP terminal resources do not bypass ownership and cancelled waits release listeners', native, async t => {
  const runtime = await fixture(t), owner = 'mcp-owner';
  const server = new McpServer(runtime, {owner, context: {mode: 'trusted', interactive: false}});
  t.after(() => server.close());
  let nextId = 0;
  const send = (method, params = {}, id = ++nextId) => server.handle({jsonrpc: '2.0', id, method, params: {_meta: McpServer.metadata(), ...params}});
  const opened = await send('tools/call', {name: 'terminal_open', arguments: {}});
  assert.equal(opened.result.isError, false);
  const id = opened.result.structuredContent.id;
  const resource = await send('resources/read', {uri: `ferrite://terminal/${id}`});
  assert.equal(JSON.parse(resource.result.contents[0].text).engine.name, 'xterm.js');
  const other = await runtime.terminals.start({owner: 'somebody-else'});
  assert.ok((await send('resources/read', {uri: `ferrite://terminal/${other.id}`})).error);
  const listing = await send('resources/read', {uri: 'ferrite://terminals'});
  assert.deepEqual(JSON.parse(listing.result.contents[0].text).map(item => item.id), [id]);
  const session = runtime.terminals.get(id), baseline = session.log.listeners.size;
  const waiting = send('tools/call', {name: 'terminal_wait', arguments: {id, until: 'exit', timeoutMs: 30000}}, 'cancel-wait');
  await new Promise(resolve => setTimeout(resolve, 30));
  await server.handle({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: 'cancel-wait'}});
  assert.equal((await waiting).result.isError, true);
  assert.equal(session.log.listeners.size, baseline); assert.equal(session.closed, false);
});

test('authenticated HTTP screen, snapshot and binary-input routes preserve bytes and bounds', native, async t => {
  const runtime = await fixture(t), bridge = new AgentBridgeServer(runtime), connection = await bridge.listen();
  t.after(() => bridge.close());
  const headers = {Authorization: 'Bearer ' + connection.token, 'Content-Type': 'application/json'};
  const request = async (path, body) => {
    const response = await fetch(connection.url + path, {method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body)});
    return {status: response.status, body: await response.json()};
  };
  const {body: session} = await request('/v1/terminals/open', {executable: 'python3', args: ['-I', '-u', '-c', "import os,tty;tty.setraw(0);print('BINARY_READY',flush=True);print('BYTES_'+os.read(0,3).hex(),flush=True)"], cols: 80, rows: 24});
  const prefix = `/v1/terminals/${session.id}`;
  await runtime.terminals.wait(session.id, {contains: 'BINARY_READY', timeoutMs: 3000});
  assert.equal((await request(prefix + '/binary', {data: '!!!!'})).status, 400);
  assert.equal((await request(prefix + '/binary', {data: Buffer.from([0, 128, 255]).toString('base64')})).status, 200);
  const result = await runtime.terminals.wait(session.id, {contains: 'BYTES_0080ff', timeoutMs: 3000}); assert.equal(result.matched, true);
  const {body: screen} = await request(prefix + '/screen'), {body: state} = await request(prefix + '/state');
  assert.match(screen.text, /BYTES_0080ff/); assert.equal(state.cols, 80); assert.equal(typeof state.ansi, 'string');
  assert.equal((await request(prefix + '?waitMs=30001')).status, 400);
});
