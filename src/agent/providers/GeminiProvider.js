import {randomUUID} from 'node:crypto';
import {AgentError} from '../core/AgentError.js';
import {HttpTransport} from './HttpTransport.js';

/** generateContent adapter; thought signatures and function-call ids survive every turn. */
export class GeminiProvider {
  constructor({key, transport = new HttpTransport(), base = 'https://generativelanguage.googleapis.com/v1beta'} = {}) { this.key = key; this.transport = transport; this.base = base; this.id = 'gemini'; }
  headers() { return {'x-goog-api-key': this.key}; }
  async models(signal) {
    const models = []; let token;
    for (let page = 0; page < 10; page++) {
      const result = await this.transport.request(this.base + '/models?pageSize=100' + (token ? '&pageToken=' + encodeURIComponent(token) : ''), {method: 'GET', headers: this.headers(), signal});
      models.push(...(result.models ?? []).filter(model => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes('generateContent')).map(model => ({id: model.name.replace(/^models\//, ''), name: model.displayName ?? model.name, contextTokens: model.inputTokenLimit, outputTokens: model.outputTokenLimit})));
      if (!result.nextPageToken || result.nextPageToken === token) break; token = result.nextPageToken;
    }
    return models;
  }
  input(messages) {
    const result = [];
    for (const message of messages) {
      const role = message.role === 'assistant' ? 'model' : 'user'; let parts;
      if (message.role === 'tool') {
        let response; try { response = JSON.parse(message.text); } catch { response = {output: message.text}; }
        const original = messages.find(item => item.calls?.some(call => call.id === message.callId));
        const providerCall = original?.providerState?.parts?.find(part => part.functionCall?.name === message.name && (part.functionCall.id === message.callId || !part.functionCall.id));
        parts = [{functionResponse: {name: message.name, ...(providerCall?.functionCall?.id ? {id: providerCall.functionCall.id} : {}), response: message.error ? {error: response} : {result: response}}}];
      } else if (message.role === 'assistant' && message.providerState?.provider === this.id) parts = message.providerState.parts;
      else parts = [...(message.text ? [{text: message.text}] : []), ...(message.calls ?? []).map(call => ({functionCall: {name: call.name, args: call.arguments}}))];
      if (result.at(-1)?.role === role) result.at(-1).parts.push(...parts); else result.push({role, parts: [...parts]});
    }
    return result;
  }
  static schema(schema) {
    const result = structuredClone(schema);
    // Gemini's JSON Schema form supports optional properties; remove unnecessary defaults.
    return result;
  }
  async complete({model, system, messages, tools = [], maxOutputTokens = 4096, signal, onDelta = () => {}}) {
    const parts = []; let usage = {}, finishReason = null, blocked = false;
    const consume = event => {
      if (event.error) throw new AgentError('PROVIDER_RESPONSE', 'Gemini reported a response error');
      if (event.promptFeedback?.blockReason) blocked = true;
      const candidate = event.candidates?.[0]; if (!candidate) return;
      for (const part of candidate.content?.parts ?? []) {
        // Preserve full parts, especially signed tool calls; merge only unsigned text deltas.
        if (part.text && !part.thought) onDelta(part.text);
        const last = parts.at(-1);
        if (part.text && !part.thoughtSignature && last?.text && !last.thoughtSignature && !!part.thought === !!last.thought) last.text += part.text;
        else parts.push(structuredClone(part));
      }
      if (candidate.finishReason) finishReason = candidate.finishReason;
      if (event.usageMetadata) usage = event.usageMetadata;
    };
    const json = await this.transport.request(`${this.base}/models/${encodeURIComponent(model.replace(/^models\//, ''))}:streamGenerateContent?alt=sse`, {headers: this.headers(), signal,
      body: {systemInstruction: {parts: [{text: system}]}, contents: this.input(messages), ...(tools.length ? {tools: [{functionDeclarations: tools.map(tool => ({name: tool.name, description: tool.description, parametersJsonSchema: GeminiProvider.schema(tool.inputSchema)}))}]} : {}), generationConfig: {maxOutputTokens}}, onEvent: consume});
    if (json) for (const event of Array.isArray(json) ? json : [json]) consume(event);
    if (blocked || finishReason && !['STOP', 'MAX_TOKENS'].includes(finishReason)) throw new AgentError('PROVIDER_STOP', `Gemini stopped generation: ${finishReason ?? 'blocked prompt'}`);
    if (!finishReason) throw new AgentError('PROVIDER_STREAM', 'Gemini stream ended without a finish reason', {retryable: true});
    if (finishReason === 'MAX_TOKENS') throw new AgentError('OUTPUT_LIMIT', 'Gemini output was incomplete; increase output reserve before resuming');
    return {role: 'assistant', text: parts.filter(part => part.text && !part.thought).map(part => part.text).join(''),
      calls: parts.filter(part => part.functionCall).map(part => ({id: part.functionCall.id ?? randomUUID(), name: part.functionCall.name, arguments: part.functionCall.args ?? {}})),
      providerState: {provider: this.id, parts}, usage: {input: usage.promptTokenCount ?? 0, output: (usage.candidatesTokenCount ?? 0) + (usage.thoughtsTokenCount ?? 0), cached: usage.cachedContentTokenCount ?? 0}};
  }
}
