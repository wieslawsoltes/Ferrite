import {AgentError} from '../core/AgentError.js';

/** Bounded JSON/SSE transport. Redirects are rejected so authorization cannot be forwarded. */
export class HttpTransport {
  constructor({fetcher = (...args) => globalThis.fetch(...args), maxBytes = 16 * 1024 * 1024, timeoutMs = 180000} = {}) { this.fetcher = fetcher; this.maxBytes = maxBytes; this.timeoutMs = timeoutMs; }
  static retryAfter(value, now = Date.now()) {
    if (!value) return 0; const seconds = Number(value);
    return Math.max(0, Math.min(120000, Number.isFinite(seconds) ? seconds * 1000 : (Date.parse(value) || now) - now));
  }
  async request(url, {method = 'POST', headers = {}, body, signal, onEvent} = {}) {
    AgentError.abort(signal); const combined = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(this.timeoutMs)]);
    let response;
    try { response = await this.fetcher(url, {method, headers: {'Content-Type': 'application/json', ...headers}, ...(body === undefined ? {} : {body: JSON.stringify(body)}), signal: combined, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer'}); }
    catch (error) { AgentError.abort(signal); throw new AgentError('PROVIDER_NETWORK', 'Provider connection failed or timed out. Check network access, API entitlement and browser CORS; no proxy or billing fallback was used.', {retryable: true, status: 502, cause: error}); }
    if (!response.ok) {
      // Do not echo response bodies: gateways can reflect tokens and submitted source code.
      await response.body?.cancel();
      throw new AgentError(response.status === 401 || response.status === 403 ? 'PROVIDER_AUTH' : 'PROVIDER_HTTP',
        `Provider returned HTTP ${response.status}${response.status === 401 ? '; check the API key' : ''}`,
        {status: response.status, retryable: [408, 409, 425, 429, 500, 502, 503, 504, 529].includes(response.status), retryAfterMs: HttpTransport.retryAfter(response.headers.get('retry-after'))});
    }
    if (!response.body) throw new AgentError('PROVIDER_PROTOCOL', 'Provider response has no body');
    const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true});
    const abortReader = () => { void reader.cancel().catch(() => {}); };
    combined.addEventListener('abort', abortReader, {once: true});
    let bytes = 0, buffer = '', data = [], eventName = '', json = '', streamed = String(response.headers.get('content-type')).includes('text/event-stream');
    const deliver = () => {
      if (data.length) {
        const text = data.join('\n');
        if (text !== '[DONE]') {
          let value; try { value = JSON.parse(text); } catch { throw new AgentError('PROVIDER_PROTOCOL', 'Invalid JSON in provider event stream'); }
          onEvent?.(value, eventName);
        }
      }
      data = []; eventName = '';
    };
    const line = text => { if (!text) deliver(); else if (text.startsWith('data:')) data.push(text.slice(5).replace(/^ /, '')); else if (text.startsWith('event:')) eventName = text.slice(6).trim(); };
    try {
      for (;;) {
        AgentError.abort(combined); const {done, value} = await reader.read(); AgentError.abort(combined); if (done) break;
        bytes += value.byteLength; if (bytes > this.maxBytes) throw new AgentError('PROVIDER_LIMIT', 'Provider response exceeded 16 MiB');
        const text = decoder.decode(value, {stream: true});
        if (!streamed) { json += text; continue; }
        buffer += text; let end;
        while ((end = buffer.indexOf('\n')) >= 0) { line(buffer.slice(0, end).replace(/\r$/, '')); buffer = buffer.slice(end + 1); }
      }
      const tail = decoder.decode();
      if (streamed) { buffer += tail; if (buffer) line(buffer.replace(/\r$/, '')); deliver(); return null; }
      try { return JSON.parse(json + tail); } catch { throw new AgentError('PROVIDER_PROTOCOL', 'Provider returned invalid JSON'); }
    } catch (error) {
      await reader.cancel().catch(() => {}); AgentError.abort(signal);
      if (error instanceof AgentError) throw error;
      throw new AgentError('PROVIDER_STREAM', 'Provider stream was interrupted', {retryable: true, status: 502, cause: error});
    } finally { combined.removeEventListener('abort', abortReader); reader.releaseLock(); }
  }
}
