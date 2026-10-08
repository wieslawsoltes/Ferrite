import {AgentError} from '../core/AgentError.js';
import {OpenAIProvider} from './OpenAIProvider.js';
import {AnthropicProvider} from './AnthropicProvider.js';
import {GeminiProvider} from './GeminiProvider.js';

/** Keys exist only in bridge memory. No generic credential-bearing proxy endpoints. */
export class ProviderRegistry {
  static definitions = {openai: {name: 'OpenAI', env: 'OPENAI_API_KEY', type: OpenAIProvider}, anthropic: {name: 'Anthropic', env: 'ANTHROPIC_API_KEY', type: AnthropicProvider}, gemini: {name: 'Google Gemini', env: 'GEMINI_API_KEY', type: GeminiProvider}};
  constructor({environment = process.env, transport} = {}) {
    this.providers = new Map(); this.transport = transport; this.catalogs = new Map();
    for (const [id, definition] of Object.entries(ProviderRegistry.definitions)) if (environment[definition.env]) this.providers.set(id, new definition.type({key: environment[definition.env], transport}));
  }
  list() { return Object.entries(ProviderRegistry.definitions).map(([id, definition]) => ({id, name: definition.name, connected: this.providers.has(id), models: this.catalogs.get(id) ?? []})); }
  get(id) { const provider = this.providers.get(id); if (!provider) throw new AgentError('PROVIDER_NOT_CONNECTED', 'Connect a provider with an API key or start the bridge with its API-key environment variable'); return provider; }
  async connect(id, key, signal) {
    const definition = Object.hasOwn(ProviderRegistry.definitions, id) ? ProviderRegistry.definitions[id] : undefined;
    if (!definition || typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n\0]/.test(key)) throw new AgentError('INVALID_PROVIDER', 'Select a supported provider and enter a valid API key');
    const provider = new definition.type({key: key.trim(), transport: this.transport}), models = await provider.models(signal);
    this.providers.set(id, provider); this.catalogs.set(id, models); return {id, connected: true, models};
  }
  async models(id, signal) { const models = await this.get(id).models(signal); this.catalogs.set(id, models); return models; }
  disconnect(id) { this.providers.delete(id); this.catalogs.delete(id); }
  redact(text) {
    let result = String(text); for (const provider of this.providers.values()) if (provider.key?.length > 4) result = result.replaceAll(provider.key, '[REDACTED]');
    return result.replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
  }
}
