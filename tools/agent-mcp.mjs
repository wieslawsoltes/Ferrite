#!/usr/bin/env node
import {Arguments} from '../src/agent/cli/Arguments.js';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
import {McpServer} from '../src/agent/mcp/McpServer.js';
import {StdioTransport} from '../src/agent/mcp/StdioTransport.js';

let runtime, server;
try {
  const args = new Arguments(process.argv.slice(2), {values: ['workspace', 'state', 'bridge'], flags: ['trust-workspace', 'allow-writes', 'allow-exec', 'help']});
  if (args.get('help')) console.error('Standalone: node tools/agent-mcp.mjs --workspace /checkout --trust-workspace [--allow-writes] [--allow-exec]\nConnected IDE: FERRITE_AGENT_TOKEN=... node tools/agent-mcp.mjs --bridge http://127.0.0.1:8790');
  else if (args.get('bridge')) {
    const url = new URL(args.get('bridge'));
    if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw Error('MCP forwarding supports only an explicit local HTTP bridge');
    const token = process.env.FERRITE_AGENT_TOKEN; if (!token) throw Error('Set FERRITE_AGENT_TOKEN in the MCP client environment; do not put it in command arguments');
    let sessionId;
    const transport = new StdioTransport(async message => {
      const version = message.params?._meta?.['io.modelcontextprotocol/protocolVersion'];
      const response = await fetch(new URL('/mcp', url), {method: 'POST', redirect: 'error', headers: {Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...(sessionId ? {'MCP-Session-Id': sessionId} : {}), ...(version ? {'MCP-Protocol-Version': version} : {})}, body: JSON.stringify(message), signal: AbortSignal.timeout(660000)});
      sessionId = response.headers.get('mcp-session-id') ?? sessionId;
      if (response.status === 202 || response.status === 204) return null;
      const text = await response.text(); if (text.length > 24 * 1024 * 1024) throw Error('MCP response exceeds limit');
      const result = JSON.parse(text); if (!result.jsonrpc) throw Error(`Bridge HTTP ${response.status}: ${result.error?.message ?? result.error ?? 'request failed'}`); return result;
    });
    await transport.run();
  } else {
    if (!args.get('trust-workspace') || !args.get('workspace')) throw Error('Select --workspace and pass --trust-workspace. Without --allow-writes/--allow-exec, mutating tools remain denied.');
    runtime = await AgentRuntime.create({root: args.get('workspace'), state: args.get('state')});
    const allow = new Set([...(args.get('allow-writes') ? ['edit'] : []), ...(args.get('allow-exec') ? ['execute'] : [])]);
    server = new McpServer(runtime, {context: {interactive: false, allow}});
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { server.close(); process.stdin.destroy(); });
    await new StdioTransport(message => server.handle(message)).run();
  }
} catch (error) { console.error('Ferrite MCP: ' + error.message); process.exitCode = 1; }
finally { server?.close(); await runtime?.close(); }
