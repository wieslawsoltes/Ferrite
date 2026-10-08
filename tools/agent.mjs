#!/usr/bin/env node
import {createInterface} from 'node:readline/promises';
import {Arguments} from '../src/agent/cli/Arguments.js';
import {AgentRuntime} from '../src/agent/server/AgentRuntime.js';

let runtime, readline;
try {
  const args = new Arguments(process.argv.slice(2), {values: ['workspace', 'state', 'provider', 'model', 'resume', 'mode', 'context', 'output', 'steps'], flags: ['trust-workspace', 'models', 'sessions', 'help']});
  if (args.get('help')) console.log('node tools/agent.mjs --workspace /checkout --trust-workspace --provider openai --model MODEL "Task"\nOptions: --resume ID, --mode ask|auto-edit|read-only|trusted, --models, --sessions, --context 32768, --output 4096, --steps 40.\nAPI keys: OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY. Interactive approvals use the terminal.');
  else {
    if (!args.get('trust-workspace') || !args.get('workspace')) throw Error('Select --workspace and explicitly pass --trust-workspace (native host execution, not a sandbox)');
    runtime = await AgentRuntime.create({root: args.get('workspace'), state: args.get('state')});
    if (args.get('models')) console.log(JSON.stringify(await runtime.providers.models(args.get('provider', 'openai')), null, 2));
    else if (args.get('sessions')) console.log(JSON.stringify(await runtime.harness.list(), null, 2));
    else {
      const session = args.get('resume') ? await runtime.harness.get(args.get('resume')) : await runtime.harness.create({provider: args.get('provider', 'openai'), model: args.get('model', ''), mode: args.get('mode', 'ask'), contextTokens: Number(args.get('context', 32768)), outputTokens: Number(args.get('output', 4096)), maxSteps: Number(args.get('steps', 40))});
      if (process.stdin.isTTY) readline = createInterface({input: process.stdin, output: process.stderr});
      let approvalQueue = Promise.resolve();
      runtime.events.subscribe(event => {
        if (event.type === 'approval.requested' && event.sessionId === session.id) {
          approvalQueue = approvalQueue.then(async () => {
            console.error(`\nApproval: ${event.tool} [${event.risk}]\n${JSON.stringify(event.arguments, null, 2).slice(0, 16000)}`);
            if (event.preview) console.error(JSON.stringify(event.preview, null, 2).slice(0, 16000));
            const answer = readline ? await readline.question('Allow this one operation? [y/N] ') : 'n';
            try { runtime.approvals.resolve(event.id, /^y(?:es)?$/i.test(answer.trim())); } catch {}
          }).catch(() => {});
        }
        if (event.sessionId !== session.id) return;
        if (event.type === 'model.delta') process.stdout.write(event.text);
        if (event.type === 'tool.started') console.error(`\n→ ${event.name} ${JSON.stringify(event.arguments).slice(0, 300)}`);
        if (event.type === 'tool.failed' || event.type === 'session.failed') console.error('\n' + JSON.stringify(event.error));
        if (event.type === 'context.compacted') console.error(`\nContext compacted: ~${event.beforeEstimatedTokens} → ~${event.afterEstimatedTokens} tokens (${event.method})`);
        if (event.type === 'model.retry') console.error(`\nProvider retry ${event.attempt}; partial display is discarded in saved history.`);
      });
      process.on('SIGINT', () => { runtime.harness.cancel(session.id).catch(() => {}); readline?.close(); });
      console.error(`Session ${session.id} · ${session.config.provider}/${session.config.model} · ${session.config.mode}`);
      let prompt = args.positionals.join(' ') || (args.get('resume') ? undefined : readline ? await readline.question('Task: ') : '');
      do {
        await runtime.harness.start(session.id, prompt, {interactive: !!readline}); await runtime.harness.wait(session.id);
        console.error(`\n${session.status} · input ${session.usage.input} · output ${session.usage.output} · resume ${session.id}`);
        if (!readline || session.status === 'cancelled') break;
        prompt = await readline.question('\nNext task (/exit to finish): '); if (prompt.trim() === '/exit' || !prompt.trim()) break;
      } while (true);
      if (session.status === 'failed') process.exitCode = 1;
    }
  }
} catch (error) { console.error(error.message); process.exitCode = 1; }
finally { readline?.close(); await runtime?.close(); }
