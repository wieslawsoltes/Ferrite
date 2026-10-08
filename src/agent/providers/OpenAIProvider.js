import {AgentError} from '../core/AgentError.js';
import {HttpTransport} from './HttpTransport.js';

/** Responses API adapter; retains returned reasoning/encrypted items across tool turns. */
export class OpenAIProvider {
  constructor({key, transport = new HttpTransport(), base = 'https://api.openai.com/v1'} = {}) { this.key = key; this.transport = transport; this.base = base; this.id = 'openai'; }
  headers() { return {Authorization: `Bearer ${this.key}`}; }
  async models(signal) { const result = await this.transport.request(this.base + '/models', {method: 'GET', headers: this.headers(), signal}); return (result.data ?? []).map(model => ({id: model.id, name: model.id})); }
  input(messages) {
    return messages.flatMap(message => {
      if (message.role === 'tool') return [{type: 'function_call_output', call_id: message.callId, output: message.text}];
      if (message.role === 'assistant') {
        if (message.providerState?.provider === this.id) return message.providerState.output;
        return [...(message.text ? [{role: 'assistant', content: message.text}] : []), ...(message.calls ?? []).map(call => ({type: 'function_call', call_id: call.id, name: call.name, arguments: JSON.stringify(call.arguments)}))];
      }
      return [{role: 'user', content: message.text}];
    });
  }
  async complete({model, system, messages, tools = [], maxOutputTokens = 4096, signal, onDelta = () => {}}) {
    let final = null;
    const json = await this.transport.request(this.base + '/responses', {headers: this.headers(), signal,
      body: {model, instructions: system, input: this.input(messages), tools: tools.map(tool => ({type: 'function', name: tool.name, description: tool.description, parameters: tool.inputSchema, strict: false})),
        stream: true, store: false, include: ['reasoning.encrypted_content'], max_output_tokens: maxOutputTokens},
      onEvent: event => {
        if (event.type === 'response.output_text.delta') onDelta(event.delta ?? '');
        if (event.type === 'response.completed' || event.type === 'response.incomplete') final = event.response;
        if (event.type === 'error' || event.type === 'response.failed') throw new AgentError('PROVIDER_RESPONSE', 'OpenAI could not complete the response');
      }});
    final ??= json;
    if (!final?.output) throw new AgentError('PROVIDER_STREAM', 'OpenAI stream ended before its terminal response', {retryable: true});
    if (final.status === 'incomplete') throw new AgentError('OUTPUT_LIMIT', 'OpenAI output was incomplete; increase output reserve before resuming');
    const calls = final.output.filter(item => item.type === 'function_call').map(item => {
      let args; try { args = JSON.parse(item.arguments); } catch { throw new AgentError('INVALID_TOOL_JSON', `Invalid arguments for ${item.name}`); }
      return {id: item.call_id, name: item.name, arguments: args};
    });
    const text = final.output.filter(item => item.type === 'message').flatMap(item => item.content ?? []).map(part => part.text ?? part.refusal ?? '').join('');
    if (json && text) onDelta(text);
    return {role: 'assistant', text, calls, providerState: {provider: this.id, output: final.output}, usage: {input: final.usage?.input_tokens ?? 0, output: final.usage?.output_tokens ?? 0, cached: final.usage?.input_tokens_details?.cached_tokens ?? 0}};
  }
}
