import {AgentError} from '../core/AgentError.js';
import {OpenAIProvider} from './OpenAIProvider.js';
import {AnthropicProvider} from './AnthropicProvider.js';
import {GeminiProvider} from './GeminiProvider.js';

/** Keys exist only in bridge memory. No generic credential-bearing proxy endpoints. */
export class ProviderRegistry {
  static definitions = {openai: {name: 'OpenAI', env: 'OPENAI_API_KEY', type: OpenAIProvider}, anthropic: {name: 'Anthropic', env: 'ANTHROPIC_API_KEY', type: AnthropicProvider}, gemini: {name: 'Google Gemini', env: 'GEMINI_API_KEY', type: GeminiProvider}};
  constructor({environment = process.env, transport} = {}) {
    this.secrets = new Set(); this.providers = new Map(); this.transport = transport; this.catalogs = new Map(); this.generations = new Map(); this.pending = new Map();
    for (const [id, definition] of Object.entries(ProviderRegistry.definitions)) {
      const key = environment[definition.env] || (id === 'gemini' ? environment.GOOGLE_API_KEY : undefined);
      if (key) { this.secrets.add(key); this.providers.set(id, new definition.type({key, transport})); }
    }
  }
  list() { return Object.entries(ProviderRegistry.definitions).map(([id, definition]) => ({id, name: definition.name, connected: this.providers.has(id), models: this.catalogs.get(id) ?? []})); }
  get(id) { const provider = this.providers.get(id); if (!provider) throw new AgentError('PROVIDER_NOT_CONNECTED', 'Connect a provider with an API key or start the bridge with its API-key environment variable'); return provider; }
  async connect(id, key, signal) {
    const definition = Object.hasOwn(ProviderRegistry.definitions, id) ? ProviderRegistry.definitions[id] : undefined;
    if (!definition || typeof key !== 'string' || !key.trim() || key.length > 4096 || /[\r\n\0]/.test(key)) throw new AgentError('INVALID_PROVIDER', 'Select a supported provider and enter a valid API key');
    this.pending.get(id)?.abort();
    const controller = new AbortController(), generation = (this.generations.get(id) ?? 0) + 1;
    this.generations.set(id, generation); this.pending.set(id, controller);
    const combined = AbortSignal.any([controller.signal, signal].filter(Boolean));
    const provider = new definition.type({key: key.trim(), transport: this.transport});
    this.secrets.add(provider.key);
    try {
      const models = await provider.models(combined); AgentError.abort(combined);
      if (this.generations.get(id) !== generation) throw new DOMException('Provider connection superseded', 'AbortError');
      this.providers.set(id, provider); this.catalogs.set(id, models); return {id, connected: true, models};
    } finally { if (this.pending.get(id) === controller) this.pending.delete(id); }
  }
  async models(id, signal) {
    const provider = this.get(id), generation = this.generations.get(id);
    const models = await provider.models(signal); AgentError.abort(signal);
    if (this.providers.get(id) !== provider || this.generations.get(id) !== generation) throw new DOMException('Provider account changed during discovery', 'AbortError');
    this.catalogs.set(id, models); return models;
  }
  disconnect(id) {
    this.generations.set(id, (this.generations.get(id) ?? 0) + 1);
    this.pending.get(id)?.abort(); this.pending.delete(id);
    this.providers.delete(id); this.catalogs.delete(id);
  }
  redact(text) {
    let result = String(text); for (const key of this.secrets) if (key?.length > 4) result = result.replaceAll(key, '[REDACTED]');
    return result.replace(/\b(?:sk-(?:proj-)?[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{20,})\b/g, '[REDACTED]');
  }
}
