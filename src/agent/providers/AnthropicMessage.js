import {AgentError} from '../core/AgentError.js';

const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const protocol = message => new AgentError('PROVIDER_PROTOCOL', `Anthropic ${message}`);
const knownEvents = new Set(['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'message_delta', 'message_stop']);

/** Accumulate one Messages response. Nothing executable escapes before the whole turn is validated. */
export class AnthropicMessage {
  constructor(onDelta = () => {}) {
    this.onDelta = onDelta; this.blocks = []; this.closed = new Set(); this.fragments = new Map();
    this.usage = {}; this.started = false; this.stopped = false; this.stopReason = null;
  }
  static error(error) {
    // Never echo provider error messages: a gateway can reflect credentials or source code.
    const type = error?.type;
    if (type === 'authentication_error' || type === 'permission_error')
      return new AgentError('PROVIDER_AUTH', 'Anthropic rejected API access; check the API key and model entitlement', {status: type === 'authentication_error' ? 401 : 403});
    return new AgentError('PROVIDER_RESPONSE', type === 'overloaded_error' ? 'Anthropic is temporarily overloaded' : type === 'rate_limit_error' ? 'Anthropic rate limit reached' : 'Anthropic reported a response error',
      {retryable: ['overloaded_error', 'rate_limit_error', 'api_error'].includes(type)});
  }
  block(index) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.blocks.length || this.closed.has(index))
      throw protocol('received an event for an unknown or closed content block');
    return this.blocks[index];
  }
  accept(event) {
    if (!isObject(event) || typeof event.type !== 'string') throw protocol('returned an invalid stream event');
    if (event.type === 'error') throw AnthropicMessage.error(event.error);
    // Pings and future event types are not content and must not break an otherwise valid stream.
    if (!knownEvents.has(event.type)) return;
    if (this.stopped) throw protocol('sent content after message_stop');
    if (event.type === 'message_start') {
      if (this.started || !isObject(event.message)) throw protocol('returned an invalid message_start');
      this.started = true; this.usage = {...event.message.usage}; return;
    }
    if (!this.started) throw protocol('sent content before message_start');
    switch (event.type) {
      case 'content_block_start': {
        // Sequential starts prevent duplicate/sparse indices without allocating a provider-sized sparse array.
        if (event.index !== this.blocks.length || !isObject(event.content_block) || typeof event.content_block.type !== 'string')
          throw protocol('returned an invalid content_block_start');
        const block = {...event.content_block}; this.blocks.push(block);
        if (block.type === 'text') {
          if (typeof block.text !== 'string') throw protocol('returned invalid text content');
          if (block.text) this.onDelta(block.text);
        }
        break;
      }
      case 'content_block_delta': {
        const block = this.block(event.index), delta = event.delta;
        if (!isObject(delta) || typeof delta.type !== 'string') throw protocol('returned an invalid content delta');
        const append = (type, key, value) => {
          if (block.type !== type || typeof value !== 'string') throw protocol('returned a mismatched content delta');
          block[key] = (block[key] ?? '') + value;
        };
        switch (delta.type) {
          case 'text_delta': append('text', 'text', delta.text); this.onDelta(delta.text); break;
          case 'thinking_delta': append('thinking', 'thinking', delta.thinking); break;
          case 'signature_delta': append('thinking', 'signature', delta.signature); break;
          case 'input_json_delta': {
            if (!['tool_use', 'server_tool_use'].includes(block.type) || typeof delta.partial_json !== 'string')
              throw protocol('returned an invalid tool-input delta');
            // Empty deltas are legal. In particular, a no-argument tool may send only "";
            // its authoritative initial input remains {} and must never become JSON.parse('').
            if (delta.partial_json.length) {
              let parts = this.fragments.get(event.index);
              if (!parts) this.fragments.set(event.index, parts = []);
              parts.push(delta.partial_json);
            }
            break;
          }
          case 'citations_delta':
            if (block.type !== 'text' || !isObject(delta.citation)) throw protocol('returned an invalid citation delta');
            block.citations = [...(block.citations ?? []), delta.citation]; break;
          // Preserve unknown blocks and tolerate newly introduced delta types.
        }
        break;
      }
      case 'content_block_stop': this.block(event.index); this.closed.add(event.index); break;
      case 'message_delta':
        this.usage = {...this.usage, ...event.usage};
        if (event.delta?.stop_reason != null) this.stopReason = event.delta.stop_reason;
        break;
      case 'message_stop': this.stopped = true; break;
    }
  }
  finish(json) {
    let content = this.blocks, usage = this.usage, stopReason = this.stopReason;
    if (json != null) {
      if (json.type === 'error') throw AnthropicMessage.error(json.error);
      if (this.started || !isObject(json) || !Array.isArray(json.content)) throw protocol('returned an invalid JSON message');
      content = json.content.map(block => isObject(block) ? {...block} : block);
      usage = json.usage ?? {}; stopReason = json.stop_reason;
    } else if (!this.started || !this.stopped) {
      throw new AgentError('PROVIDER_STREAM', 'Anthropic stream ended before message_stop; no tools from this response were executed', {retryable: true});
    }
    // The terminal status arrives AFTER content_block_stop. Classify truncation before
    // parsing an unfinished edit, otherwise max_tokens is misreported as malformed JSON.
    if (stopReason === 'max_tokens') throw new AgentError('OUTPUT_LIMIT', 'Anthropic reached the output limit; no tools from this response were executed. Increase Output reserve in Context, then resume.');
    if (stopReason === 'model_context_window_exceeded') throw new AgentError('CONTEXT_LIMIT', 'Anthropic filled the model context window; no tools from this response were executed. Compact the context or start a new session.');
    if (stopReason === 'refusal') throw new AgentError('PROVIDER_REFUSAL', 'Anthropic declined this response; no tools from this response were executed');
    if (stopReason === 'pause_turn') throw new AgentError('PROVIDER_PAUSED', 'Anthropic paused a server-tool turn; no client tools from this response were executed');
    if (!['end_turn', 'tool_use', 'stop_sequence'].includes(stopReason)) throw protocol('returned a missing or unsupported stop reason');
    if (json == null && this.closed.size !== this.blocks.length) throw protocol('ended with an unclosed content block; no tools from this response were executed');
    for (let index = 0; index < content.length; index++) {
      const block = content[index];
      if (!isObject(block) || typeof block.type !== 'string') throw protocol('returned an invalid content block');
      if (block.type === 'text' && typeof block.text !== 'string') throw protocol('returned invalid text content');
      if (!['tool_use', 'server_tool_use'].includes(block.type)) continue;
      const invalidInput = () => new AgentError('INVALID_TOOL_JSON', `Anthropic tool input in content block ${index} must be a complete JSON object; no tools from this response were executed. Resume to request a fresh response.`);
      const parts = this.fragments.get(index);
      if (parts) {
        try { block.input = JSON.parse(parts.join('')); } catch { throw invalidInput(); }
      }
      if (!isObject(block.input)) throw invalidInput();
      if (typeof block.id !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(block.id) || ['__proto__', 'constructor', 'prototype'].includes(block.id) ||
          typeof block.name !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(block.name)) throw protocol('returned an invalid tool identity');
    }
    const calls = content.filter(block => block.type === 'tool_use').map(block => ({id: block.id, name: block.name, arguments: block.input}));
    if ((stopReason === 'tool_use') !== (calls.length > 0)) throw protocol('returned inconsistent tool calls and stop reason');
    if (new Set(calls.map(call => call.id)).size !== calls.length) throw protocol('returned duplicate tool-call identifiers');
    const text = content.filter(block => block.type === 'text').map(block => block.text).join('');
    if (json != null && text) this.onDelta(text);
    return {content, calls, text, usage};
  }
}
