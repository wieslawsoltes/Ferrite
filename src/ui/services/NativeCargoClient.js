/** Explicitly configured loopback transport. Bearer tokens remain in memory only. */
export class NativeCargoClient {
  constructor({fetcher = (...args) => fetch(...args)} = {}) { this.fetcher = fetcher; this.base = null; this.token = null; this.capabilities = null; this.active = null;this.languageActive=null; this.operationId=null; }
  async connect(address, token) {
    if (this.active || this.languageActive) throw Error('Stop the active native operation before reconnecting');
    const url = new URL(address);
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw Error('Use an HTTP loopback address such as http://127.0.0.1:8787');
    if (typeof token !== 'string' || token.length < 16 || /[\r\n]/.test(token)) throw Error('Enter the private bearer token printed by the bridge');
    const response = await this.fetcher(`${url.origin}/v1/capabilities`, {headers: {Authorization: `Bearer ${token}`}, signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw Error(`Bridge connection refused (${response.status})`);
    const data = await response.json();
    if (data.backend !== 'native-cargo' || data.protocol !== 1 || !Array.isArray(data.commands)) throw Error('Unsupported Cargo bridge protocol');
    this.base = url.origin; this.token = token; this.capabilities = data; return data;
  }
  async run(files, command, options, onEvent = () => {}) {
    if (!this.capabilities?.commands.includes(command)) throw Error('Connect a native Cargo bridge supporting this command');
    return this.stream('/v1/run', {files, command, ...options}, onEvent);
  }
  async repository(action, input, onEvent = () => {}) {
    if (!this.capabilities?.repositories) throw Error('Connect an updated native bridge with repository support');
    if (!['open','run','reload','close','language','list'].includes(action)) throw Error('Unknown repository operation');
    const operation = this.stream('/v1/repository/' + action, input, onEvent);
    const active = this.active; if (action === 'language') this.languageActive = active;
    try { return await operation; } finally { if (action === 'language' && this.languageActive === active) this.languageActive = null; }
  }
  async stream(endpoint, payload, onEvent) {
    if (this.active) throw Error('A native command is already running');
    const controller = new AbortController(); this.active = controller;
    try {
      const response = await this.fetcher(`${this.base}${endpoint}`, {method: 'POST', headers: {Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify(payload), signal: controller.signal});
      if (!response.ok) throw Error((await response.json()).error ?? `Cargo request failed (${response.status})`);
      const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', result = null, bytes = 0;
      const deliver = line => { if (!line.trim()) return; const event = JSON.parse(line); if (event.type === 'started') this.operationId = event.operationId; if (event.type === 'error') throw Error(event.message); if (event.type === 'result') result = event.result; onEvent(event); };
      for (;;) {
        const {value, done} = await reader.read(); if (done) break;
        bytes += value.length; if (bytes > 32 * 1024 * 1024) { controller.abort(); throw Error('Cargo stream exceeded 32 MiB'); }
        buffer += decoder.decode(value, {stream: true}); let index;
        while ((index = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, index); buffer = buffer.slice(index + 1); deliver(line); }
      }
      buffer += decoder.decode(); deliver(buffer);
      if (!result) throw Error('Native Cargo stream ended before a result'); return result;
    } finally { controller.abort(); if (this.active === controller) { this.active = null; this.operationId = null; } }
  }
  async language(files,method,{file,position,newName,options={}}={}) {
    if(!this.capabilities?.languageServer?.methods.includes(method))throw Error('Connect a bridge with installed rust-analyzer support');
    if(this.languageActive)throw Error('A language request is already running');
    const controller=new AbortController();this.languageActive=controller;
    try {
      const response=await this.fetcher(`${this.base}/v1/lsp`,{method:'POST',headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify({files,method,file,position,newName,options}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(65000)])});
      const reader=response.body.getReader(),chunks=[];let length=0;
      for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>8*1024*1024){controller.abort();throw Error('Language response exceeds 8 MiB');}chunks.push(value);}
      const joined=new Uint8Array(length);let offset=0;for(const chunk of chunks){joined.set(chunk,offset);offset+=chunk.length;}
      const result=JSON.parse(new TextDecoder().decode(joined));if(!response.ok)throw Error(result.error??'Language request failed');return result;
    }finally{if(this.languageActive===controller)this.languageActive=null;}
  }
  async cancel() {
    this.languageActive?.abort();
    if (!this.base || !this.active) return;
    try { await this.fetcher(`${this.base}${this.operationId ? '/v1/repository/cancel' : '/v1/cancel'}`, {method: 'POST', headers: {Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({operationId: this.operationId}), signal: AbortSignal.timeout(3000)}); }
    finally { this.active?.abort(); }
  }
  async sendInput(id, text) {
    const response = await this.fetcher(`${this.base}/v1/repository/input`, {method: 'POST', headers: {Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json'}, body: JSON.stringify({id, text}), signal: AbortSignal.timeout(5000)});
    if (!response.ok) throw Error((await response.json()).error ?? 'Native stdin refused');
  }
  disconnect() { this.languageActive?.abort();this.active?.abort(); this.base = null; this.token = null; this.capabilities = null; }
}
