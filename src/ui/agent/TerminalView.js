import {Dom} from '../views/Dom.js';
import {XtermSurface} from './XtermSurface.js';
import {VirtualShell} from '../../agent/terminal/VirtualShell.js';

/** Human terminal sessions share the server's authoritative xterm semantics.
 * Each view serializes replay, snapshot restoration and resize; keyboard HTTP
 * requests have their own bounded ordered queue and can never cross tabs.
 */
export class TerminalView {
  constructor(root, client, model, {onError = () => {}, onConnect = () => {}} = {}) {
    this.root = root; this.client = client; this.model = model; this.onError = onError; this.onConnect = onConnect;
    this.sessions = new Map(); this.active = 'browser'; this.disposed = false; this.frame = null;
    this.report = error => { if (!this.disposed && error.name !== 'AbortError') onError(error); };
    root.classList.add('terminal-workbench'); const controls = Dom.element('div', 'terminal-controls');
    this.tabs = Dom.element('select'); this.tabs.setAttribute('aria-label', 'Terminal session'); this.tabs.id = 'agent-terminal-tabs';
    this.tabs.onchange = () => { this.active = this.tabs.value; this.draw(); };
    this.launch = Dom.element('select'); this.launch.setAttribute('aria-label', 'Native terminal program');
    for (const [id, title] of [['shell', 'Native shell'], ['codex', 'Codex CLI'], ['claude', 'Claude Code CLI'], ['gemini', 'Gemini CLI'], ['codex-login', 'Codex sign in'], ['claude-login', 'Claude sign in']]) { const option = Dom.element('option', '', title); option.value = id; this.launch.append(option); }
    controls.append(this.tabs, this.launch, Dom.button('New native', () => this.openNative().catch(this.report)), Dom.button('Connect', onConnect),
      Dom.button('Interrupt', () => this.send('\x03')), Dom.button('Close', () => this.closeActive()), Dom.button('Clear', () => this.current().screen.clear()),
      Dom.button('Copy', () => { const text = this.current().screen.terminal.getSelection(); if (!text) return; if (!navigator.clipboard?.writeText) return this.report(Error('Clipboard access requires a secure browser context')); navigator.clipboard.writeText(text).catch(this.report); }),
      Dom.button('−', () => this.zoom(-1)), Dom.button('+', () => this.zoom(1)));
    this.findInput = Dom.element('input'); this.findInput.type = 'search'; this.findInput.placeholder = 'Find in terminal'; this.findInput.setAttribute('aria-label', 'Find in terminal');
    this.findInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); this.current().screen.find(this.findInput.value, event.shiftKey); } };
    this.gpuButton = Dom.button('GPU: off', () => { const enabled = this.current().screen.gpu(!this.current().screen.webgl); this.gpuButton.textContent = 'GPU: ' + (enabled ? 'on' : 'off'); });
    this.accessibilityButton = Dom.button('Screen reader: off', () => { const terminal = this.current().screen.terminal; terminal.options.screenReaderMode = !terminal.options.screenReaderMode; this.draw(); });
    this.accessibilityButton.setAttribute('aria-pressed', 'false');
    controls.append(this.findInput, Dom.button('Find', () => this.current().screen.find(this.findInput.value)), this.gpuButton, this.accessibilityButton);
    this.status = Dom.element('div', 'terminal-status'); this.viewport = Dom.element('div', 'terminal-viewport'); this.content = Dom.element('div', 'terminal-screen'); this.viewport.append(this.content);
    this.form = Dom.element('form', 'terminal-command'); this.input = Dom.element('input'); this.input.id = 'browser-terminal-input'; this.input.placeholder = 'Browser shell: help'; this.input.autocomplete = 'off'; this.input.spellcheck = false; this.input.setAttribute('aria-label', 'Browser shell command');
    this.form.append(Dom.element('span', '', '❯'), this.input); this.form.onsubmit = event => { event.preventDefault(); this.browserCommand(); };
    root.append(controls, this.status, this.viewport, this.form); this.shell = new VirtualShell(model);
    this.sessions.set('browser', {id: 'browser', title: 'Browser shell', screen: new XtermSurface(), cursor: 0, closed: false});
    this.current().screen.write('Ferrite browser workspace shell\r\nType help, cargo help or agent help. Native tools require a trusted bridge.\r\n'); this.updateTabs();
    this.historyIndex = 0; this.input.onkeydown = event => { if (event.key === 'ArrowUp' || event.key === 'ArrowDown') { event.preventDefault(); this.historyIndex = Math.max(0, Math.min(this.shell.history.length, this.historyIndex + (event.key === 'ArrowUp' ? -1 : 1))); this.input.value = this.shell.history[this.historyIndex] ?? ''; } };
    this.observer = new ResizeObserver(() => this.resize()); this.observer.observe(this.viewport); this.draw();
    this.timer = setInterval(() => this.poll().catch(this.report), 60);
  }
  current() { return this.sessions.get(this.active) ?? this.sessions.get('browser'); }
  updateTabs() { this.tabs.replaceChildren(); for (const session of this.sessions.values()) { const option = Dom.element('option', '', session.title + (session.closed ? ' · exited ' + session.exitCode : '')); option.value = session.id; this.tabs.append(option); } this.tabs.value = this.active; }
  async browserCommand() {
    const command = this.input.value; if (!command.trim() || this.browserBusy) return; this.browserBusy = true; this.input.value = ''; this.input.disabled = true;
    const session = this.sessions.get('browser'); await session.screen.write(`\r\n/${this.shell.cwd} ❯ ${command}\r\n`);
    try {
      const result = await (this.executeBrowser ? this.executeBrowser(command) : this.shell.execute(command));
      if (this.executeBrowser) { this.shell.history.push(command); if (this.shell.history.length > 200) this.shell.history.shift(); this.shell.cwd = result.cwd ?? ''; }
      if (result.clear) session.screen.reset(); await session.screen.write(result.text.replace(/\r?\n/g, '\r\n')); this.historyIndex = this.shell.history.length;
    } catch (error) { if (error.name !== 'AbortError') { await session.screen.write('Error: ' + error.message + '\r\n'); this.report(error); } }
    finally { this.browserBusy = false; this.input.disabled = false; this.draw(); }
  }
  alive(session) { return !this.disposed && this.sessions.get(session.id) === session && !session.controller?.signal.aborted; }
  enqueue(session, operation) { const result = session.queue.then(() => this.alive(session) ? operation() : undefined); session.queue = result.catch(() => {}); return result; }
  request(session, suffix = '', data, options = {}) { return this.client.request(`/v1/terminals/${session.id}${suffix}`, data, {timeoutMs: 10000, ...options, signal: session.controller.signal}); }
  async openNative(kind = this.launch.value) {
    if (!this.client.url) { this.onConnect(); return; }
    const programs = {shell: {executable: '/bin/sh', args: ['-i']}, codex: {executable: 'codex', args: []}, claude: {executable: 'claude', args: []}, gemini: {executable: 'gemini', args: []}, 'codex-login': {executable: 'codex', args: ['login']}, 'claude-login': {executable: 'claude', args: ['auth', 'login']}};
    if (!Object.hasOwn(programs, kind)) throw Error('Unknown native terminal program');
    const result = await this.client.request('/v1/terminals/open', {...programs[kind], ...this.dimensions()});
    if (this.disposed || !this.client.url) return;
    await this.attach(result); this.active = result.id; this.updateTabs(); this.render(); this.current().screen.focus();
  }
  async attach(metadata) {
    if (this.sessions.has(metadata.id)) return;
    const session = {...metadata, title: metadata.executable.split('/').at(-1) + ' · ' + metadata.id.slice(0, 5), cursor: 0, queue: Promise.resolve(), inputQueue: Promise.resolve(), inputBytes: 0, controller: new AbortController(), polling: false};
    session.screen = new XtermSurface(metadata.cols, metadata.rows, {native: true,
      onData: text => this.sendTo(session, text), onBinary: data => this.sendTo(session, data, true)});
    this.sessions.set(session.id, session); this.updateTabs();
    try { await this.enqueue(session, () => this.restore(session)); }
    catch (error) { session.needsRestore = true; throw error; }
  }
  async restore(session) {
    const state = await this.request(session, '/state'); if (!this.alive(session)) return;
    await session.screen.restore(state);
    if (!this.alive(session)) return; session.cursor = state.cursor; session.closed = state.closed; session.exitCode = state.exitCode; session.needsRestore = false;
    this.updateTabs(); this.draw();
  }
  disconnect() {
    for (const [id, session] of this.sessions) if (id !== 'browser') { session.controller?.abort(); session.screen?.dispose?.(); this.sessions.delete(id); }
    this.active = 'browser'; this.updateTabs(); this.draw();
  }
  async reconnect() { for (const metadata of await this.client.request('/v1/terminals')) { if (this.disposed || !this.client.url) break; await this.attach(metadata); } }
  async poll() {
    if (!this.client.url || this.disposed) return;
    const session = this.current(); if (session.id === 'browser' || session.polling || session.closed && !session.needsRestore) return;
    session.polling = true;
    try {
      await this.enqueue(session, async () => {
        if (session.needsRestore) return this.restore(session);
        const result = await this.request(session, `?cursor=${session.cursor}&waitMs=400`);
        if (!this.alive(session)) return;
        if (result.gap) return this.restore(session);
        for (const event of result.events) {
          if (event.type === 'data') await session.screen.write(event.text);
          else if (event.type === 'resize') session.screen.resize(event.cols, event.rows);
        }
        session.cursor = result.cursor; session.closed = result.closed; session.exitCode = result.exitCode;
        if (result.closed) this.updateTabs(); if (result.events.length) this.draw();
      });
    } catch (error) { if (this.alive(session)) session.needsRestore = true; throw error; }
    finally { session.polling = false; }
  }
  send(text) { if (this.active === 'browser') { this.input.focus(); return Promise.resolve(); } return this.sendTo(this.current(), text); }
  sendTo(session, data, binary = false) {
    const size = binary ? data.length : new TextEncoder().encode(data).length;
    if (!this.alive(session) || session.closed) return Promise.resolve();
    if (size > 65536 || session.inputBytes + size > 262144) { this.report(Error('Terminal input exceeds the bounded 64 KiB write / 256 KiB queue; split the paste')); return Promise.resolve(); }
    session.inputBytes += size;
    // Do not queue an input behind a long-poll: it is often what makes the poll complete.
    const result = session.inputQueue.then(() => this.alive(session) ? this.request(session, binary ? '/binary' : '/input', binary ? {data: btoa(data)} : {text: data}) : undefined);
    session.inputQueue = result.catch(this.report).finally(() => { session.inputBytes -= size; }); return session.inputQueue;
  }
  async closeActive() {
    const id = this.active; if (id === 'browser') return;
    try { await this.client.request(`/v1/terminals/${id}/close`, {}); const session = this.sessions.get(id); session?.controller?.abort(); session?.screen?.dispose?.(); this.sessions.delete(id); if (this.active === id) this.active = 'browser'; this.updateTabs(); this.draw(); }
    catch (error) { this.onError(error); }
  }
  dimensions() { return this.current().screen.dimensions() ?? {cols: this.current().screen.cols, rows: this.current().screen.rows}; }
  resize() {
    clearTimeout(this.resizeTimer); this.resizeTimer = setTimeout(() => {
      const session = this.current(), size = session.screen.dimensions();
      if (!size || session.screen.cols === size.cols && session.screen.rows === size.rows) return;
      if (session.id === 'browser' || session.closed) { session.screen.resize(size.cols, size.rows); return; }
      if (!this.client.url) return;
      this.enqueue(session, async () => {
        await this.request(session, '/resize', size);
        // Replay might still contain old-size data. A fresh, sequence-stamped state
        // atomically crosses the resize boundary instead of mixing two dimensions.
        await this.restore(session);
      }).catch(this.report);
    }, 100);
  }
  zoom(delta) { this.current().screen.zoom(delta); this.resize(); }
  draw() { if (this.frame || this.disposed) return; this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); }); }
  render() {
    if (this.disposed) return; const session = this.current(), screen = session.screen;
    const switched = this.displayed !== session; this.displayed = session;
    this.form.hidden = session.id !== 'browser'; screen.open(this.content); this.ime = screen.terminal.textarea;
    this.gpuButton.textContent = 'GPU: ' + (screen.webgl ? 'on' : 'off');
    this.accessibilityButton.textContent = 'Screen reader: ' + (screen.terminal.options.screenReaderMode ? 'on' : 'off');
    this.accessibilityButton.setAttribute('aria-pressed', String(screen.terminal.options.screenReaderMode));
    this.status.textContent = session.id === 'browser' ? `Browser shell · /${this.shell.cwd} · bounded utilities, no native processes` : `Native PTY · xterm.js · ${screen.cols}×${screen.rows} · ${session.closed ? 'exited ' + session.exitCode : 'host permissions · not sandboxed'}`;
    if (switched) this.resize();
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; clearInterval(this.timer); clearTimeout(this.resizeTimer); this.observer.disconnect(); if (this.frame) cancelAnimationFrame(this.frame);
    for (const session of this.sessions.values()) { session.controller?.abort(); session.screen.dispose(); } this.sessions.clear();
  }
}
