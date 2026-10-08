import {createServer} from 'node:http';
import {randomBytes, randomUUID, timingSafeEqual} from 'node:crypto';
import {McpServer} from '../mcp/McpServer.js';
import {AgentError} from '../core/AgentError.js';
import {JsonSchema} from '../core/JsonSchema.js';
import {changes as changeSchema} from '../tools/ToolSchemas.js';

/** Authenticated loopback-only bridge. Explicit origins prevent drive-by browser access. */
export class AgentBridgeServer {
  constructor(runtime, {origins = ['http://127.0.0.1:8080', 'http://localhost:8080'], token = randomBytes(32).toString('hex')} = {}) {
    this.runtime = runtime; this.token = token; this.origins = new Set(origins.map(value => { const url = new URL(value); if (!['http:', 'https:'].includes(url.protocol) || url.origin === 'null') throw Error('Expected an explicit HTTP origin'); return url.origin; }));
    this.legacy = new Map(); this.requests = new Set(); this.modern = new McpServer(runtime, {owner: 'mcp-http', context: {interactive: true}});
    this.server = createServer((request, response) => { this.handle(request, response).catch(error => { if (!response.headersSent) this.reply(response, 500, {error: {code: 'INTERNAL', message: runtime.providers.redact(error.message)}}); else response.destroy(); }); });
    this.server.requestTimeout = 15000; this.server.headersTimeout = 10000; this.server.maxHeadersCount = 64;
  }
  authorized(request) { const value = Buffer.from(String(request.headers.authorization ?? '')), expected = Buffer.from('Bearer ' + this.token); return value.length === expected.length && timingSafeEqual(value, expected); }
  reply(response, status, value) { if (response.destroyed) return; response.writeHead(status, {'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}); response.end(value === undefined ? '' : JSON.stringify(value)); }
  async body(request) {
    if (!/^application\/json(?:;|$)/i.test(String(request.headers['content-type']))) throw new AgentError('CONTENT_TYPE', 'Expected application/json', {status: 415});
    let bytes = 0; const chunks = [];
    for await (const chunk of request) { bytes += chunk.length; if (bytes > 12 * 1024 * 1024) throw new AgentError('BODY_LIMIT', 'Request exceeds 12 MiB', {status: 413}); chunks.push(chunk); }
    let value; try { value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(Buffer.concat(chunks))); } catch { throw new AgentError('INVALID_JSON', 'Invalid UTF-8 JSON'); }
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new AgentError('INVALID_JSON', 'Expected a JSON object');
    return value;
  }
  async handle(request, response) {
    const origin = request.headers.origin;
    if (origin && !this.origins.has(origin)) return this.reply(response, 403, {error: {code: 'ORIGIN', message: 'Origin is not allowed'}});
    if (![`127.0.0.1:${this.port}`, `localhost:${this.port}`].includes(request.headers.host)) return this.reply(response, 403, {error: {code: 'HOST', message: 'Invalid loopback Host header'}});
    if (origin) { response.setHeader('Access-Control-Allow-Origin', origin); response.setHeader('Vary', 'Origin'); }
    response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type, MCP-Protocol-Version, MCP-Session-Id');
    response.setHeader('Access-Control-Expose-Headers', 'MCP-Session-Id, MCP-Protocol-Version');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS'); response.setHeader('Access-Control-Allow-Private-Network', 'true');
    if (request.method === 'OPTIONS') return this.reply(response, 204);
    if (!this.authorized(request)) return this.reply(response, 401, {error: {code: 'AUTH', message: 'A valid bridge bearer token is required'}});
    if (this.requests.size >= 64) return this.reply(response, 429, {error: {code: 'CAPACITY', message: 'Bridge request capacity reached'}});
    const controller = new AbortController(), disconnected = () => { if (!response.writableEnded) controller.abort(); };
    this.requests.add(controller); response.once('close', disconnected);
    try {
      const url = new URL(request.url, `http://127.0.0.1:${this.port}`);
      if (url.pathname === '/mcp') return await this.mcp(request, response, controller.signal);
      const input = request.method === 'POST' ? await this.body(request) : {};
      const result = await this.route(request.method, url, input, controller.signal);
      this.reply(response, 200, result ?? {});
    } catch (error) { this.reply(response, Number.isInteger(error.status) ? error.status : error.code === 'ENOENT' ? 404 : 400, {error: {code: error.code ?? 'REQUEST_ERROR', message: this.runtime.providers.redact(error.message)}}); }
    finally { this.requests.delete(controller); response.off('close', disconnected); }
  }
  async route(method, url, input, signal) {
    const runtime = this.runtime, route = url.pathname, get = method === 'GET', post = method === 'POST';
    if (get && route === '/v1/capabilities') return runtime.capabilities();
    if (get && route === '/v1/events') return runtime.events.read(Number(url.searchParams.get('cursor') ?? 0));
    if (get && route === '/v1/providers') return runtime.providers.list();
    if (post && route === '/v1/providers/connect') return runtime.providers.connect(input.provider, input.key, signal);
    if (post && route === '/v1/providers/models') return {models: await runtime.providers.models(input.provider, signal)};
    if (post && route === '/v1/providers/disconnect') { runtime.providers.disconnect(input.provider); return {disconnected: true}; }
    if (get && route === '/v1/workspace') return runtime.workspace.snapshot();
    if (post && route === '/v1/workspace/apply') { JsonSchema.validate(input.changes, changeSchema); return runtime.workspace.apply(input.changes, {label: 'IDE synchronization'}); }
    if (get && route === '/v1/tools') return runtime.tools.list();
    if (post && route === '/v1/tools/call') return runtime.tools.execute(input.name, input.arguments ?? {}, {sessionId: 'manual-tools', signal, interactive: true});
    if (get && route === '/v1/sessions') return runtime.harness.list();
    if (post && route === '/v1/sessions/create') return runtime.harness.create(input.config);
    const session = /^\/v1\/sessions\/([a-zA-Z0-9-]+)(?:\/(start|stop|fork|compact))?$/.exec(route);
    if (session) {
      if (get && !session[2]) return runtime.harness.get(session[1]);
      if (post && session[2] === 'start') return runtime.harness.start(session[1], input.prompt, {config: input.config, interactive: true});
      if (post && session[2] === 'stop') return runtime.harness.cancel(session[1]);
      if (post && session[2] === 'fork') return runtime.harness.fork(session[1]);
      if (post && session[2] === 'compact') return {compaction: await runtime.harness.compactIdle(session[1])};
    }
    if (get && route === '/v1/approvals') return runtime.approvals.list();
    if (post && route === '/v1/approvals/resolve') return runtime.approvals.resolve(input.id, input.approved);
    if (post && route === '/v1/ide/connect') return {clientId: runtime.ide.connect()};
    if (post && route === '/v1/ide/heartbeat') return runtime.ide.heartbeat(input.clientId, input.state);
    if (post && route === '/v1/ide/reply') return runtime.ide.reply(input.clientId, input.id, input.result, input.error);
    if (post && route === '/v1/ide/disconnect') { runtime.ide.disconnect(input.clientId); return {disconnected: true}; }
    if (get && route === '/v1/terminals') return runtime.terminals.list();
    // These endpoints are explicit user interactions, not model-callable tools. The token is a host-execution capability.
    if (post && route === '/v1/terminals/open') return runtime.terminals.start({...input, owner: 'user'});
    const terminal = /^\/v1\/terminals\/([a-zA-Z0-9-]+)(?:\/(input|resize|signal|close))?$/.exec(route);
    if (terminal) {
      if (get && !terminal[2]) return runtime.terminals.read(terminal[1], Number(url.searchParams.get('cursor') ?? 0));
      if (post && terminal[2] === 'input') return runtime.terminals.input(terminal[1], input.text);
      if (post && terminal[2] === 'resize') return runtime.terminals.resize(terminal[1], input.cols, input.rows);
      if (post && terminal[2] === 'signal') return runtime.terminals.signal(terminal[1], input.signal);
      if (post && terminal[2] === 'close') { await runtime.terminals.close(terminal[1]); return {closed: true}; }
    }
    throw new AgentError('NOT_FOUND', 'Unknown bridge endpoint', {status: 404});
  }
  async mcp(request, response, signal) {
    const id = request.headers['mcp-session-id'];
    if (request.method === 'DELETE') { const session = this.legacy.get(id); if (!session) return this.reply(response, 404, {error: 'Session not found'}); session.server.close(); this.legacy.delete(id); return this.reply(response, 204); }
    if (request.method !== 'POST') { response.setHeader('Allow', 'POST, DELETE'); return this.reply(response, 405, {error: 'No server-initiated SSE stream is advertised; use POST'}); }
    const accept = String(request.headers.accept ?? '');
    if (!accept.includes('application/json') || !accept.includes('text/event-stream')) return this.reply(response, 406, {error: 'MCP requires Accept: application/json, text/event-stream'});
    let input; try { input = await this.body(request); } catch (error) { return this.reply(response, 400, {jsonrpc: '2.0', id: null, error: {code: -32700, message: error.message}}); }
    let server = this.modern;
    if (input.method === 'initialize' && !input.params?._meta?.['io.modelcontextprotocol/protocolVersion']) {
      for (const [key, entry] of this.legacy) if (Date.now() - entry.used > 1800000) { entry.server.close(); this.legacy.delete(key); }
      if (this.legacy.size >= 32) return this.reply(response, 429, {error: 'MCP session capacity reached'});
      const sessionId = randomUUID(); server = new McpServer(this.runtime, {owner: 'mcp-' + sessionId, context: {interactive: true}});
      this.legacy.set(sessionId, {server, used: Date.now()}); response.setHeader('MCP-Session-Id', sessionId);
    } else if (!input.params?._meta?.['io.modelcontextprotocol/protocolVersion']) {
      const session = this.legacy.get(id); if (!session) return this.reply(response, 404, {error: 'MCP session not found; initialize again'}); session.used = Date.now(); server = session.server;
    } else if (request.headers['mcp-protocol-version'] !== input.params._meta['io.modelcontextprotocol/protocolVersion']) {
      return this.reply(response, 400, {jsonrpc: '2.0', id: input.id ?? null, error: {code: -32602, message: 'Modern HTTP MCP requires a matching MCP-Protocol-Version header'}});
    }
    const result = await server.handle(input, {signal, protocolHeader: request.headers['mcp-protocol-version']});
    response.setHeader('MCP-Protocol-Version', server.legacy ?? McpServer.versions[0]);
    return this.reply(response, result === null ? 202 : result.error?.code === -32022 ? 400 : 200, result ?? undefined);
  }
  async listen(port = 0) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw Error('Invalid port');
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(port, '127.0.0.1', resolve); });
    this.port = this.server.address().port; return {url: `http://127.0.0.1:${this.port}`, token: this.token};
  }
  async close() {
    for (const controller of this.requests) controller.abort(); this.modern.close(); for (const session of this.legacy.values()) session.server.close();
    await this.runtime.close(); this.server.closeAllConnections(); await new Promise(resolve => this.server.close(resolve));
  }
}
