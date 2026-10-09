/** Capability-scoped messages to an opaque-origin, script-only preview iframe. */
export class PreviewChannel {
  constructor(frame, {timeoutMs = 10000, onEvent = () => {}, window: host = globalThis.window} = {}) {
    this.frame = frame; this.host = host; this.timeoutMs = timeoutMs; this.onEvent = onEvent;
    this.pending = new Map(); this.sequence = 0; this.channel = null; this.ready = false; this.disposed = false;
    frame.setAttribute('sandbox', 'allow-scripts'); frame.setAttribute('referrerpolicy', 'no-referrer');
    this.listener = event => this.receive(event); host.addEventListener('message', this.listener);
  }
  reset() {
    if (this.disposed) throw Error('Preview channel is disposed');
    this.rejectPending(new DOMException('Preview was replaced', 'AbortError')); this.ready = false;
    const bytes = new Uint8Array(24); this.host.crypto.getRandomValues(bytes);
    this.channel = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
    return this.channel;
  }
  load(html, channel) {
    if (this.disposed || channel !== this.channel) throw Error('Stale preview compilation');
    if (typeof html !== 'string' || html.length > 12_000_000) throw Error('Preview document exceeds its budget');
    this.frame.srcdoc = html;
  }
  receive(event) {
    const message = event.data;
    if (this.disposed || !this.channel || event.source !== this.frame.contentWindow || event.origin !== 'null' || !message || message.type !== 'ferrite-ui' || message.channel !== this.channel) return;
    if (typeof message.reply === 'string') {
      const task = this.pending.get(message.reply); if (!task) return;
      this.pending.delete(message.reply); clearTimeout(task.timer); task.signal?.removeEventListener('abort', task.abort);
      if (message.error) task.reject(Object.assign(Error(String(message.error.message).slice(0, 4000)), {code: message.error.code})); else task.resolve(message.result);
    } else if (typeof message.event === 'string') {
      if (message.event === 'ready') this.ready = true;
      if (message.event === 'error') this.onEvent({event: 'error', error: message.error});
      else this.onEvent(message);
    }
  }
  request(command, values = {}, {signal} = {}) {
    if (this.disposed || !this.ready) return Promise.reject(Error('Compile and load the UI preview first'));
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.pending.size >= 32) return Promise.reject(Error('Too many pending preview commands'));
    const id = String(++this.sequence), channel = this.channel;
    return new Promise((resolve, reject) => {
      const task = {resolve, reject, signal};
      const cancel = error => { this.pending.delete(id); clearTimeout(task.timer); signal?.removeEventListener('abort', task.abort); reject(error); };
      task.abort = () => cancel(signal.reason); task.timer = setTimeout(() => cancel(Error('Preview command timed out')), this.timeoutMs);
      signal?.addEventListener('abort', task.abort, {once: true}); this.pending.set(id, task);
      try { this.frame.contentWindow.postMessage({...values, type: 'ferrite-ui-command', command, channel, id}, '*'); }
      catch (error) { cancel(error); }
    });
  }
  rejectPending(error) {
    for (const task of this.pending.values()) { clearTimeout(task.timer); task.signal?.removeEventListener('abort', task.abort); task.reject(error); }
    this.pending.clear();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.ready = false;
    this.rejectPending(new DOMException('Preview disposed', 'AbortError')); this.host.removeEventListener('message', this.listener);
    this.channel = null; this.frame.removeAttribute('srcdoc');
  }
}
