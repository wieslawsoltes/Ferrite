import {Dom} from '../views/Dom.js';
import {SourceFile} from '../../project/SourceFile.js';
import {AgentClient} from './AgentClient.js';
import {WorkspaceSynchronizer} from './WorkspaceSynchronizer.js';
import {AgentView} from './AgentView.js';
import {TerminalView} from './TerminalView.js';
import {BrowserRuntime, BrowserAgentClient} from '../../agent/browser/BrowserRuntime.js';
import {BrowserTaskState} from '../../agent/browser/BrowserTaskState.js';
import {BrowserAgentPanels} from './BrowserAgentPanels.js';
import {BrowserAgentTerminal} from './BrowserAgentTerminal.js';

/** IDE composition: authenticated transport, revision-safe commands and user-driven account/session actions. */
export class AgentWorkbench {
  constructor(app) {
    this.environment = 'none'; this.generation = 0; this.modeOperation = Promise.resolve(); this.browserClient = null;
    this.app = app; this.client = new AgentClient(); this.cursor = 0; this.polling = false; this.lastHeartbeat = 0; this.lastSync = 0; this.selected = null; this.pendingCommands = new Set();
    const actions = {};
    for (const name of ['useBrowser','connect','disconnect','apiLogin','apiLogout','models','importWorkspace','loadSession','newSession','fork','exportSession','compact','run','resume','stop','approve','artifact']) actions[name] = (...args) => this.guard(() => this[name](...args));
    actions.callTool = (name, args) => this.request('/v1/tools/call', {name, arguments: args});
    actions.bridgeUrl = () => this.client.url ?? 'http://127.0.0.1:8790';
    this.view = new AgentView(app.panels.get('agent'), actions);
    this.sync = new WorkspaceSynchronizer(app.model, this.client, {onStatus: (message, error = false) => { this.view.workspaceStatus.textContent = message; this.view.workspaceStatus.classList.toggle('failed', error); }});
    this.terminal = new TerminalView(app.panels.get('terminal'), this.client, app.model, {onError: error => { if (error.name !== 'AbortError') this.view.showError(error); }, onConnect: actions.connect});
    this.browserPanels = new BrowserAgentPanels(this);
    this.unsubscribe = app.model.subscribe(event => {
      if (['edit','files','replace'].includes(event.kind)) this.sync.changed();
      if (event.kind === 'replace' && this.environment === 'browser') { this.browserClient?.runtime.revoke(); void this.guard(() => this.useBrowser()); }
    });
    for (const root of [this.view.root, this.terminal.root]) root.addEventListener('keydown', event => event.stopPropagation());
    this.timer = setInterval(() => this.poll(), 250);
    window.addEventListener('pagehide', () => this.dispose(), {once: true});
    this.ready = this.guard(() => this.useBrowser());
  }
  async request(path, data, options) {
    const generation = this.generation, client = this.environment === 'browser' ? this.browserClient : this.environment === 'native' ? this.client : null;
    if (!client) throw Error('Enable browser mode or connect an optional native bridge first');
    const result = await client.request(path, data, options);
    if (generation !== this.generation || this.disposed) throw new DOMException('Agent environment changed', 'AbortError');
    return result;
  }
  useBrowser() {
    const generation = ++this.generation, previous = this.browserClient;
    previous?.runtime.revoke(); this.browserClient = null; this.environment = 'browser';
    this.sync.disconnect(); this.terminal.disconnect(); this.resetView();
    const nativeClosing = this.client.disconnect();
    const task = this.modeOperation.catch(() => {}).then(async () => {
      await previous?.disconnect(); await nativeClosing;
      if (generation !== this.generation || this.disposed) return;
      const runtime = await BrowserRuntime.create({model: this.app.model, inspect: () => this.state(), command: (name, args, signal) => this.command(name, args, {browser: true, signal}), beforeEdit: () => { if(this.app.backend === 'native') throw Error('Select a browser compiler backend before browser-agent edits; native auto-check is not authorized by browser mode.'); }});
      if (generation !== this.generation || this.disposed) { await runtime.close(); return; }
      this.browserClient = new BrowserAgentClient(runtime); this.browserTerminal = new BrowserAgentTerminal(this, runtime); this.terminal.executeBrowser = command => this.browserTerminal.execute(command); this.terminal.interruptBrowser = () => { void this.stop(); }; this.terminal.shell.cwd = ''; this.terminal.shell.history = []; this.tasks = new BrowserTaskState(runtime); this.cursor = 0;
      this.view.connected(true, runtime.capabilities()); this.view.status('Ready · browser');
      this.view.workspaceStatus.textContent = `Live browser project · ${runtime.store.persistent ? 'IndexedDB sessions' : 'memory-only sessions (storage or Web Locks unavailable)'} · no local bridge`;
      this.browserPanels.environmentChanged();
      await this.refreshSessions();
    });
    this.modeOperation = task; return task;
  }
  resetView() {
    this.selectionGeneration = (this.selectionGeneration ?? 0) + 1;
    this.browserTerminal?.dispose(); this.browserTerminal = null; this.terminal.executeBrowser = null; this.terminal.interruptBrowser = null; this.selected = null; this.view.setSession(null); this.view.approvals.replaceChildren(); this.view.approvalCards.clear();
    this.view.connected(false); this.view.prompt.disabled = false; this.browserPanels?.reset();
  }
  async guard(operation) { this.view.showError(''); try { return await operation(); } catch (error) { if (error.name !== 'AbortError') this.view.showError(error); return null; } }
  dialog(title, fields, submit, {message = '', button = 'Connect'} = {}) {
    const dialog = Dom.element('dialog', 'agent-dialog'), form = Dom.element('form'), error = Dom.element('div', 'agent-error'), controls = Dom.element('div', 'agent-toolbar'), inputs = new Map();
    form.append(Dom.element('h2','',title),Dom.element('p','agent-note',message));
    for (const field of fields) { const label = Dom.element('label','agent-field'), input = Dom.element('input'); input.type = field.type ?? 'text'; input.value = field.value ?? ''; input.id = field.id; input.autocomplete = 'off'; input.spellcheck = false; input.required = field.required !== false; label.append(Dom.element('span','',field.label), input); form.append(label); inputs.set(field.id,input); }
    const cancel = Dom.button('Cancel', () => dialog.close()), apply = Dom.button(button); apply.type = 'submit'; apply.classList.add('agent-primary'); controls.append(cancel,apply); form.append(error,controls); dialog.append(form); document.body.append(dialog);
    return new Promise(resolve => {
      let completed = false; const controller = new AbortController();
      form.onsubmit = async event => { event.preventDefault(); if (!form.reportValidity()) return; apply.disabled = true; error.textContent = ''; try { const values = Object.fromEntries([...inputs].map(([id,node]) => [id,node.type === 'checkbox' ? node.checked : node.value])); await submit(values, controller.signal); controller.signal.throwIfAborted(); completed = true; for (const node of inputs.values()) if (node.type === 'password') node.value = ''; dialog.close(); } catch (failure) { error.textContent = failure.message; } finally { apply.disabled = false; } };
      dialog.onclose = () => { controller.abort(new DOMException('Dialog closed', 'AbortError')); for (const node of inputs.values()) node.value = ''; dialog.remove(); resolve(completed); };
      dialog.showModal(); inputs.values().next().value?.focus();
    });
  }
  async connect() {
    if (this.client.url || this.client.connecting || this.connecting) throw Error('Disconnect the current bridge before connecting a different workspace.');
    await this.dialog('Connect trusted agent bridge', [
      {id:'agent-bridge-url',label:'Local bridge URL',value:'http://127.0.0.1:8790'},
      {id:'agent-bridge-token',label:'Private bearer token printed by the bridge',type:'password'},
      {id:'agent-trust-host',label:'I trust this checkout and grant native execution on this host (not sandboxed)',type:'checkbox'}
    ], async (values, signal) => {
      if (!values['agent-trust-host']) throw Error('Explicit host trust is required');
      this.connecting = true;
      try {
      await this.disconnect(); this.environment = 'native'; this.browserPanels.environmentChanged();
      const capabilities = await this.client.connect(values['agent-bridge-url'],values['agent-bridge-token'],{signal});
      this.cursor = (await this.request('/v1/events?cursor=0')).cursor; this.lastHeartbeat = 0;
      this.view.connected(true,capabilities); this.view.workspaceStatus.textContent = capabilities.workspace + ' · native workspace; browser synchronization is off';
      await this.refreshSessions(); await this.refreshApprovals(); await this.terminal.reconnect(); await this.heartbeat();
      signal.throwIfAborted();
      } catch (error) { await this.disconnect(); throw error; }
      finally { this.connecting = false; }
    }, {message:'Start npm run agent:bridge -- --workspace /absolute/project --trust-workspace. Add --origin ' + location.origin + ' when serving Ferrite on this origin. Credentials stay in memory, not browser storage.'});
  }
  async disconnect() {
    ++this.generation; const browser = this.browserClient; this.browserClient = null; browser?.runtime.revoke(); this.environment = 'none';
    this.sync.disconnect(); this.terminal.disconnect(); this.resetView(); this.tasks = null;
    this.view.workspaceStatus.textContent = 'Disconnected. Choose Use browser for bridge-free work, or Connect for optional native tools.';
    await Promise.all([this.client.disconnect(), browser?.disconnect(), this.modeOperation.catch(() => {})]);
  }
  async apiLogin() {
    if (this.environment === 'none' || this.environment === 'browser' && !this.browserClient) throw Error('Enable browser mode or connect a native bridge first.');
    const provider = this.view.provider.value, browser = this.environment === 'browser', generation = this.generation;
    const fields = [{id:'agent-api-key',label:'Your provider API key',type:'password'}];
    if (browser) fields.push({id:'agent-browser-key-consent',label:'I accept that page code/extensions can access this memory-only key and requests use my provider API billing',type:'checkbox'});
    await this.dialog('API sign in · ' + provider, fields, async (values, signal) => {
      if (generation !== this.generation) throw Error('Agent environment changed; open sign-in again');
      if (browser && !values['agent-browser-key-consent']) throw Error('Direct-browser key consent is required');
      await this.request('/v1/providers/connect',{provider,key:values['agent-api-key'],...(browser ? {browserConsent:true} : {})},{signal}); await this.refreshProviders();
    }, {message:browser ? 'No local bridge. Your own key is sent directly to the selected official provider over HTTPS and is never persisted. Only use a trusted browser/profile. Direct access depends on provider CORS and API entitlement. No public proxy or consumer-subscription fallback is used.' : 'The key is validated against the provider model API and retained only in bridge memory. API billing is separate from CLI account sign-in.',button:'Validate API key'});
  }
  async apiLogout() { await this.request('/v1/providers/disconnect',{provider:this.view.provider.value}); await this.refreshProviders(); }
  async refreshProviders() { this.view.providers = await this.request('/v1/providers'); this.view.showModels(); }
  async models() { const provider = this.view.provider.value; await this.request('/v1/providers/models',{provider}); await this.refreshProviders(); }
  async importWorkspace() {
    if (this.environment !== 'native' || !this.client.url) throw Error('Browser mode already uses the live editor project. Connect native mode only to import a host checkout.');
    if (!confirm('Replace the browser workspace with the bridge’s selected native checkout and enable bidirectional text synchronization? Export your browser project first to retain a separate copy. Divergent edits will stop synchronization.')) return;
    this.app.stop(false); this.app.editor.clearHistory(); await this.sync.import(); this.app.model.save();
  }
  async refreshSessions() { this.view.setSessions(await this.request('/v1/sessions')); }
  async refreshApprovals() { const approvals = await this.request('/v1/approvals'), ids = new Set(approvals.map(item => item.id)); for (const [id,card] of this.view.approvalCards) if (!ids.has(id)) { card.remove(); this.view.approvalCards.delete(id); } for (const item of approvals) this.view.approval(item); }
  async loadSession(id) { if (!id) return this.newSession(); const selection = this.selectionGeneration = (this.selectionGeneration ?? 0) + 1; const session = await this.request('/v1/sessions/' + encodeURIComponent(id)); if(selection !== this.selectionGeneration) return; this.selected = session.id; this.view.setSession(session); this.view.sessionSelect.value = session.id; this.browserPanels.sessionChanged(session); }
  newSession() { this.selectionGeneration = (this.selectionGeneration ?? 0) + 1; this.selected = null; this.view.setSession(null); this.view.sessionSelect.value = ''; this.view.status('idle'); this.view.prompt.value = ''; this.browserPanels.sessionChanged(null); }
  async fork() {
    if (!this.selected) throw Error('Select a session to fork.');
    const id = this.selected, selection = this.selectionGeneration;
    const session = await this.request('/v1/sessions/' + id + '/fork',{});
    if (selection === this.selectionGeneration && this.selected === id) await this.loadSession(session.id);
    await this.refreshSessions();
  }
  async exportSession() { if (!this.selected) throw Error('Select a session to export.'); const session = await this.request('/v1/sessions/' + this.selected); this.app.download('ferrite-agent-' + session.id + '.json',JSON.stringify(session,null,2)); }
  async compact() {
    if (!this.selected) throw Error('Select a session to compact.');
    const id = this.selected, selection = this.selectionGeneration;
    await this.request('/v1/sessions/' + id + '/compact',{});
    if (selection === this.selectionGeneration && this.selected === id) await this.loadSession(id);
  }
  async run(resume = false) {
    if (this.starting) return; this.starting = true;
    const generation = this.generation, selection = this.selectionGeneration, browser = this.environment === 'browser';
    let id = this.selected;
    const current = () => generation === this.generation && selection === this.selectionGeneration && id === this.selected && !this.disposed;
    const assertCurrent = () => { if (!current()) throw new DOMException('The selected agent task changed; no new task was started', 'AbortError'); };
    try {
      const composer = this.view.prompt.value, prompt = composer.trim(), config = {...this.view.config(), ...(browser ? this.browserPanels.config() : {})};
      if (!resume && !prompt) throw Error('Enter a coding task.');
      if (this.environment === 'native') { await this.sync.sync(); assertCurrent(); }
      if (!id) {
        const session = await this.request('/v1/sessions/create',{config}); assertCurrent();
        this.selected = id = session.id; this.view.setSession(session); this.browserPanels.sessionChanged(session);
        await this.refreshSessions(); assertCurrent();
      }
      if (browser && config.mode === 'trusted' && !confirm('Allow all enabled browser project tools for this run? This includes edits and bounded compiler/shell execution, NOT host filesystem, native processes or unrestricted network.')) return;
      if (browser) { await this.tasks.begin(id); assertCurrent(); this.browserPanels.sessionChanged(this.view.session); }
      assertCurrent(); this.view.status('running');
      try {
        await this.request('/v1/sessions/' + id + '/start',{...(resume ? {} : {prompt}),config,...(browser ? {fullAccessConfirmed: config.mode === 'trusted'} : {})});
        // Preserve a follow-up typed while the start request was in flight.
        if (current() && this.view.prompt.value === composer) this.view.prompt.value = '';
      } catch (error) { if (current()) this.view.status('idle'); throw error; }
    } finally { this.starting = false; }
  }
  resume() { return this.run(true); }
  async stop() { if (this.selected) await this.request('/v1/sessions/' + this.selected + '/stop',{}); }
  async approve(id, approved) { await this.request('/v1/approvals/resolve',{id,approved}); await this.refreshApprovals(); }
  async artifact(id) {
    const dialog = Dom.element('dialog','agent-dialog agent-artifact'), content = Dom.element('pre','agent-json'), status = Dom.element('div','agent-note'), controls = Dom.element('div','agent-toolbar'); let offset = 0;
    const show = async () => { try { const value = await this.request('/v1/tools/call',{name:'artifact_read',arguments:{id,offset,length:16000}}); content.textContent = value.text; status.textContent = `Characters ${offset}–${offset + value.text.length} / ${value.totalCharacters}`; previous.disabled = offset === 0; next.disabled = value.nextOffset === null; } catch (error) { status.textContent = error.message; } };
    const previous = Dom.button('Previous',()=>{offset = Math.max(0,offset-16000); show();}), next = Dom.button('Next',()=>{offset += 16000; show();}); controls.append(previous,next,Dom.button('Close',()=>dialog.close())); dialog.append(Dom.element('h2','','Tool artifact '+id),status,content,controls); document.body.append(dialog); dialog.onclose = ()=>dialog.remove(); dialog.showModal(); await show();
  }
  state() {
    const app = this.app, input = app.editor.textarea;
    return {revision:app.model.revision,active:app.model.active,tabs:app.model.tabs,selection:{start:input.selectionStart,end:input.selectionEnd},backend:app.backend,synchronized:this.sync.enabled&&!this.sync.conflicts.length,conflicts:this.sync.conflicts,buildRevision:app.buildRevision,stages:app.build?.stages.map(({name,kind})=>({name,kind}))??[],instance:app.inspector.instance,diagnostics:(app.build?.diagnostics??[]).slice(0,30),breakpoints:app.model.breakpointList,execution:app.lastExecutionEvent ? {type:app.lastExecutionEvent.type,state:app.lastExecutionEvent.state ? {...app.lastExecutionEvent.state,output:String(app.lastExecutionEvent.state.output??'').slice(-8000),trace:undefined} : undefined} : null,layout:app.dock.layout,panels:[...app.panels.keys()]};
  }
  async heartbeat() { if (this.environment !== 'native') return; const state = this.state(); if (JSON.stringify(state).length > 150000) { state.execution = {type:this.app.lastExecutionEvent?.type,truncated:true}; state.diagnostics = []; } await this.request('/v1/ide/heartbeat',{clientId:this.client.clientId,state}, {timeoutMs:5000}); this.lastHeartbeat = Date.now(); }
  async poll() {
    if (this.polling || this.connecting || !(this.environment === 'browser' ? this.browserClient : this.client.connected) || this.disposed) return; this.polling = true; const epoch = this.generation;
    try {
      if (Date.now() - this.lastHeartbeat > 4000) await this.heartbeat();
      const batch = await this.request('/v1/events?cursor=' + this.cursor,undefined,{timeoutMs:5000}); this.cursor = batch.cursor;
      if (batch.gap) { if (this.selected) await this.loadSession(this.selected); await this.refreshApprovals(); if (this.browserClient) await this.browserPanels.refreshQuestions(); }
      let refresh = false;
      for (const event of batch.events) {
        if (event.type === 'ide.request' && event.clientId === this.client.clientId) { this.answer(event); continue; }
        if (!batch.gap) { this.view.handle(event); this.browserPanels.handle(event); }
        if (event.type === 'terminal.started') this.terminal.attach(event);
        if (/^session\.(created|completed|failed|paused|cancelled)$/.test(event.type)) refresh = true;
        if (event.type === 'workspace.changed') this.lastSync = 0;
      }
      if (refresh) { await this.refreshSessions(); if (this.selected && batch.events.some(event=>event.sessionId===this.selected&&/^session\.(completed|failed|paused|cancelled)$/.test(event.type))) await this.loadSession(this.selected); }
      if (this.environment === 'native' && this.sync.enabled && Date.now() - this.lastSync > 2000) { this.lastSync = Date.now(); await this.sync.sync(); }
    } catch (error) { if (epoch !== this.generation) return; this.view.showError(error); if (error.code === 'IDE_OWNER' || error.status === 401) await this.disconnect(); }
    finally { this.polling = false; }
  }
  async answer(event) {
    if (this.pendingCommands.has(event.id)) return; this.pendingCommands.add(event.id);
    try { const result = await this.command(event.command,event.arguments); await this.request('/v1/ide/reply',{clientId:this.client.clientId,id:event.id,result}); }
    catch (error) { if (this.client.url) await this.request('/v1/ide/reply',{clientId:this.client.clientId,id:event.id,error:error.message}).catch(()=>{}); }
    finally { this.pendingCommands.delete(event.id); }
  }
  async command(command, args = {}, {browser = false, signal} = {}) {
    const app = this.app, epoch = this.client.epoch, generation = this.sync.generation;
    signal?.throwIfAborted();
    if (browser && app.backend === 'native' && /^(compiler\.|debug\.)/.test(command)) throw Error('Select a browser compiler backend before browser-agent execution. Native mode is never invoked automatically.');
    if (args.expectedRevision !== undefined && args.expectedRevision !== app.model.revision) throw Error('Stale IDE revision; inspect the current state before retrying.');
    if (!browser && !['editor.state','layout.reset'].includes(command) && !command.startsWith('panel.')) { if (!this.sync.enabled || this.sync.conflicts.length) throw Error('Explicitly import and synchronize this native checkout before source-dependent IDE commands.'); await this.sync.sync(); if (epoch !== this.client.epoch || generation !== this.sync.generation || !this.sync.enabled) throw Error('Workspace context changed during the IDE command. Inspect and synchronize again.'); if (args.expectedRevision !== undefined && args.expectedRevision !== app.model.revision) throw Error('Source changed while synchronizing. Inspect the new revision.'); }
    if (command === 'editor.state') return this.state();
    if (command === 'editor.open' || command === 'editor.select') {
      const path = args.path ?? args.file ?? app.model.active, text = app.model.read(path); app.model.open(path);
      if (command === 'editor.select') { const start = args.start, end = args.end ?? start; if (!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>text.length) throw Error('Selection uses valid zero-based UTF-16 start/end offsets.'); app.selection.select(new SourceFile(path,text).span(start,end),'agent',app.model.revision); }
    } else if (command.startsWith('panel.')) {
      if (!app.panels.has(args.id)) throw Error('Unknown panel ID.'); const action = command.slice(6); if (action === 'move') { if (!['left','right','bottom'].includes(args.side)) throw Error('Invalid docking side.'); app.dock.move(args.id,args.side); } else if (action === 'open' || action === 'float') app.dock[action](args.id); else throw Error('Unknown panel operation.');
    } else if (command === 'layout.reset') app.dock.reset();
    else if (command.startsWith('compiler.')) {
      const action = command.slice(9); if (action === 'stop') app.stop(); else { await app.compile(action); if (app.$('status').dataset.kind === 'error') throw Error(app.$('status').textContent); if (['run','test','debug'].includes(action) && app.backend !== 'native') { const deadline = Date.now() + 12000; while (app.execution.worker && Date.now() < deadline && (app.lastExecutionEvent?.generation !== app.execution.generation || !['paused','done','tests-done','error'].includes(app.lastExecutionEvent.type))) { signal?.throwIfAborted(); await new Promise(resolve=>setTimeout(resolve,25)); } if (app.lastExecutionEvent?.type === 'error') throw Error(app.lastExecutionEvent.message); } }
    } else if (command === 'visualizer.stage' || command === 'visualizer.instance') {
      if (app.buildRevision !== app.model.revision) throw Error('Compiler visualizers are stale; check the current source first.');
      if (command === 'visualizer.stage') { if (!app.build.stages.some(stage=>stage.name===args.name)) throw Error('Unknown compiler stage.'); app.inspector.showStage(args.name); }
      else { if (!app.build.sem.instances.some(item=>item.key===args.key)) throw Error('Unknown generic instance.'); app.inspector.instance = args.key; app.inspector.render(); } app.dock.open('compiler');
    } else if (command === 'debug.breakpoints') {
      if (!Array.isArray(args.breakpoints)||args.breakpoints.length>1000) throw Error('Expected a breakpoint array (file and one-based line).');
      for (const {file,line} of args.breakpoints) if (!Object.hasOwn(app.model.files,file)||!Number.isSafeInteger(line)||line<1||line>app.model.files[file].split('\n').length) throw Error('Invalid breakpoint location.');
      app.model.breakpoints.clear(); for (const {file,line} of args.breakpoints) { const set = app.model.breakpoints.get(file)??new Set(); set.add(line); app.model.breakpoints.set(file,set); } app.model.emit('breakpoint');
    } else if (command.startsWith('debug.')) {
      if (!app.execution.worker) throw Error('Start an executable MIR debug session first.'); const before = app.executionEventSerial ?? 0; app.execution.command(command.slice(6),app.model.breakpointList); const deadline = Date.now()+4000; while ((app.executionEventSerial??0)===before&&app.execution.worker&&Date.now()<deadline) { signal?.throwIfAborted(); await new Promise(resolve=>setTimeout(resolve,20)); }
    } else if (command === 'search.query') { if (typeof args.query!=='string'||args.query.length>1024) throw Error('Search requires a query up to 1024 characters.'); app.dock.open('search'); app.search.query.value=args.query; app.search.currentFile.checked=args.currentFile===true; await app.search.find(); return {revision:app.model.revision,result:app.search.result}; }
    else throw Error('Unsupported IDE command.');
    signal?.throwIfAborted(); await this.heartbeat(); return this.state();
  }
  dispose() { this.disposed = true; clearInterval(this.timer); this.unsubscribe(); this.sync.dispose(); this.terminal.dispose(); this.browserTerminal?.dispose(); this.browserClient?.runtime.revoke(); this.browserClient?.disconnect().catch(()=>{}); this.client.disconnect().catch(()=>{}); }
}
