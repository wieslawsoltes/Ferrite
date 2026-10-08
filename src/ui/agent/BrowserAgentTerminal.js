import {VirtualShell} from '../../agent/terminal/VirtualShell.js';

/** Human-facing CLI for the SAME browser harness. No native process and no API keys in command history. */
export class BrowserAgentTerminal {
  constructor(workbench, runtime) {
    this.workbench = workbench; this.runtime = runtime; this.sessionId = null;
    this.unsubscribe = runtime.events.subscribe(event => {
      if (event.sessionId !== this.sessionId) return;
      let text = '';
      if (event.type === 'model.delta') text = event.text;
      else if (event.type === 'message.assistant' && event.text) text = '\n' + event.text + '\n';
      else if (event.type === 'approval.requested') text = `\nApproval ${event.id}: ${event.tool} (${event.risk}). Use agent approve/deny ID or the approval card.\n`;
      else if (event.type === 'question.requested') text = `\nQuestion ${event.id}: ${event.question}\nUse agent answer ID "answer" or the question card.\n`;
      else if (['tool.started','tool.completed','tool.failed'].includes(event.type)) text = `\n[${event.type}] ${event.name}\n`;
      else if (/^session\.(completed|failed|cancelled|paused)$/.test(event.type)) text = `\n[${event.type}] ${event.error?.message ?? ''}\n`;
      if (text) this.write(text);
    });
  }
  write(text) { const terminal = this.workbench.terminal; terminal.sessions.get('browser').screen.write(text.replace(/\r?\n/g, '\r\n')); terminal.draw(); }
  async execute(command) {
    const shell = new VirtualShell(this.workbench.app.model), tokens = shell.tokenize(command);
    if (tokens[0]?.word !== 'agent') return this.workbench.request('/v1/browser-shell', {command});
    if (tokens.some(token => token.op)) throw Error('Agent control commands do not support pipes/redirection. Use a separate shell command.');
    const words = tokens.map(token => token.word).slice(1), action = words.shift() ?? 'help', w = this.workbench;
    const output = value => ({text: (typeof value === 'string' ? value : JSON.stringify(value,null,2)) + '\n', code: 0, cwd: w.terminal.shell.cwd});
    if (action === 'help') return output('Ferrite browser agent (same task state, tools and permissions as Coding Agent):\nagent login [openai|anthropic|gemini]\nagent models | sessions | status\nagent task "coding task"\nagent resume [SESSION_ID] | stop | compact | new | fork | export\nagent approvals | approve ID | deny ID\nagent questions | answer ID "text"\nKeys are entered only in the sign-in dialog, never as command arguments. Native CLI programs are not emulated.');
    if (action === 'login') { if (words[0]) { if (!['openai','anthropic','gemini'].includes(words[0]) || words.length !== 1) throw Error('Choose a supported provider; never put an API key in a terminal command.'); w.view.provider.value = words[0]; } await w.apiLogin(); return output('API sign-in dialog closed. Use the model selector or agent models before starting.'); }
    if (action === 'models') { await w.models(); return output(w.view.providers.find(provider=>provider.id===w.view.provider.value)?.models ?? []); }
    if (action === 'sessions') return output(await w.request('/v1/sessions'));
    if (action === 'status') return output(w.selected ? {id:w.selected,status:w.view.session?.status,usage:w.view.session?.usage,model:w.view.session?.config.model,environment:'browser'} : {environment:'browser',status:'no selected task'});
    if (action === 'new') { w.newSession(); this.sessionId=null; return output('New browser task selected.'); }
    if (action === 'stop') { await w.stop(); return output('Stop requested; pending approvals and model requests are cancelled.'); }
    if (action === 'compact') { await w.compact(); return output('Context compacted. Full transcript retained in browser task storage.'); }
    if (action === 'fork') { await w.fork(); this.sessionId=w.selected; return output('Forked session '+w.selected); }
    if (action === 'export') { await w.exportSession(); return output('Session export downloaded. Treat exported source and task text as sensitive.'); }
    if (action === 'approvals') return output(await w.request('/v1/approvals'));
    if (action === 'questions') return output(await w.request('/v1/questions'));
    if (action === 'approve' || action === 'deny') { if(words.length!==1)throw Error('Provide one pending approval ID'); await w.approve(words[0],action==='approve'); return output('Approval resolved.'); }
    if (action === 'answer') { if(words.length<2)throw Error('Provide a question ID and answer'); return output(await w.request('/v1/questions/answer',{id:words[0],answer:words.slice(1).join(' ')})); }
    if (action === 'task' || action === 'resume') {
      if(action==='task'){if(!words.length)throw Error('Provide a task after agent task');w.view.prompt.value=words.join(' ');}
      else if(words[0])await w.loadSession(words[0]);
      await w.run(action==='resume');this.sessionId=w.selected;
      return output(`Browser agent session ${w.selected ?? '(not started)'}. Progress streams here; use agent status/approvals/questions. The Coding Agent panel shows the complete trace.`);
    }
    throw Error('Unknown browser agent command. Use agent help. API keys are accepted only through the sign-in dialog.');
  }
  dispose() { this.unsubscribe(); }
}
