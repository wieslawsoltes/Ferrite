import {AgentError} from '../core/AgentError.js';
import {HttpTransport} from './HttpTransport.js';

/** Messages API adapter preserving thinking signatures and adjacent tool-result blocks. */
export class AnthropicProvider {
  constructor({key, transport = new HttpTransport(), base = 'https://api.anthropic.com/v1'} = {}) { this.key = key; this.transport = transport; this.base = base; this.id = 'anthropic'; }
  headers() { return {'x-api-key': this.key, 'anthropic-version': '2023-06-01'}; }
  async models(signal) {
    const models = []; let after;
    for (let page = 0; page < 10; page++) {
      const result = await this.transport.request(this.base + '/models?limit=100' + (after ? '&after_id=' + encodeURIComponent(after) : ''), {method: 'GET', headers: this.headers(), signal});
      models.push(...(result.data ?? []).map(model => ({id: model.id, name: model.display_name ?? model.id})));
      if (!result.has_more || !result.last_id || result.last_id === after) break; after = result.last_id;
    }
    return models;
  }
  input(messages) {
    const result = [];
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'assistant' : 'user'; let content;
      if (message.role === 'tool') content = [{type: 'tool_result', tool_use_id: message.callId, content: message.text, is_error: message.error === true}];
      else if (message.role === 'assistant' && message.providerState?.provider === this.id) content = message.providerState.content;
      else content = [...(message.text ? [{type: 'text', text: message.text}] : []), ...(message.calls ?? []).map(call => ({type: 'tool_use', id: call.id, name: call.name, input: call.arguments}))];
      if (result.at(-1)?.role === role) result.at(-1).content.push(...content); else result.push({role, content: [...content]});
    }
    return result;
  }
  async complete({model, system, messages, tools = [], maxOutputTokens = 4096, signal, onDelta = () => {}}) {
    const blocks = [], partial = new Map(); let usage = {}, stopped = false, stopReason;
    const json = await this.transport.request(this.base + '/messages', {headers: this.headers(), signal,
      body: {model, system, messages: this.input(messages), tools: tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.inputSchema})), max_tokens: maxOutputTokens, stream: true},
      onEvent: event => {
        if (event.type === 'message_start') usage = {...event.message?.usage};
        if (event.type === 'content_block_start') blocks[event.index] = {...event.content_block};
        if (event.type === 'content_block_delta') {
          const block = blocks[event.index], delta = event.delta; if (!block) throw new AgentError('PROVIDER_PROTOCOL', 'Unknown Anthropic content block');
          if (delta.type === 'text_delta') { block.text = (block.text ?? '') + delta.text; onDelta(delta.text); }
          if (delta.type === 'input_json_delta') partial.set(event.index, (partial.get(event.index) ?? '') + delta.partial_json);
          if (delta.type === 'thinking_delta') block.thinking = (block.thinking ?? '') + delta.thinking;
          if (delta.type === 'signature_delta') block.signature = (block.signature ?? '') + delta.signature;
        }
        if (event.type === 'content_block_stop' && partial.has(event.index)) { try { blocks[event.index].input = JSON.parse(partial.get(event.index)); } catch { throw new AgentError('INVALID_TOOL_JSON', 'Invalid Anthropic tool arguments'); } }
        if (event.type === 'message_delta') { usage = {...usage, ...event.usage}; stopReason = event.delta?.stop_reason; }
        if (event.type === 'message_stop') stopped = true;
        if (event.type === 'error') throw new AgentError('PROVIDER_RESPONSE', 'Anthropic reported a streaming error', {retryable: event.error?.type === 'overloaded_error'});
      }});
    const content = json?.content ?? blocks; if (json) { usage = json.usage ?? {}; stopReason = json.stop_reason; stopped = true; }
    if (!stopped) throw new AgentError('PROVIDER_STREAM', 'Anthropic stream ended before message_stop', {retryable: true});
    if (stopReason === 'max_tokens') throw new AgentError('OUTPUT_LIMIT', 'Anthropic output was incomplete; increase output reserve before resuming');
    const text = content.filter(block => block.type === 'text').map(block => block.text).join(''); if (json && text) onDelta(text);
    return {role: 'assistant', text, calls: content.filter(block => block.type === 'tool_use').map(block => ({id: block.id, name: block.name, arguments: block.input})),
      providerState: {provider: this.id, content}, usage: {input: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output: usage.output_tokens ?? 0, cached: usage.cache_read_input_tokens ?? 0}};
  }
}
