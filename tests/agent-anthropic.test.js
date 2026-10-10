import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AnthropicProvider} from '../src/agent/providers/AnthropicProvider.js';
import {HttpTransport} from '../src/agent/providers/HttpTransport.js';
import {BrowserProviderTransport} from '../src/agent/browser/BrowserProviderTransport.js';
import {BrowserRuntime} from '../src/agent/browser/BrowserRuntime.js';
import {ProviderRegistry} from '../src/agent/providers/ProviderRegistry.js';
import {CompilerOperation} from '../src/agent/core/CompilerOperation.js';
import {ContextManager} from '../src/agent/core/ContextManager.js';
import {WorkspaceModel} from '../src/ui/model/WorkspaceModel.js';

const request = {model: 'fixture', system: 'Fix the project', messages: [{role: 'user', text: 'Fix the timer'}]};
const key = 'fixture-anthropic-private-key';
const call = (name = 'workspace_list', input = {}, id = 'toolu_1') => ({type: 'tool_use', id, name, input});
const start = {type: 'message_start', message: {usage: {input_tokens: 10, output_tokens: 1, cache_read_input_tokens: 4, cache_creation_input_tokens: 2}}};
const end = (reason = 'tool_use') => [{type: 'message_delta', delta: {stop_reason: reason}, usage: {output_tokens: 9}}, {type: 'message_stop'}];

function eventsFor(content, {reason = content.some(block => block.type === 'tool_use') ? 'tool_use' : 'end_turn', fragments} = {}) {
  const events = [start];
  for (let index = 0; index < content.length; index++) {
    const block = content[index];
    if (block.type === 'tool_use') {
      events.push({type: 'content_block_start', index, content_block: {...block, input: {}}});
      const json = JSON.stringify(block.input);
      // The production failure: argument-free discovery calls can emit only the empty delta.
      const parts = fragments ?? (json === '{}' ? [''] : ['', ...json.match(/.{1,11}/gs)]);
      for (const partial_json of parts) events.push({type: 'content_block_delta', index, delta: {type: 'input_json_delta', partial_json}});
    } else if (block.type === 'text') {
      events.push({type: 'content_block_start', index, content_block: {type: 'text', text: ''}});
      events.push({type: 'content_block_delta', index, delta: {type: 'text_delta', text: block.text}});
    } else events.push({type: 'content_block_start', index, content_block: structuredClone(block)});
    events.push({type: 'content_block_stop', index});
  }
  return [...events, ...end(reason)];
}
function stream(events, {chunkSize = 7, separator = '\r\n'} = {}) {
  const bytes = new TextEncoder().encode(events.map(event => `:keepalive${separator}event: ${event.type}${separator}data: ${JSON.stringify(event)}${separator}${separator}`).join(''));
  let offset = 0;
  return new Response(new ReadableStream({pull(controller) {
    if (offset === bytes.length) return controller.close();
    controller.enqueue(bytes.slice(offset, offset += Math.min(chunkSize, bytes.length - offset)));
  }}), {headers: {'content-type': 'text/event-stream'}});
}
const providerFor = events => new AnthropicProvider({key, transport: new HttpTransport({fetcher: async () => stream(events)})});

for (const fragments of [[], [''], ['', '', ''], ['', '{}', '']]) {
  test(`Anthropic empty-object tool arguments survive ${JSON.stringify(fragments)} deltas`, async () => {
    const response = await providerFor(eventsFor([call()], {fragments})).complete(request);
    assert.deepEqual(response.calls, [{id: 'toolu_1', name: 'workspace_list', arguments: {}}]);
    assert.deepEqual(response.providerState.content[0].input, {});
  });
}

test('Anthropic initial tool input survives empty deltas and serialized input replaces the initial object', async () => {
  for (const fragments of [[''], ['{"path":"src/model.rs"}']]) {
    const events = [start, {type: 'content_block_start', index: 0, content_block: call('workspace_read', {path: 'src/main.ui.rs'})},
      ...fragments.map(partial_json => ({type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json}})),
      {type: 'content_block_stop', index: 0}, ...end()];
    const response = await providerFor(events).complete(request);
    assert.deepEqual(response.calls[0].arguments, {path: fragments[0] ? 'src/model.rs' : 'src/main.ui.rs'});
  }
});

test('Anthropic streams literal UTF-8 edits, independent tool blocks, signatures and cumulative usage', async () => {
  const args = {path: 'src/main.ui.rs', oldText: 'let label = "Timer";\n', newText: 'let label = "Żółć 🦀 $& \\\\"quoted\\\\"";\r\n'};
  const content = [{type: 'thinking', thinking: 'fixture reasoning', signature: 'opaque-signature'},
    {type: 'redacted_thinking', data: 'opaque-redacted'}, {type: 'text', text: 'Inspecting timer 🦀.'},
    call('workspace_replace', args, 'toolu_edit'), call('instructions_read', {}, 'toolu_instructions')];
  const events = eventsFor(content);
  events.splice(1, 0, {type: 'ping'}, {type: 'future_event', ignored: true});
  events.splice(-2, 0, {type: 'message_delta', delta: {stop_reason: null}, usage: {output_tokens: 3}});
  const deltas = [], response = await providerFor(events).complete({...request, onDelta: text => deltas.push(text)});
  assert.deepEqual(response.calls[0].arguments, args);
  assert.deepEqual(response.calls[1].arguments, {});
  assert.equal(deltas.join(''), 'Inspecting timer 🦀.');
  assert.deepEqual(response.providerState.content, content);
  assert.deepEqual(response.usage, {input: 16, output: 9, cached: 4});
});

test('Anthropic indexed tool deltas remain isolated when block lifetimes overlap', async () => {
  const events = [start,
    {type: 'content_block_start', index: 0, content_block: call('workspace_read', {}, 'toolu_a')},
    {type: 'content_block_start', index: 1, content_block: call('workspace_read', {}, 'toolu_b')},
    {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '{"path":'}},
    {type: 'content_block_delta', index: 1, delta: {type: 'input_json_delta', partial_json: '{"path":"b"}'}},
    {type: 'content_block_stop', index: 1},
    {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '"a"}'}},
    {type: 'content_block_stop', index: 0}, ...end()];
  const response = await providerFor(events).complete(request);
  assert.deepEqual(response.calls.map(item => item.arguments), [{path: 'a'}, {path: 'b'}]);
});

test('Anthropic signed thinking deltas and text citations survive replay without empty text blocks', async () => {
  const citation = {type: 'char_location', cited_text: 'fixture', document_index: 0, document_title: 'source', start_char_index: 0, end_char_index: 7};
  const events = [start,
    {type: 'content_block_start', index: 0, content_block: {type: 'thinking', thinking: '', signature: ''}},
    {type: 'content_block_delta', index: 0, delta: {type: 'thinking_delta', thinking: 'opaque'}},
    {type: 'content_block_delta', index: 0, delta: {type: 'signature_delta', signature: 'signed'}},
    {type: 'content_block_stop', index: 0},
    {type: 'content_block_start', index: 1, content_block: {type: 'text', text: 'Source'}},
    {type: 'content_block_delta', index: 1, delta: {type: 'citations_delta', citation}},
    {type: 'content_block_stop', index: 1}, ...end('end_turn')];
  const provider = providerFor(events), response = await provider.complete(request);
  response.providerState.content.push({type: 'text', text: ''});
  const before = structuredClone(response);
  const input = provider.input([{role: 'user', text: 'Task'}, response, {role: 'assistant', text: ''}, {role: 'user', text: 'Continue'}]);
  assert.equal(input[1].content[0].signature, 'signed');
  assert.deepEqual(input[1].content[1].citations, [citation]);
  assert.equal(input[1].content.length, 2);
  assert.deepEqual(response, before);
});

test('Anthropic tool results are adjacent, coalesced, ordered before user text and keep error flags', async () => {
  const provider = providerFor(eventsFor([{type: 'text', text: ''}, call('workspace_list', {}, 'toolu_a'), call('instructions_read', {}, 'toolu_b')]));
  const response = await provider.complete(request);
  const input = provider.input([...request.messages, response,
    {role: 'tool', callId: 'toolu_a', text: '', error: false}, {role: 'tool', callId: 'toolu_b', text: 'denied', error: true}, {role: 'user', text: 'Do not retry denied operations'}]);
  assert.equal(input.length, 3);
  assert.deepEqual(input[1].content.map(block => block.type), ['tool_use', 'tool_use']);
  assert.deepEqual(input[2].content.map(block => block.type), ['tool_result', 'tool_result', 'text']);
  assert.equal(input[2].content[0].content, '');
  assert.equal(input[2].content[1].is_error, true);
  assert.equal(response.providerState.content.length, 3);
});

for (const raw of ['{"path":', 'null', '[]', '"source-secret"', '42', 'true', '   ']) {
  test(`Anthropic rejects non-object or malformed tool JSON (${JSON.stringify(raw)}) without echoing source`, async () => {
    await assert.rejects(providerFor(eventsFor([call()], {fragments: [raw]})).complete(request), error => {
      assert.equal(error.code, 'INVALID_TOOL_JSON'); assert.equal(error.retryable, false);
      assert.match(error.message, /content block 0/); assert.doesNotMatch(error.message, /source-secret|"path"/); return true;
    });
  });
}

for (const [reason, code] of [['max_tokens', 'OUTPUT_LIMIT'], ['model_context_window_exceeded', 'CONTEXT_LIMIT'], ['refusal', 'PROVIDER_REFUSAL'], ['pause_turn', 'PROVIDER_PAUSED']]) {
  test(`Anthropic classifies ${reason} before parsing partial edits and never dispatches earlier complete calls`, async () => {
    const events = eventsFor([call('workspace_list', {}, 'toolu_list'), call('workspace_apply', {}, 'toolu_edit')], {reason, fragments: ['{"changes":[']});
    await assert.rejects(providerFor(events).complete(request), {code, retryable: false});
    const json = {content: [call('workspace_apply', null)], stop_reason: reason};
    await assert.rejects(new AnthropicProvider({transport: new HttpTransport({fetcher: async () => Response.json(json)})}).complete(request), {code});
  });
}

test('Anthropic validates JSON fallback with the same object and terminal-status checks as SSE', async () => {
  for (const input of [{}, {path: 'src/main.ui.rs'}, null, [], 'not-an-object']) {
    const provider = new AnthropicProvider({transport: new HttpTransport({fetcher: async () => Response.json({content: [call('workspace_list', input)], stop_reason: 'tool_use'})})});
    if (input && typeof input === 'object' && !Array.isArray(input)) assert.deepEqual((await provider.complete(request)).calls[0].arguments, input);
    else await assert.rejects(provider.complete(request), {code: 'INVALID_TOOL_JSON'});
  }
  const deltas = [];
  const provider = new AnthropicProvider({transport: new HttpTransport({fetcher: async () => Response.json({content: [{type: 'text', text: 'Done'}], stop_reason: 'end_turn'})})});
  assert.equal((await provider.complete({...request, onDelta: text => deltas.push(text)})).text, 'Done');
  assert.deepEqual(deltas, ['Done']);
});

test('Anthropic missing stop, unclosed blocks and missing finish reason cannot become successful edits', async () => {
  const events = eventsFor([call()]);
  await assert.rejects(providerFor(events.slice(0, -1)).complete(request), {code: 'PROVIDER_STREAM', retryable: true});
  await assert.rejects(providerFor(events.filter(event => event.type !== 'content_block_stop')).complete(request), {code: 'PROVIDER_PROTOCOL'});
  await assert.rejects(providerFor(events.filter(event => event.type !== 'message_delta')).complete(request), {code: 'PROVIDER_PROTOCOL'});
  await assert.rejects(providerFor(eventsFor([call()], {reason: 'end_turn'})).complete(request), {code: 'PROVIDER_PROTOCOL'});
  await assert.rejects(providerFor(eventsFor([], {reason: 'tool_use'})).complete(request), {code: 'PROVIDER_PROTOCOL'});
});

test('Anthropic rejects duplicate, sparse, mistyped and out-of-order block events', async () => {
  const open = {type: 'content_block_start', index: 0, content_block: call()};
  const close = {type: 'content_block_stop', index: 0};
  const delta = {type: 'content_block_delta', index: 0, delta: {type: 'input_json_delta', partial_json: '{}'}};
  for (const events of [[open], [start, start], [start, {...open, index: 999999999}], [start, open, open], [start, delta], [start, open, close, delta],
    [start, open, close, close], [start, open, {...delta, delta: {type: 'text_delta', text: 'bad'}}],
    [start, open, {...delta, delta: {type: 'input_json_delta', partial_json: null}}], [start, ...end('end_turn'), open]]) {
    await assert.rejects(providerFor(events).complete(request), {code: 'PROVIDER_PROTOCOL'});
  }
});

test('Anthropic validates tool identities and duplicate calls before a response can enter the journal', async () => {
  for (const block of [{...call(), id: '__proto__'}, {...call(), id: ''}, {...call(), name: 'bad\nname'}])
    await assert.rejects(providerFor(eventsFor([block])).complete(request), {code: 'PROVIDER_PROTOCOL'});
  await assert.rejects(providerFor(eventsFor([call(), call()])).complete(request), {code: 'PROVIDER_PROTOCOL'});
});

for (const [type, retryable, code] of [['overloaded_error', true, 'PROVIDER_RESPONSE'], ['rate_limit_error', true, 'PROVIDER_RESPONSE'], ['api_error', true, 'PROVIDER_RESPONSE'], ['invalid_request_error', false, 'PROVIDER_RESPONSE'], ['authentication_error', false, 'PROVIDER_AUTH']]) {
  test(`Anthropic ${type} is safely classified for SSE and JSON`, async () => {
    const event = {type: 'error', error: {type, message: 'reflected-secret-source'}};
    for (const fetcher of [async () => stream([start, event]), async () => Response.json(event)]) {
      await assert.rejects(new AnthropicProvider({transport: new HttpTransport({fetcher})}).complete(request), error => {
        assert.equal(error.code, code); assert.equal(error.retryable, retryable); assert.doesNotMatch(error.message, /reflected-secret-source/); return true;
      });
    }
  });
}

test('Anthropic cancellation between tool fragments does not produce a completed call', async () => {
  const controller = new AbortController(); let cancelled = false;
  const transport = new HttpTransport({fetcher: async () => {
    const prefix = eventsFor([call()]).slice(0, 3).map(event => `data: ${JSON.stringify(event)}\n\n`).join('');
    return new Response(new ReadableStream({start(stream) { stream.enqueue(new TextEncoder().encode(prefix)); }, cancel() { cancelled = true; }}), {headers: {'content-type': 'text/event-stream'}});
  }});
  const pending = new AnthropicProvider({transport}).complete({...request, signal: controller.signal});
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(pending, {name: 'AbortError'}); assert.equal(cancelled, true);
});

function validateHistory(messages) {
  let pending = [];
  for (const message of messages) {
    assert.ok(message.content.length, 'replayed messages must not be empty');
    assert.ok(message.content.every(block => block.type !== 'text' || block.text.length), 'replayed text blocks must not be empty');
    if (pending.length) {
      assert.equal(message.role, 'user');
      assert.deepEqual(message.content.slice(0, pending.length).map(block => [block.type, block.tool_use_id]), pending.map(id => ['tool_result', id]));
      pending = [];
    }
    if (message.role === 'assistant') pending = message.content.filter(block => block.type === 'tool_use').map(block => block.id);
  }
  assert.deepEqual(pending, []);
}
async function browserRuntime(t, files, respond) {
  const requests = [], operations = [], compiler = new CompilerOperation();
  const providers = new ProviderRegistry({environment: {}, transport: new BrowserProviderTransport({fetcher: async (url, options) => {
    assert.equal(options.headers['x-api-key'], key); assert.equal(options.headers['anthropic-version'], '2023-06-01');
    assert.equal(options.headers['anthropic-dangerous-direct-browser-access'], 'true');
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error');
    if (url.includes('/models')) return Response.json({data: [{id: 'fixture', display_name: 'Fixture'}]});
    const body = JSON.parse(options.body); validateHistory(body.messages); requests.push(body);
    return stream(await respond(body, requests.length), {chunkSize: 113});
  }})});
  const runtime = await BrowserRuntime.create({model: new WorkspaceModel(files), providers, storeOptions: {indexedDB: null}, leaseOptions: {locks: null},
    compiler: {compile: async (snapshot, command, options) => { operations.push(command); return compiler.perform(snapshot, command, options); }, close: async () => {}}});
  t.after(() => runtime.close());
  await runtime.route('/v1/providers/connect', {provider: 'anthropic', key, browserConsent: true});
  const session = await runtime.harness.create({provider: 'anthropic', model: 'fixture', mode: 'auto-edit', modelCompaction: false, contextTokens: 65536});
  return {runtime, session, requests, operations};
}

const resultFor = (body, id) => {
  const block = body.messages.flatMap(message => message.content).find(block => block.type === 'tool_result' && block.tool_use_id === id);
  assert.ok(block, `Missing result for ${id}`); return {block, value: JSON.parse(block.content)};
};

test('Anthropic browser agent lists, reads, repairs invalid tool input, edits a real Timer UI and compiles it', async t => {
  const files = {'src/main.ui.rs': await readFile(new URL('../examples/7guis/timer/main.ui.rs', import.meta.url), 'utf8'),
    'src/model.rs': await readFile(new URL('../examples/7guis/timer/model.rs', import.meta.url), 'utf8')};
  const expected = files['src/main.ui.rs'].replace('<h1>Timer</h1>', '<h1>Timer — Żółć 🦀</h1>');
  let editedHash;
  const {runtime, session, requests, operations} = await browserRuntime(t, files, (body, turn) => {
    assert.ok(body.tools.some(tool => tool.name === 'workspace_replace' && tool.input_schema.required.includes('expectedHash')));
    const text = {type: 'text', text: ''};
    if (turn === 1) return eventsFor([text, call('workspace_list', {}, 'toolu_list'), call('instructions_read', {}, 'toolu_instructions')]);
    if (turn === 2) {
      assert.ok(resultFor(body, 'toolu_list').value.files.includes('src/main.ui.rs'));
      return eventsFor([call('workspace_read', {}, 'toolu_invalid')]);
    }
    if (turn === 3) {
      const result = resultFor(body, 'toolu_invalid'); assert.equal(result.block.is_error, true); assert.match(result.value.message, /path/);
      return eventsFor([call('workspace_read', {path: 'src/main.ui.rs'}, 'toolu_read'), call('workspace_read', {path: 'src/model.rs'}, 'toolu_model')]);
    }
    if (turn === 4) {
      editedHash = resultFor(body, 'toolu_read').value.hash;
      assert.match(resultFor(body, 'toolu_model').value.text, /pub struct Timer/);
      return eventsFor([call('workspace_replace', {path: 'src/main.ui.rs', expectedHash: editedHash, oldText: '<h1>Timer</h1>', newText: '<h1>Timer — Żółć 🦀</h1>'}, 'toolu_edit')]);
    }
    if (turn === 5) {
      assert.equal(resultFor(body, 'toolu_edit').block.is_error, false);
      return eventsFor([call('ui_analyze', {path: 'src/main.ui.rs'}, 'toolu_compile')]);
    }
    assert.equal(turn, 6);
    const analyzed = resultFor(body, 'toolu_compile'); assert.equal(analyzed.block.is_error, false);
    assert.equal(analyzed.value.diagnostics.filter(diagnostic => diagnostic.severity === 'error').length, 0);
    assert.notEqual(analyzed.value.hash, editedHash);
    return eventsFor([{type: 'text', text: 'Updated Timer and verified the actual Rust UI compilation.'}]);
  });
  await runtime.harness.start(session.id, 'Change the Timer heading and compile it'); await runtime.harness.wait(session.id);
  assert.equal(session.status, 'completed', JSON.stringify(session.error));
  assert.equal(runtime.workspace.model.read('src/main.ui.rs'), expected);
  assert.deepEqual(operations, ['ui-analyze']); assert.equal(requests.length, 6);
  assert.equal((await runtime.store.list('checkpoints')).length, 1);
  assert.equal(session.ledger.toolu_edit.status, 'completed');
  assert.doesNotThrow(() => ContextManager.groups(session.messages));
  assert.ok(!JSON.stringify([...runtime.store.memory.values()]).includes(key));
});

test('Anthropic truncated coding response leaves no partial history or edit and can resume explicitly', async t => {
  const files = {'src/main.rs': 'fn main() {}\n'};
  const {runtime, session, requests} = await browserRuntime(t, files, (_body, turn) => turn === 1
    ? eventsFor([call('workspace_apply')], {reason: 'max_tokens', fragments: ['{"changes":[{"path":"src/main.rs","text":"partial-source-secret']})
    : turn === 2 ? eventsFor([call('workspace_list', {}, 'toolu_resume')]) : eventsFor([{type: 'text', text: 'Resumed safely without applying the truncated edit.'}]));
  await runtime.harness.start(session.id, 'Edit the source'); await runtime.harness.wait(session.id);
  assert.equal(session.status, 'failed'); assert.equal(session.error.code, 'OUTPUT_LIMIT');
  assert.equal(session.messages.length, 1); assert.equal(session.transcript.length, 1); assert.deepEqual(session.ledger, {});
  assert.equal((await runtime.store.list('checkpoints')).length, 0); assert.equal(runtime.workspace.model.read('src/main.rs'), files['src/main.rs']);
  await runtime.harness.start(session.id, undefined, {config: {outputTokens: 8192}}); await runtime.harness.wait(session.id);
  assert.equal(session.status, 'completed'); assert.equal(session.error, null);
  assert.equal(requests[1].max_tokens, 8192); assert.ok(!JSON.stringify(requests[1]).includes('partial-source-secret'));
  assert.deepEqual(requests[1].messages, requests[0].messages);
});

test('Anthropic stream retries do not replay already committed source edits', async t => {
  const files = {'src/main.rs': 'fn main() {}\n'};
  let originalHash;
  const {runtime, session} = await browserRuntime(t, files, (body, turn) => {
    if (turn === 1) return eventsFor([call('workspace_read', {path: 'src/main.rs'}, 'toolu_read')]);
    if (turn === 2 || turn === 3) {
      originalHash = resultFor(body, 'toolu_read').value.hash;
      const events = eventsFor([call('workspace_replace', {path: 'src/main.rs', expectedHash: originalHash, oldText: 'fn main() {}', newText: 'fn main() { let answer = 42; }'}, 'toolu_write')]);
      return turn === 2 ? events.slice(0, -1) : events;
    }
    assert.equal(resultFor(body, 'toolu_write').block.is_error, false);
    if (turn === 4) return [{type: 'error', error: {type: 'overloaded_error', message: 'do not reflect this'}}];
    assert.equal(turn, 5); return eventsFor([{type: 'text', text: 'Done'}]);
  });
  runtime.harness.retryDelay = async () => {};
  await runtime.harness.start(session.id, 'Edit the source'); await runtime.harness.wait(session.id);
  assert.equal(session.status, 'completed', JSON.stringify(session.error));
  assert.equal((await runtime.store.list('checkpoints')).length, 1);
  assert.equal(runtime.workspace.model.read('src/main.rs'), 'fn main() { let answer = 42; }\n');
  assert.equal(session.events.filter(event => event.type === 'model.retry').length, 2);
});
