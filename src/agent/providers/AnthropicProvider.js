import {AgentError} from '../core/AgentError.js';
import {HttpTransport} from './HttpTransport.js';
import {AnthropicMessage} from './AnthropicMessage.js';

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
      if (!Array.isArray(content) || content.some(block => !block || typeof block !== 'object' || typeof block.type !== 'string'))
        throw new AgentError('INVALID_HISTORY', 'Invalid Anthropic message content in session history');
      // Empty streamed text blocks are legal locally but rejected on Messages API replay.
      // Do not alter signed thinking blocks or empty tool_result content.
      content = content.filter(block => block.type !== 'text' || block.text !== '');
      if (!content.length) continue;
      if (result.at(-1)?.role === role) result.at(-1).content.push(...content); else result.push({role, content: [...content]});
    }
    return result;
  }
  async complete({model, system, messages, tools = [], maxOutputTokens = 4096, signal, onDelta = () => {}}) {
    const message = new AnthropicMessage(onDelta);
    const json = await this.transport.request(this.base + '/messages', {headers: this.headers(), signal,
      body: {model, system, messages: this.input(messages), tools: tools.map(tool => ({name: tool.name, description: tool.description, input_schema: tool.inputSchema})), max_tokens: maxOutputTokens, stream: true},
      onEvent: event => message.accept(event)});
    const {content, calls, text, usage} = message.finish(json);
    return {role: 'assistant', text, calls, providerState: {provider: this.id, content},
      usage: {input: (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0), output: usage.output_tokens ?? 0, cached: usage.cache_read_input_tokens ?? 0}};
  }
}
