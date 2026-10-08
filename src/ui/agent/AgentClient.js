/** Browser-side loopback client. Credentials live only in a connection's memory. */
export class AgentClient {
  #connection = null;
  #pending = null;

  constructor({fetcher = globalThis.fetch, maxResponseBytes = 50 * 1024 * 1024} = {}) {
    if (typeof fetcher !== 'function') throw new TypeError('A fetch implementation is required');
    if (!Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1) throw new TypeError('Invalid response byte limit');
    // Web IDL fetch requires the global receiver, not an AgentClient instance.
    this.fetcher = fetcher.bind(globalThis);
    this.maxResponseBytes = maxResponseBytes;
    this.epoch = 0;
  }
  get url() { return this.#connection?.url ?? null; }
  get token() { return this.#connection?.token ?? null; }
  get clientId() { return this.#connection?.clientId ?? null; }
  get capabilities() { return this.#connection?.capabilities ?? null; }
  get connected() { return this.#connection !== null; }
  get connecting() { return this.#pending !== null; }

  async connect(url, token, {signal} = {}) {
    const target = new URL(url);
    if (target.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(target.hostname) || target.username || target.password || target.search || target.hash || !['', '/'].includes(target.pathname)) throw Error('Use the loopback bridge URL, e.g. http://127.0.0.1:8790');
    if (typeof token !== 'string' || token.length < 16 || token.length > 4096 || /\s/.test(token)) throw Error('Enter the private bearer token printed by the bridge');
    if (this.#pending || this.#connection) throw Error('Disconnect the current bridge before connecting again');
    signal?.throwIfAborted();
    const connection = {url: target.origin, token, clientId: null, controller: new AbortController()};
    const epoch = ++this.epoch;
    this.#pending = connection;
    try {
      connection.capabilities = await this.send(connection, '/v1/capabilities', undefined, {signal, timeoutMs: 10000});
      const result = await this.send(connection, '/v1/ide/connect', {}, {signal, timeoutMs: 10000});
      if (typeof result?.clientId !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(result.clientId)) throw Error('The bridge returned an invalid IDE owner');
      connection.clientId = result.clientId;
      signal?.throwIfAborted();
      connection.controller.signal.throwIfAborted();
      if (this.epoch !== epoch) throw new DOMException('Connection was superseded', 'AbortError');
      // Publish atomically. Pollers cannot heartbeat a null owner mid-handshake.
      this.#connection = connection;
      return connection.capabilities;
    } catch (error) {
      connection.controller.abort();
      await this.release(connection);
      throw error;
    } finally {
      if (this.#pending === connection) this.#pending = null;
    }
  }

  async request(path, data, options = {}) {
    const connection = this.#connection;
    if (!connection) throw Error('Connect the agent bridge first');
    return this.send(connection, path, data, options);
  }

  async send(connection, path, data, {signal, timeoutMs = 660000} = {}) {
    if (typeof path !== 'string' || !path.startsWith('/v1/') || /[\\#\r\n]/.test(path)) throw Error('Invalid bridge API path');
    const target = new URL(path, connection.url);
    if (target.origin !== connection.url || !target.pathname.startsWith('/v1/')) throw Error('Invalid bridge API path');
    const combined = AbortSignal.any([connection.controller.signal, signal, AbortSignal.timeout(timeoutMs)].filter(Boolean));
    combined.throwIfAborted();
    const response = await this.fetcher(target.href, {
      method: data === undefined ? 'GET' : 'POST',
      headers: {Authorization: 'Bearer ' + connection.token, ...(data === undefined ? {} : {'Content-Type': 'application/json'})},
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: combined, redirect: 'error', cache: 'no-store', credentials: 'omit'
    });
    combined.throwIfAborted();
    const text = await this.read(response, combined);
    combined.throwIfAborted(); // Also reject obsolete results from injected transports.
    let result;
    try { result = JSON.parse(text); } catch { throw Error('The bridge returned invalid JSON'); }
    if (!response.ok) {
      const error = new Error(result?.error?.message ?? result?.error ?? `Bridge HTTP ${response.status}`);
      error.code = result?.error?.code; error.status = response.status; throw error;
    }
    return result;
  }

  async read(response, signal) {
    const declared = response.headers.get('content-length');
    if (declared !== null && Number(declared) > this.maxResponseBytes) {
      await response.body?.cancel().catch(() => {});
      throw Error('Bridge response exceeds size limit');
    }
    if (!response.body) return '';
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
    const chunks = []; let bytes = 0;
    const abort = () => { reader.cancel(signal.reason).catch(() => {}); };
    signal.addEventListener('abort', abort, {once: true});
    try {
      signal.throwIfAborted();
      while (true) {
        const {value, done} = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > this.maxResponseBytes) throw Error('Bridge response exceeds size limit');
        chunks.push(decoder.decode(value, {stream: true}));
      }
      chunks.push(decoder.decode());
      return chunks.join('');
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      signal.removeEventListener('abort', abort);
      reader.releaseLock();
    }
  }

  async release(connection) {
    if (!connection.clientId) return;
    // Release uses the old credentials and an independent deadline: it must not
    // cancel or clear a newly established connection when its response arrives.
    await this.send({...connection, controller: new AbortController()}, '/v1/ide/disconnect',
      {clientId: connection.clientId}, {timeoutMs: 3000}).catch(() => {});
  }

  async disconnect() {
    const connection = this.#connection, pending = this.#pending;
    ++this.epoch;
    this.#connection = this.#pending = null;
    connection?.controller.abort(new DOMException('Bridge disconnected', 'AbortError'));
    pending?.controller.abort(new DOMException('Connection cancelled', 'AbortError'));
    if (connection) await this.release(connection);
  }
}
