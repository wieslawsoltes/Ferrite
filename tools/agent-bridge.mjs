#!/usr/bin/env node
import {Arguments} from '../src/agent/cli/Arguments.js';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';
import {AgentBridgeServer} from '../src/agent/server/AgentBridgeServer.js';

let runtime, server;
try {
  const args = new Arguments(process.argv.slice(2), {values: ['workspace', 'state', 'port', 'origin'], flags: ['trust-workspace', 'help']});
  if (args.get('help')) console.log('node tools/agent-bridge.mjs --workspace /path/to/checkout --trust-workspace [--origin https://wieslawsoltes.github.io] [--port 8790] [--state /private/state]');
  else {
    if (!args.get('trust-workspace') || !args.get('workspace')) throw Error('Select --workspace and pass --trust-workspace. Native processes have your host permissions; this is NOT a sandbox.');
    runtime = await AgentRuntime.create({root: args.get('workspace'), state: args.get('state')});
    server = new AgentBridgeServer(runtime, {...(args.all('origin').length ? {origins: args.all('origin')} : {})});
    const connection = await server.listen(Number(args.get('port', 8790)));
    console.log(`Ferrite agent bridge: ${connection.url}\nBearer token (keep private): ${connection.token}\nWorkspace: ${runtime.workspace.root}\nOrigins: ${[...server.origins].join(', ')}\nOpen the Agent tool window in Ferrite and connect. API keys stay in bridge memory or environment.\nNative commands and PTYs are trusted host execution, not sandboxed.`);
    let closing = false;
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => { if (closing) return; closing = true; await server.close(); });
  }
} catch (error) { console.error(error.message); process.exitCode = 2; if (server) await server.close(); else await runtime?.close(); }
