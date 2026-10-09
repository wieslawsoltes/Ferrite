import {Terminal} from '../../vendor/xterm/xterm.mjs';
import {FitAddon} from '../../vendor/xterm/addon-fit.mjs';
import {SearchAddon} from '../../vendor/xterm/addon-search.mjs';
import {Unicode11Addon} from '../../vendor/xterm/addon-unicode11.mjs';
import {WebglAddon} from '../../vendor/xterm/addon-webgl.mjs';
import {installTerminalPolicy, TERMINAL_THEME} from '../../agent/terminal/TerminalProtocol.js';

/** A disposable browser replica of the headless PTY screen. No terminal output
 * can read/write the clipboard or open a URL. Copy is an explicit UI gesture.
 */
export class XtermSurface {
  constructor(cols = 100, rows = 24, {native = false, onData = () => {}, onBinary = () => {}} = {}) {
    this.host = document.createElement('div'); this.host.className = 'terminal-surface';
    this.terminal = new Terminal({cols, rows, scrollback: 2000, allowProposedApi: true, disableStdin: !native,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace', fontSize: 13, lineHeight: 1.15,
      theme: {...TERMINAL_THEME}, cursorBlink: native, logLevel: 'off', screenReaderMode: true});
    this.fit = new FitAddon(); this.search = new SearchAddon(); this.pending = new Set(); this.native = native;
    for (const addon of [this.fit, this.search, new Unicode11Addon()]) this.terminal.loadAddon(addon);
    this.terminal.unicode.activeVersion = '11'; this.policy = installTerminalPolicy(this.terminal, {replica: true});
    this.subscriptions = [this.terminal.onData(onData), this.terminal.onBinary(onBinary)];
  }
  get cols() { return this.terminal.cols; }
  get rows() { return this.terminal.rows; }
  open(container) {
    if (this.disposed) return;
    const attached = this.host.parentNode !== container;
    if (attached) container.replaceChildren(this.host);
    if (!this.opened) {
      this.terminal.open(this.host); this.opened = true;
      this.terminal.textarea?.setAttribute('aria-label', this.native ? 'Native terminal input' : 'Browser terminal output');
    }
    if (attached) this.terminal.refresh(0, this.rows - 1);
  }
  write(text) {
    if (this.disposed) return Promise.resolve();
    return new Promise(resolve => { const done = () => { this.pending.delete(done); resolve(); }; this.pending.add(done); this.terminal.write(text, done); });
  }
  reset() { if (!this.disposed) { this.terminal.reset(); this.policy.reset(); } }
  clear() { this.terminal.clear(); }
  resize(cols, rows) { if (!this.disposed) this.terminal.resize(cols, rows); }
  dimensions() { if (!this.opened || !this.host.getClientRects().length) return null; const size = this.fit.proposeDimensions(); return size && Number.isFinite(size.cols) && Number.isFinite(size.rows) ? {cols: Math.max(2, Math.min(500, size.cols)), rows: Math.max(2, Math.min(200, size.rows))} : null; }
  text() { const buffer = this.terminal.buffer.active; return Array.from({length: this.rows}, (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? '').join('\n'); }
  focus() { this.terminal.focus(); }
  find(text, previous = false) { return text ? this.search[previous ? 'findPrevious' : 'findNext'](text, {incremental: false}) : false; }
  zoom(delta) { this.terminal.options.fontSize = Math.max(9, Math.min(28, this.terminal.options.fontSize + delta)); }
  gpu(enabled) {
    this.gpuSubscription?.dispose(); this.gpuSubscription = null;
    this.webgl?.dispose(); this.webgl = null;
    if (enabled && this.opened && !this.disposed) {
      try {
        const addon = new WebglAddon(); this.terminal.loadAddon(addon); this.webgl = addon;
        this.gpuSubscription = addon.onContextLoss(() => this.gpu(false));
      } catch { this.webgl?.dispose(); this.webgl = null; }
    }
    return !!this.webgl;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.gpuSubscription?.dispose(); this.policy.dispose(); this.subscriptions.forEach(item => item.dispose());
    this.terminal.dispose(); this.host.remove(); for (const done of [...this.pending]) done();
  }
}
