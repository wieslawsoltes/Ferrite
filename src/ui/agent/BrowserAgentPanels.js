import {Dom} from '../views/Dom.js';
import {BrowserTaskState} from '../../agent/browser/BrowserTaskState.js';

/** VB6-style local changes, explicit follow-ups, questions and per-tool permission controls. */
export class BrowserAgentPanels {
  constructor(workbench) {
    this.workbench = workbench; this.view = workbench.view; this.rules = {}; this.questions = new Map(); this.renderGeneration = 0;
    const guarded = fn => (...args) => workbench.guard(() => fn(...args));
    for (const [id, title] of [['changes','Changes'], ['followups','Follow-ups'], ['permissions','Permissions']]) {
      const button = Dom.button(title, () => { this.view.tab(id); if (id === 'changes') void guarded(() => this.review())(); if (id === 'followups') void guarded(() => this.renderQueue())(); });
      button.dataset.agentTab = id; this.view.tabs.append(button); this.view.tabButtons.set(id, button);
      const body = Dom.element('div', 'agent-tab-content'); body.hidden = true; body.dataset.agentContent = id;
      this.view.views.set(id, body); this.view.root.insertBefore(body, this.view.error);
    }
    const changes = this.view.views.get('changes'), bar = Dom.element('div', 'agent-toolbar');
    this.scope = this.view.select('Change review scope', [['task','Entire task'], ['run','Last run']]);
    bar.append(this.scope, Dom.button('Refresh changes', guarded(() => this.review())), Dom.button('Export patch', guarded(async () => {
      const {tasks, id} = this.current(); const comparison = await tasks.compare(id, this.scope.value); this.current(tasks);
      workbench.app.download('ferrite-browser-changes.patch', BrowserTaskState.patch(comparison));
    })));
    this.changes = Dom.element('div', 'agent-changes'); changes.append(bar, Dom.element('p', 'agent-note', 'Local project comparison includes manual edits since the selected checkpoint. This is not Git staging or exclusive agent attribution. Restores require exact current hashes and an idle agent.'), this.changes);
    const followups = this.view.views.get('followups'); this.queuedInput = Dom.element('textarea'); this.queuedInput.rows = 3; this.queuedInput.maxLength = 100000; this.queuedInput.setAttribute('aria-label', 'Queued follow-up');
    const queuebar = Dom.element('div','agent-toolbar'); queuebar.append(Dom.button('Queue message', guarded(() => this.addQueued())), Dom.button('Queue composer', guarded(() => this.addQueued(this.view.prompt.value))), Dom.button('Stop and prepare follow-up', guarded(async () => {
      if (!this.workbench.selected) throw Error('Select a browser task first'); await workbench.stop();
      this.view.prompt.value = this.queuedInput.value; this.view.tab('chat'); this.view.showError('Stopped. Review permissions and press Run task explicitly to send the prepared follow-up.');
    })));
    this.queueList = Dom.element('div','agent-followups'); followups.append(Dom.element('p','agent-note','Messages stay in this project/session. Loading a queued message only copies it to the composer; you must explicitly press Run task. No automatic sending or permission inheritance.'),this.queuedInput,queuebar,this.queueList);
    this.permissions = this.view.views.get('permissions'); this.lease = this.view.number('Browser permission lease (minutes)',10,1,60);
    this.ruleList = Dom.element('div','agent-permission-rules'); this.permissions.append(Dom.element('p','agent-note','Per-tool rules apply to the next browser run. Read-only always forbids edits/execution. A denied operation stops that run. Full access must be confirmed for each run; leases expire and are never extended by the model.'),this.lease.label,this.ruleList);
    this.questionList = Dom.element('div','agent-questions'); this.view.views.get('chat').insertBefore(this.questionList,this.view.chat);
  }
  current(expected) {
    const {environment, tasks, selected: id} = this.workbench;
    if (environment !== 'browser' || !tasks || !id) throw Error('Select a browser agent session first. These panels do not operate on native sessions.');
    if (expected && expected !== tasks) throw new DOMException('Browser project changed', 'AbortError');
    return {tasks, id};
  }
  config() { return {toolRules: {...this.rules}, permissionMinutes: Number(this.lease.input.value)}; }
  reset() { ++this.renderGeneration; this.changes.replaceChildren(); this.queueList.replaceChildren(); this.questionList.replaceChildren(); this.questions.clear(); this.rules = {}; this.lease.input.value = 10; }
  environmentChanged() {
    this.ruleList.replaceChildren(); this.rules = {}; this.lease.input.value = 10;
    const browser = this.workbench.environment === 'browser';
    for (const id of ['changes','followups','permissions']) this.view.tabButtons.get(id).hidden = !browser;
    if (!browser && ['changes','followups','permissions'].some(id => !this.view.views.get(id).hidden)) this.view.tab('chat');
    if (!browser) return;
    for (const tool of this.view.tools) {
      const row = Dom.element('label','agent-rule'), select = this.view.select('Permission for ' + tool.name,[['default','Use mode'],['ask','Ask every call'],['allow','Allow within mode'],['deny','Deny']]);
      select.dataset.permissionTool = tool.name; select.onchange = () => { if (select.value === 'default') delete this.rules[tool.name]; else this.rules[tool.name] = select.value; };
      row.append(Dom.element('span','',tool.name),select); this.ruleList.append(row);
    }
  }
  sessionChanged(session) {
    ++this.renderGeneration; this.changes.replaceChildren(); this.queueList.replaceChildren();
    this.rules = {...session?.config.toolRules}; this.lease.input.value = session?.config.permissionMinutes ?? 10;
    for (const input of this.ruleList.querySelectorAll('select')) input.value = this.rules[input.dataset.permissionTool] ?? 'default';
  }
  async review() {
    const generation = ++this.renderGeneration, {tasks, id} = this.current();
    let comparison;
    try { comparison = await tasks.compare(id, this.scope.value); } catch (error) { if (error.status === 404) { this.changes.textContent = 'Run this browser task before reviewing its changes.'; return; } throw error; }
    if (generation !== this.renderGeneration || this.workbench.selected !== id) return; this.current(tasks); this.changes.replaceChildren();
    if (!comparison.changes.length) { this.changes.textContent = 'No source changes since this checkpoint.'; return; }
    for (const change of comparison.changes) {
      const card = Dom.element('details','agent-change'); card.open = true;
      const count = change.diff ? ` · +${change.diff.added} −${change.diff.removed}` : ' · large file';
      card.append(Dom.element('summary','',`${change.path} · ${change.status}${count}`));
      const controls = Dom.element('div','agent-toolbar');
      const restore = index => this.workbench.guard(async () => {
        this.current(tasks); if (this.workbench.selected !== id) throw Error('Review session changed');
        if (!confirm('Restore this reviewed source change? Newer edits are protected by content hashes.')) return;
        await tasks.restore(change, index); await this.review();
      });
      controls.append(Dom.button('Restore file', () => restore()));
      if (change.before !== null && change.after !== null && change.diff) for (const hunk of change.diff.hunks.slice(0,50)) controls.append(Dom.button('Restore hunk ' + (hunk.index+1), () => restore(hunk.index)));
      card.append(controls);
      const pre = Dom.element('pre','agent-review-diff');
      if (!change.diff) pre.textContent = 'Large comparison: use Export patch for complete source. File restoration still checks the exact after hash.';
      else {
        for (const row of change.diff.rows.slice(0,2000)) { const line = Dom.element('span',row.kind==='+'?'agent-added':row.kind==='-'?'agent-removed':'',`${row.oldLine??' '} ${row.newLine??' '} ${row.kind} ${row.text}`); pre.append(line); }
        if (change.diff.rows.length > 2000) pre.append(document.createTextNode('\n[Preview capped at 2000 lines; export the full patch.]'));
      }
      card.append(pre); this.changes.append(card);
    }
  }
  async addQueued(value = this.queuedInput.value) { const {tasks,id} = this.current(); await tasks.add(id,value); this.current(tasks); this.queuedInput.value=''; await this.renderQueue(); }
  async renderQueue() {
    const generation = ++this.renderGeneration, {tasks,id} = this.current(), items = await tasks.items(id);
    if (generation !== this.renderGeneration || this.workbench.selected !== id) return; this.current(tasks); this.queueList.replaceChildren();
    for (const item of items) {
      const row = Dom.element('section','agent-followup'), input = Dom.element('textarea'); input.value = item.text; input.maxLength=100000; input.setAttribute('aria-label','Edit queued message');
      const bar = Dom.element('div','agent-toolbar'), act = action => this.workbench.guard(async () => { this.current(tasks); await tasks.change(id,item.id,item.version,action,input.value); await this.renderQueue(); });
      bar.append(Dom.button('Load into composer',()=>this.workbench.guard(async()=>{
        this.current(tasks); if (this.workbench.selected !== id) throw Error('Task changed; refresh the queue');
        const latest=(await tasks.items(id)).find(value=>value.id===item.id); this.current(tasks);
        if (this.workbench.selected !== id) throw Error('Task changed; refresh the queue');
        if (!latest || latest.version!==item.version) throw Error('Queued message changed; refresh it');
        this.view.prompt.value=latest.text; this.view.tab('chat'); this.view.prompt.focus();
      })),Dom.button('Save message',()=>act('edit')),Dom.button('Move up',()=>act('up')),Dom.button('Move down',()=>act('down')),Dom.button('Remove message',()=>act('remove')));
      row.append(input,bar);this.queueList.append(row);
    }
    if (!items.length) this.queueList.textContent='No queued follow-ups.';
  }
  question(request) {
    if (this.questions.has(request.id)) return;
    const generation=this.workbench.generation, card=Dom.element('section','agent-question'), input=Dom.element('textarea'); input.rows=2;input.maxLength=16000;input.setAttribute('aria-label','Answer agent question');
    card.append(Dom.element('strong','',request.question),Dom.element('p','agent-note','Your answer supplies task information only; it does not approve tools.'));
    const options=Dom.element('div','agent-toolbar');for(const choice of request.options??[])options.append(Dom.button(choice,()=>{input.value=choice;}));
    card.append(options,input,Dom.button('Send answer',()=>this.workbench.guard(async()=>{
      if(generation!==this.workbench.generation)throw Error('Agent environment changed');
      await this.workbench.request('/v1/questions/answer',{id:request.id,answer:input.value});
    })));this.questionList.append(card);this.questions.set(request.id,card);this.view.tab('chat');
  }
  async refreshQuestions() { for(const request of await this.workbench.request('/v1/questions'))this.question(request); }
  handle(event) { if(event.type==='question.requested')this.question(event);if(event.type==='question.resolved'){this.questions.get(event.id)?.remove();this.questions.delete(event.id);} }
}
