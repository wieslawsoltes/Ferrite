/** Browser-side loopback client. Tokens and API credentials are never written to web storage. */
export class AgentClient {
  constructor({fetcher = fetch} = {}) { this.fetcher = fetcher; this.url = null; this.token = null; this.clientId = null; this.capabilities = null; }
  async connect(url, token) {
    const target = new URL(url);
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) throw Error('Use the loopback bridge URL, e.g. http://127.0.0.1:8790');
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /\s/.test(token)) throw Error('Enter the private bearer token printed by the bridge');
    this.url = target.origin; this.token = token;
    try { this.capabilities = await this.request('/v1/capabilities'); this.clientId = (await this.request('/v1/ide/connect', {})).clientId; return this.capabilities; }
    catch (error) { this.url = this.token = this.clientId = this.capabilities = null; throw error; }
  }
  async request(path, data, {signal, timeoutMs = 660000} = {}) {
    if (!this.url || !this.token) throw Error('Connect the agent bridge first');
    if (!path.startsWith('/v1/') || path.includes('://')) throw Error('Invalid bridge API path');
    const response = await this.fetcher(this.url + path, {method: data === undefined ? 'GET' : 'POST', headers: {Authorization: 'Bearer ' + this.token, ...(data === undefined ? {} : {'Content-Type': 'application/json'})}, body: data === undefined ? undefined : JSON.stringify(data), signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)].filter(Boolean)), redirect: 'error', cache: 'no-store'});
    const text = await response.text(); if (text.length > 50 * 1024 * 1024) throw Error('Bridge response exceeds size limit');
    let result; try { result = JSON.parse(text); } catch { throw Error('The bridge returned invalid JSON'); }
    if (!response.ok) { const error = new Error(result.error?.message ?? result.error ?? `Bridge HTTP ${response.status}`); error.code = result.error?.code; error.status = response.status; throw error; }
    return result;
  }
  async disconnect() { if (this.clientId) await this.request('/v1/ide/disconnect', {clientId: this.clientId}, {timeoutMs: 3000}).catch(() => {}); this.url = this.token = this.clientId = this.capabilities = null; }
}
