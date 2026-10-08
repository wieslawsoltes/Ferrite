/** Stable machine-readable failures. Never attach credentials or HTTP request headers. */
export class AgentError extends Error {
  constructor(code, message, {retryable = false, status = 400, retryAfterMs = 0, cause} = {}) {
    super(message, {cause}); this.name = 'AgentError'; this.code = code;
    this.retryable = retryable; this.status = status; this.retryAfterMs = retryAfterMs;
  }
  toJSON() { return {code: this.code, message: this.message, retryable: this.retryable}; }
  static abort(signal) { if (signal?.aborted) throw signal.reason ?? new DOMException('Cancelled', 'AbortError'); }
}
