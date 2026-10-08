import {RepositoryBridgeRouter} from './repository/RepositoryBridgeRouter.js';
import {RustAnalyzerSession} from './lsp/RustAnalyzerSession.js';
import {createServer} from 'node:http';
import {randomBytes, timingSafeEqual} from 'node:crypto';
import {NativeCargoRunner} from './NativeCargoRunner.js';

/** Opt-in, bearer-authenticated loopback bridge. Native projects must be trusted. */
export class CargoBridgeServer {
  constructor({origins = ['http://127.0.0.1:8080', 'http://localhost:8080'], runner = new NativeCargoRunner(), language = new RustAnalyzerSession(), token = randomBytes(32).toString('hex'), repositories = {}} = {}) {
    this.origins = new Set(origins.map(value => new URL(value).origin)); this.runner = runner;this.language=language;this.languageActive=null; this.token = token;
    this.repositories = new RepositoryBridgeRouter(this, repositories);
    this.active = null; this.server = createServer((request, response) => this.handle(request, response));
    this.server.requestTimeout = 15000; this.server.headersTimeout = 10000;
  }
  authorized(request) {
    const supplied = Buffer.from(String(request.headers.authorization ?? '')), expected = Buffer.from(`Bearer ${this.token}`);
    return supplied.length === expected.length && timingSafeEqual(supplied, expected);
  }
  async body(request) {
    const chunks = []; let bytes = 0;
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) throw Error('Request exceeds 12 MiB'); chunks.push(chunk); }
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Expected a JSON object');
    return value;
  }
  reply(response, code, value) { response.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); response.end(JSON.stringify(value)); }
  async handle(request, response) {
    const origin = request.headers.origin;
    if (origin && !this.origins.has(origin)) return this.reply(response, 403, {error: 'Origin is not allowed'});
    const host = request.headers.host;
    if (![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(host)) return this.reply(response, 403, {error: 'Invalid loopback Host header'});
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') { response.writeHead(204); response.end(); return; }
    if (!this.authorized(request)) return this.reply(response, 401, {error: 'A valid bridge bearer token is required'});
    if (request.method === 'GET' && request.url === '/v1/capabilities') return this.reply(response, 200, {
      backend: 'native-cargo', protocol: 1, repositories: this.repositories.capabilities(), commands: [...NativeCargoRunner.commands], busy: !!this.active, languageServer:{backend:'rust-analyzer',methods:[...RustAnalyzerSession.methods],lazy:true},
      warning: 'Native Cargo, build scripts and programs execute with the local user permissions. This is not a sandbox.'
    });
    if (request.url.startsWith('/v1/repository/')) return this.repositories.handle(request, response);
    if(request.method==='POST'&&request.url==='/v1/lsp')return this.languageRequest(request,response);
    if (request.method === 'POST' && request.url === '/v1/cancel') {
      this.active?.controller.abort(); return this.reply(response, 200, {cancelled: !!this.active});
    }
    if (request.method !== 'POST' || request.url !== '/v1/run') return this.reply(response, 404, {error: 'Unknown endpoint'});
    if (this.active) return this.reply(response, 409, {error: 'A native command is already running'});
    if (!String(request.headers['content-type']).startsWith('application/json')) return this.reply(response, 415, {error: 'Expected application/json'});
    let input;
    try { input = await this.body(request); } catch (error) { return this.reply(response, 400, {error: error.message}); }
    if (this.active) return this.reply(response, 409, {error: 'A native command is already running'});
    const controller = new AbortController();
    const emit = value => { if (!response.destroyed) response.write(JSON.stringify(value) + '\n'); };
    response.writeHead(200, {'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
    const disconnected = () => { if (!response.writableEnded) controller.abort(); }; response.on('close', disconnected);
    const operation = (async () => {
      const lease = await this.repositories.manager.budget.acquire(input.jobs, controller.signal);
      try { return await this.runner.run({files: input.files}, input.command, {
      jobs: lease.jobs, toolchain: input.toolchain ?? '',
      args: input.args ?? [], json: input.json === true, offline: input.offline === true, locked: input.locked === true,
      timeoutMs: Math.min(600000, Math.max(1000, Number(input.timeoutMs) || 120000)), signal: controller.signal,
      onEvent: event => emit({type: 'log', ...event})
    }); } finally { lease.release(); } })();
    this.active = {controller, operation};
    try { emit({type: 'result', result: await operation}); }
    catch (error) { emit({type: 'error', message: error.message}); }
    finally { this.active = null; response.off('close', disconnected); if (!response.destroyed) response.end(); }
  }
  async languageRequest(request,response){
    if(this.languageActive)return this.reply(response,409,{error:'A language operation is already running'});
    if(!String(request.headers['content-type']).startsWith('application/json'))return this.reply(response,415,{error:'Expected application/json'});
    let input;try{input=await this.body(request);}catch(error){return this.reply(response,400,{error:error.message});}
    if(this.languageActive)return this.reply(response,409,{error:'A language operation is already running'});
    const controller=new AbortController(),closed=()=>{if(!response.writableEnded)controller.abort();};response.on('close',closed);
    const operation=this.language.request({files:input.files},input.method,{file:input.file,position:input.position,newName:input.newName,options:input.options??{},signal:controller.signal});
    this.languageActive={controller,operation};
    try{const result=await operation;if(!response.destroyed)this.reply(response,200,result);}
    catch(error){if(!response.destroyed)this.reply(response,400,{error:error.message});}
    finally{this.languageActive=null;response.off('close',closed);}
  }
  async listen(port = 0) {
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
    this.port = this.server.address().port; return {url: `http://127.0.0.1:${this.port}`, token: this.token};
  }
  async close() {
    if (this.active) { this.active.controller.abort(); try { await this.active.operation; } catch {} }
    if(this.languageActive){this.languageActive.controller.abort();try{await this.languageActive.operation;}catch{}}
    await this.repositories.dispose();
    await this.language.dispose();
    this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve)); await this.runner.dispose();
  }
}
