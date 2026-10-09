import {Terminal} from '../../vendor/xterm/headless.mjs';
import {SerializeAddon} from '../../vendor/xterm/addon-serialize.mjs';
import {Unicode11Addon} from '../../vendor/xterm/addon-unicode11.mjs';
import {installTerminalPolicy, TERMINAL_ENGINE, TERMINAL_THEME} from './TerminalProtocol.js';
import {AgentError} from '../core/AgentError.js';

/** Authoritative, DOM-free xterm. TerminalManager serializes writes, resize and snapshots. */
export class TerminalScreen {
  constructor(cols, rows, {scrollback = 2000, onReply = () => {}} = {}) {
    this.terminal = new Terminal({cols, rows, scrollback, allowProposedApi: true, logLevel: 'off', theme: {...TERMINAL_THEME}});
    this.serializer = new SerializeAddon(); this.terminal.loadAddon(this.serializer);
    this.terminal.loadAddon(new Unicode11Addon()); this.terminal.unicode.activeVersion = '11';
    this.policy = installTerminalPolicy(this.terminal); this.title = ''; this.disposed = false;
    this.subscriptions = [this.terminal.onData(onReply), this.terminal.onTitleChange(title => { this.title = title.replace(/[\x00-\x1f\x7f]/g, '').slice(0, 512); })];
  }
  write(text) { return new Promise(resolve => this.terminal.write(text, resolve)); }
  resize(cols, rows) { this.terminal.resize(cols, rows); }
  modes() { return {...this.terminal.modes, ...this.policy.state}; }
  text() { const buffer = this.terminal.buffer.active; return Array.from({length: this.terminal.rows}, (_, y) => buffer.getLine(buffer.baseY + y)?.translateToString(true) ?? '').join('\n'); }
  snapshot({startRow = 0, rowCount = this.terminal.rows, cells = false} = {}) {
    const terminal = this.terminal, buffer = terminal.buffer.active;
    if (!Number.isSafeInteger(startRow) || startRow < 0 || startRow >= terminal.rows || !Number.isSafeInteger(rowCount) || rowCount < 1 || rowCount > 200 || typeof cells !== 'boolean') throw new AgentError('TERMINAL_RANGE', 'Invalid screen row range or cell option');
    const count = Math.min(rowCount, terminal.rows - startRow);
    if (cells && count * terminal.cols > 20000) throw new AgentError('TERMINAL_RANGE', 'Cell snapshots are limited to 20,000 cells; request a smaller row range');
    const lines = [], wrapped = [], cellRows = [];
    for (let y = startRow; y < startRow + count; y++) {
      const line = buffer.getLine(buffer.baseY + y); lines.push(line?.translateToString(true) ?? ''); wrapped.push(line?.isWrapped ?? false);
      if (cells) {
        const row = [];
        for (let x = 0; x < terminal.cols; x++) {
          const cell = line?.getCell(x);
          const color = kind => cell?.['is' + kind + 'Default']() ? null : {mode: cell?.['is' + kind + 'RGB']() ? 'rgb' : 'palette', value: cell?.['get' + kind + 'Color']() ?? 0};
          row.push({text: cell?.getChars() ?? '', width: cell?.getWidth() ?? 1, fg: color('Fg'), bg: color('Bg'),
            bold: !!cell?.isBold(), dim: !!cell?.isDim(), italic: !!cell?.isItalic(), underline: !!cell?.isUnderline(), inverse: !!cell?.isInverse(), invisible: !!cell?.isInvisible(), strike: !!cell?.isStrikethrough()});
        }
        cellRows.push(row);
      }
    }
    return {engine: TERMINAL_ENGINE, cols: terminal.cols, rows: terminal.rows, buffer: buffer.type, title: this.title,
      cursorPosition: {row: buffer.cursorY + 1, column: buffer.cursorX + 1, visible: this.policy.state.cursorVisible},
      modes: this.modes(), historyLines: buffer.baseY, startRow, lines, wrapped, text: lines.join('\n'), ...(cells ? {cells: cellRows} : {})};
  }
  serialize(scrollback = 1000) {
    let ansi = this.serializer.serialize({scrollback});
    // Serialization includes terminal modes, but mouse encoding and cursor appearance
    // are observed separately because they are not exposed by upstream's mode API.
    const state = this.policy.state;
    ansi += '\x1b[?25' + (state.cursorVisible ? 'h' : 'l');
    ansi += `\x1b[${state.cursorStyle} q`;
    const mode = {utf8: 1005, sgr: 1006, urxvt: 1015, 'sgr-pixels': 1016}[state.mouseEncoding];
    if (mode) ansi += `\x1b[?${mode}h`;
    return ansi;
  }
  dispose() { if (this.disposed) return; this.disposed = true; this.policy.dispose(); for (const subscription of this.subscriptions) subscription.dispose(); this.terminal.dispose(); }
}
