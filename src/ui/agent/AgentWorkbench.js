import {Dom} from '../views/Dom.js';
import {SourceFile} from '../../project/SourceFile.js';
import {AgentClient} from './AgentClient.js';
import {WorkspaceSynchronizer} from './WorkspaceSynchronizer.js';
import {AgentView} from './AgentView.js';
import {TerminalView} from './TerminalView.js';

/** IDE composition: authenticated transport, revision-safe commands and user-driven account/session actions. */
export class AgentWorkbench {
  constructor(app) {
    this.app = app; this.client = new AgentClient(); this.cursor = 0; this.polling = false; this.lastHeartbeat = 0; this.lastSync = 0; this.selected = null; this.pendingCommands = new Set();
    const actions = {};
    for (const name of ['connect','disconnect','apiLogin','apiLogout','models','importWorkspace','loadSession','newSession','fork','exportSession','compact','run','resume','stop','approve','artifact']) actions[name] = (...args) => this.guard(() => this[name](...args));
    actions.callTool = (name, args) => this.client.request('/v1/tools/call', {name, arguments: args});
    actions.bridgeUrl = () => this.client.url ?? 'http://127.0.0.1:8790';
    this.view = new AgentView(app.panels.get('agent'), actions);
    this.sync = new WorkspaceSynchronizer(app.model, this.client, {onStatus: (message, error = false) => { this.view.workspaceStatus.textContent = message; this.view.workspaceStatus.classList.toggle('failed', error); }});
    this.terminal = new TerminalView(app.panels.get('terminal'), this.client, app.model, {onError: error => this.view.showError(error), onConnect: actions.connect});
    this.unsubscribe = app.model.subscribe(event => { if (['edit','files','replace'].includes(event.kind)) this.sync.changed(); });
    for (const root of [this.view.root, this.terminal.root]) root.addEventListener('keydown', event => event.stopPropagation());
    this.timer = setInterval(() => this.poll(), 250);
    window.addEventListener('pagehide', () => this.dispose(), {once: true});
  }
  async guard(operation) { this.view.showError(''); try { return await operation(); } catch (error) { this.view.showError(error); return null; } }
  dialog(title, fields, submit, {message = '', button = 'Connect'} = {}) {
    const dialog = Dom.element('dialog', 'agent-dialog'), form = Dom.element('form'), error = Dom.element('div', 'agent-error'), controls = Dom.element('div', 'agent-toolbar'), inputs = new Map();
    form.append(Dom.element('h2','',title),Dom.element('p','agent-note',message));
    for (const field of fields) { const label = Dom.element('label','agent-field'), input = Dom.element('input'); input.type = field.type ?? 'text'; input.value = field.value ?? ''; input.id = field.id; input.autocomplete = 'off'; input.spellcheck = false; input.required = field.required !== false; label.append(Dom.element('span','',field.label), input); form.append(label); inputs.set(field.id,input); }
    const cancel = Dom.button('Cancel', () => dialog.close()), apply = Dom.button(button); apply.type = 'submit'; apply.classList.add('agent-primary'); controls.append(cancel,apply); form.append(error,controls); dialog.append(form); document.body.append(dialog);
    return new Promise(resolve => {
      let completed = false;
      form.onsubmit = async event => { event.preventDefault(); if (!form.reportValidity()) return; apply.disabled = true; error.textContent = ''; try { const values = Object.fromEntries([...inputs].map(([id,node]) => [id,node.type === 'checkbox' ? node.checked : node.value])); await submit(values); completed = true; for (const node of inputs.values()) if (node.type === 'password') node.value = ''; dialog.close(); } catch (failure) { error.textContent = failure.message; } finally { apply.disabled = false; } };
      dialog.onclose = () => { for (const node of inputs.values()) node.value = ''; dialog.remove(); resolve(completed); };
      dialog.showModal(); inputs.values().next().value?.focus();
    });
  }
  async connect() {
    if (this.client.url) throw Error('Disconnect the current bridge before connecting a different workspace.');
    await this.dialog('Connect trusted agent bridge', [
      {id:'agent-bridge-url',label:'Local bridge URL',value:'http://127.0.0.1:8790'},
      {id:'agent-bridge-token',label:'Private bearer token printed by the bridge',type:'password'},
      {id:'agent-trust-host',label:'I trust this checkout and grant native execution on this host (not sandboxed)',type:'checkbox'}
    ], async values => {
      const capabilities = await this.client.connect(values['agent-bridge-url'],values['agent-bridge-token']);
      this.cursor = (await this.client.request('/v1/events?cursor=0')).cursor; this.lastHeartbeat = 0;
      this.view.connected(true,capabilities); this.view.workspaceStatus.textContent = capabilities.workspace + ' · native workspace; browser synchronization is off';
      await this.refreshSessions(); await this.refreshApprovals(); await this.terminal.reconnect(); await this.heartbeat();
    }, {message:'Start npm run agent:bridge -- --workspace /absolute/project --trust-workspace. Add --origin ' + location.origin + ' when serving Ferrite on this origin. Credentials stay in memory, not browser storage.'});
  }
  async disconnect() { this.sync.disconnect(); await this.client.disconnect(); this.selected = null; this.view.setSession(null); this.view.approvals.replaceChildren(); this.view.approvalCards.clear(); this.view.connected(false); this.view.prompt.disabled = false; this.view.workspaceStatus.textContent = 'Disconnected. Native sessions remain on the bridge for explicit reconnection.'; }
  async apiLogin() {
    if (!this.client.url) throw Error('Connect the local bridge first.');
    const provider = this.view.provider.value;
    await this.dialog('API sign in · ' + provider, [{id:'agent-api-key',label:'Provider API key',type:'password'}], async values => {
      await this.client.request('/v1/providers/connect',{provider,key:values['agent-api-key']}); await this.refreshProviders();
    }, {message:'API billing is separate from consumer chat subscriptions. The key is validated against the provider’s model API and retained only in bridge memory. Installed CLI account sign-in is available in the Terminal pane.',button:'Validate API key'});
  }
  async apiLogout() { await this.client.request('/v1/providers/disconnect',{provider:this.view.provider.value}); await this.refreshProviders(); }
  async refreshProviders() { this.view.providers = await this.client.request('/v1/providers'); this.view.showModels(); }
  async models() { const provider = this.view.provider.value; await this.client.request('/v1/providers/models',{provider}); await this.refreshProviders(); }
  async importWorkspace() {
    if (!this.client.url) throw Error('Connect the local bridge first.');
    if (!confirm('Replace the browser workspace with the bridge’s selected native checkout and enable bidirectional text synchronization? Export your browser project first to retain a separate copy. Divergent edits will stop synchronization.')) return;
    this.app.stop(false); this.app.editor.clearHistory(); await this.sync.import(); this.app.model.save();
  }
  async refreshSessions() { this.view.setSessions(await this.client.request('/v1/sessions')); }
  async refreshApprovals() { const approvals = await this.client.request('/v1/approvals'), ids = new Set(approvals.map(item => item.id)); for (const [id,card] of this.view.approvalCards) if (!ids.has(id)) { card.remove(); this.view.approvalCards.delete(id); } for (const item of approvals) this.view.approval(item); }
  async loadSession(id) { if (!id) return this.newSession(); const session = await this.client.request('/v1/sessions/' + encodeURIComponent(id)); this.selected = session.id; this.view.setSession(session); this.view.sessionSelect.value = session.id; }
  newSession() { this.selected = null; this.view.setSession(null); this.view.sessionSelect.value = ''; this.view.status('idle'); this.view.prompt.value = ''; }
  async fork() { if (!this.selected) throw Error('Select a session to fork.'); const session = await this.client.request('/v1/sessions/' + this.selected + '/fork',{}); await this.loadSession(session.id); await this.refreshSessions(); }
  async exportSession() { if (!this.selected) throw Error('Select a session to export.'); const session = await this.client.request('/v1/sessions/' + this.selected); this.app.download('ferrite-agent-' + session.id + '.json',JSON.stringify(session,null,2)); }
  async compact() { if (!this.selected) throw Error('Select a session to compact.'); await this.client.request('/v1/sessions/' + this.selected + '/compact',{}); await this.loadSession(this.selected); }
  async run(resume = false) {
    if (this.starting) return; this.starting = true;
    try {
      const prompt = this.view.prompt.value.trim(), config = this.view.config(); if (!resume && !prompt) throw Error('Enter a coding task.');
      await this.sync.sync();
      if (!this.selected) { const session = await this.client.request('/v1/sessions/create',{config}); this.selected = session.id; this.view.setSession(session); await this.refreshSessions(); }
      this.view.status('running');
      try { await this.client.request('/v1/sessions/' + this.selected + '/start',{...(resume ? {} : {prompt}),config}); this.view.prompt.value = ''; }
      catch (error) { this.view.status('idle'); throw error; }
    } finally { this.starting = false; }
  }
  resume() { return this.run(true); }
  async stop() { if (this.selected) await this.client.request('/v1/sessions/' + this.selected + '/stop',{}); }
  async approve(id, approved) { await this.client.request('/v1/approvals/resolve',{id,approved}); await this.refreshApprovals(); }
  async artifact(id) {
    const dialog = Dom.element('dialog','agent-dialog agent-artifact'), content = Dom.element('pre','agent-json'), status = Dom.element('div','agent-note'), controls = Dom.element('div','agent-toolbar'); let offset = 0;
    const show = async () => { try { const value = await this.client.request('/v1/tools/call',{name:'artifact_read',arguments:{id,offset,length:16000}}); content.textContent = value.text; status.textContent = `Characters ${offset}–${offset + value.text.length} / ${value.totalCharacters}`; previous.disabled = offset === 0; next.disabled = value.nextOffset === null; } catch (error) { status.textContent = error.message; } };
    const previous = Dom.button('Previous',()=>{offset = Math.max(0,offset-16000); show();}), next = Dom.button('Next',()=>{offset += 16000; show();}); controls.append(previous,next,Dom.button('Close',()=>dialog.close())); dialog.append(Dom.element('h2','','Tool artifact '+id),status,content,controls); document.body.append(dialog); dialog.onclose = ()=>dialog.remove(); dialog.showModal(); await show();
  }
  state() {
    const app = this.app, input = app.editor.textarea;
    return {revision:app.model.revision,active:app.model.active,tabs:app.model.tabs,selection:{start:input.selectionStart,end:input.selectionEnd},backend:app.backend,synchronized:this.sync.enabled&&!this.sync.conflicts.length,conflicts:this.sync.conflicts,buildRevision:app.buildRevision,stages:app.build?.stages.map(({name,kind})=>({name,kind}))??[],instance:app.inspector.instance,diagnostics:(app.build?.diagnostics??[]).slice(0,30),breakpoints:app.model.breakpointList,execution:app.lastExecutionEvent ? {type:app.lastExecutionEvent.type,state:app.lastExecutionEvent.state ? {...app.lastExecutionEvent.state,output:String(app.lastExecutionEvent.state.output??'').slice(-8000),trace:undefined} : undefined} : null,layout:app.dock.layout,panels:[...app.panels.keys()]};
  }
  async heartbeat() { const state = this.state(); if (JSON.stringify(state).length > 150000) { state.execution = {type:this.app.lastExecutionEvent?.type,truncated:true}; state.diagnostics = []; } await this.client.request('/v1/ide/heartbeat',{clientId:this.client.clientId,state}, {timeoutMs:5000}); this.lastHeartbeat = Date.now(); }
  async poll() {
    if (this.polling || !this.client.url || this.disposed) return; this.polling = true;
    try {
      if (Date.now() - this.lastHeartbeat > 4000) await this.heartbeat();
      const batch = await this.client.request('/v1/events?cursor=' + this.cursor,undefined,{timeoutMs:5000}); this.cursor = batch.cursor;
      if (batch.gap) { if (this.selected) await this.loadSession(this.selected); await this.refreshApprovals(); }
      let refresh = false;
      for (const event of batch.events) {
        if (event.type === 'ide.request' && event.clientId === this.client.clientId) { this.answer(event); continue; }
        if (!batch.gap) this.view.handle(event);
        if (event.type === 'terminal.started') this.terminal.attach(event);
        if (/^session\.(created|completed|failed|paused|cancelled)$/.test(event.type)) refresh = true;
        if (event.type === 'workspace.changed') this.lastSync = 0;
      }
      if (refresh) { await this.refreshSessions(); if (this.selected && batch.events.some(event=>event.sessionId===this.selected&&/^session\.(completed|failed|paused|cancelled)$/.test(event.type))) await this.loadSession(this.selected); }
      if (this.sync.enabled && Date.now() - this.lastSync > 2000) { this.lastSync = Date.now(); await this.sync.sync(); }
    } catch (error) { this.view.showError(error); if (error.code === 'IDE_OWNER' || error.status === 401) await this.disconnect(); }
    finally { this.polling = false; }
  }
  async answer(event) {
    if (this.pendingCommands.has(event.id)) return; this.pendingCommands.add(event.id);
    try { const result = await this.command(event.command,event.arguments); await this.client.request('/v1/ide/reply',{clientId:this.client.clientId,id:event.id,result}); }
    catch (error) { if (this.client.url) await this.client.request('/v1/ide/reply',{clientId:this.client.clientId,id:event.id,error:error.message}).catch(()=>{}); }
    finally { this.pendingCommands.delete(event.id); }
  }
  async command(command, args = {}) {
    const app = this.app;
    if (args.expectedRevision !== undefined && args.expectedRevision !== app.model.revision) throw Error('Stale IDE revision; inspect the current state before retrying.');
    if (!['editor.state','layout.reset'].includes(command) && !command.startsWith('panel.')) { if (!this.sync.enabled || this.sync.conflicts.length) throw Error('Explicitly import and synchronize this native checkout before source-dependent IDE commands.'); await this.sync.sync(); if (args.expectedRevision !== undefined && args.expectedRevision !== app.model.revision) throw Error('Source changed while synchronizing. Inspect the new revision.'); }
    if (command === 'editor.state') return this.state();
    if (command === 'editor.open' || command === 'editor.select') {
      const path = args.path ?? args.file ?? app.model.active, text = app.model.read(path); app.model.open(path);
      if (command === 'editor.select') { const start = args.start, end = args.end ?? start; if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length) throw Error('Selection uses valid zero-based UTF-16 start/end offsets.'); app.selection.select(new SourceFile(path,text).span(start,end),'agent',app.model.revision); }
    } else if (command.startsWith('panel.')) {
      if (!app.panels.has(args.id)) throw Error('Unknown panel ID.'); const action = command.slice(6); if (action === 'move') { if (!['left','right','bottom'].includes(args.side)) throw Error('Invalid docking side.'); app.dock.move(args.id,args.side); } else if (action === 'open' || action === 'float') app.dock[action](args.id); else throw Error('Unknown panel operation.');
    } else if (command === 'layout.reset') app.dock.reset();
    else if (command.startsWith('compiler.')) {
      const action = command.slice(9); if (action === 'stop') app.stop(); else { await app.compile(action); if (app.$('status').dataset.kind === 'error') throw Error(app.$('status').textContent); if (['run','test','debug'].includes(action) && app.backend !== 'native') { const deadline = Date.now() + 12000; while (app.execution.worker && Date.now() < deadline && (app.lastExecutionEvent?.generation !== app.execution.generation || !['paused','done','tests-done','error'].includes(app.lastExecutionEvent.type))) await new Promise(resolve=>setTimeout(resolve,25)); if (app.lastExecutionEvent?.type === 'error') throw Error(app.lastExecutionEvent.message); } }
    } else if (command === 'visualizer.stage' || command === 'visualizer.instance') {
      if (app.buildRevision !== app.model.revision) throw Error('Compiler visualizers are stale; check the current source first.');
      if (command === 'visualizer.stage') { if (!app.build.stages.some(stage=>stage.name===args.name)) throw Error('Unknown compiler stage.'); app.inspector.showStage(args.name); }
      else { if (!app.build.sem.instances.some(item=>item.key===args.key)) throw Error('Unknown generic instance.'); app.inspector.instance = args.key; app.inspector.render(); } app.dock.open('compiler');
    } else if (command === 'debug.breakpoints') {
      if (!Array.isArray(args.breakpoints)||args.breakpoints.length>1000) throw Error('Expected a breakpoint array (file and one-based line).');
      for (const {file,line} of args.breakpoints) if (!Object.hasOwn(app.model.files,file)||!Number.isSafeInteger(line)||line<1||line>app.model.files[file].split('\n').length) throw Error('Invalid breakpoint location.');
      app.model.breakpoints.clear(); for (const {file,line} of args.breakpoints) { const set = app.model.breakpoints.get(file)??new Set(); set.add(line); app.model.breakpoints.set(file,set); } app.model.emit('breakpoint');
    } else if (command.startsWith('debug.')) {
      if (!app.execution.worker) throw Error('Start an executable MIR debug session first.'); const before = app.executionEventSerial ?? 0; app.execution.command(command.slice(6),app.model.breakpointList); const deadline = Date.now()+4000; while ((app.executionEventSerial??0)===before&&app.execution.worker&&Date.now()<deadline) await new Promise(resolve=>setTimeout(resolve,20));
    } else if (command === 'search.query') { if (typeof args.query!=='string'||args.query.length>1024) throw Error('Search requires a query up to 1024 characters.'); app.dock.open('search'); app.search.query.value=args.query; app.search.currentFile.checked=args.currentFile===true; await app.search.find(); return {revision:app.model.revision,result:app.search.result}; }
    else throw Error('Unsupported IDE command.');
    await this.heartbeat(); return this.state();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.unsubscribe(); this.sync.disconnect(); this.terminal.dispose(); this.client.disconnect().catch(()=>{}); }
}
