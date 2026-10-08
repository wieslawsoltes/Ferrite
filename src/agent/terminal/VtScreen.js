/** Bounded VT-style screen. All output is data; OSC/DCS never execute URLs or clipboard writes.
 * Implements the control sequences used by common CLI programs, not the complete xterm specification.
 */
export class VtScreen {
  constructor(cols = 100, rows = 30, {scrollback = 2000, onReply = () => {}} = {}) {
    this.maxScrollback = scrollback; this.onReply = onReply; this.cols = cols; this.rows = rows; this.reset();
  }
  defaults() { return {fg: null, bg: null, bold: false, faint: false, italic: false, underline: false, inverse: false, strike: false}; }
  blank() { return Array.from({length: this.cols}, () => ({text: ' ', width: 1, ...this.style})); }
  reset() {
    this.style = this.defaults(); this.x = 0; this.y = 0; this.saved = null; this.scrollTop = 0; this.scrollBottom = this.rows - 1;
    this.lines = Array.from({length: this.rows}, () => this.blank()); this.history = []; this.alt = null; this.parser = 'text'; this.sequence = ''; this.pendingHigh = ''; this.wrap = true; this.wrapPending = false; this.cursorVisible = true; this.bracketedPaste = false; this.applicationCursor = false; this.insertMode = false; this.originMode = false; this.dirty = true;
  }
  resize(cols, rows) {
    cols = Math.max(2, Math.min(500, Math.floor(cols))); rows = Math.max(2, Math.min(200, Math.floor(rows)));
    if (cols === this.cols && rows === this.rows) return;
    const resizeBuffer = lines => lines.map(line => { const next = line.slice(0, cols); while (next.length < cols) next.push({text: ' ', width: 1, ...this.defaults()}); return next; });
    this.cols = cols; this.lines = resizeBuffer(this.lines); this.history = resizeBuffer(this.history);
    if (this.alt) { this.alt.lines = resizeBuffer(this.alt.lines); while (this.alt.lines.length < rows) this.alt.lines.push(this.blank()); this.alt.lines.length = rows; }
    while (this.lines.length < rows) this.lines.push(this.blank());
    if (this.lines.length > rows) {
      const remove = Math.min(this.lines.length - rows, this.y); if (!this.alt) this.history.push(...this.lines.splice(0, remove)); else this.lines.splice(0, remove);
      this.y -= remove; this.lines.length = rows;
    }
    this.rows = rows; this.x = Math.min(this.x, cols - 1); this.y = Math.min(this.y, rows - 1); this.scrollTop = 0; this.scrollBottom = rows - 1; this.wrapPending = false; this.trim(); this.dirty = true;
  }
  trim() { if (this.history.length > this.maxScrollback) this.history.splice(0, this.history.length - this.maxScrollback); }
  static width(char) {
    const cp = char.codePointAt(0);
    if (/\p{Mark}/u.test(char) || cp === 0x200d || cp >= 0xfe00 && cp <= 0xfe0f || cp >= 0xe0100 && cp <= 0xe01ef) return 0;
    return cp >= 0x1100 && (cp <= 0x115f || cp === 0x2329 || cp === 0x232a || cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f || cp >= 0xac00 && cp <= 0xd7a3 || cp >= 0xf900 && cp <= 0xfaff || cp >= 0xfe10 && cp <= 0xfe6f || cp >= 0xff00 && cp <= 0xff60 || cp >= 0xffe0 && cp <= 0xffe6 || cp >= 0x1f300 && cp <= 0x1faff || cp >= 0x20000 && cp <= 0x3fffd) ? 2 : 1;
  }
  write(text) {
    text = this.pendingHigh + String(text); this.pendingHigh = '';
    if (text.length && /[\uD800-\uDBFF]/.test(text.at(-1))) { this.pendingHigh = text.at(-1); text = text.slice(0, -1); }
    for (const char of text) this.consume(char); this.dirty = true;
  }
  consume(char) {
    if (this.parser === 'osc' || this.parser === 'dcs') {
      if (char === '\x07' && this.parser === 'osc') { this.parser = 'text'; this.sequence = ''; }
      else if (char === '\x1b') this.parser = 'string-end';
      return;
    }
    if (this.parser === 'string-end') { this.parser = char === '\\' ? 'text' : 'osc'; return; }
    if (this.parser === 'charset') { this.parser = 'text'; return; }
    if (this.parser === 'esc') {
      this.parser = 'text'; this.sequence = '';
      if (char === '[') this.parser = 'csi';
      else if (char === ']') this.parser = 'osc';
      else if (['P', '_', '^'].includes(char)) this.parser = 'dcs';
      else if (['(', ')', '*', '+', '%', '#'].includes(char)) this.parser = 'charset';
      else if (char === '7') this.save(); else if (char === '8') this.restore();
      else if (char === 'D') this.lineFeed(); else if (char === 'E') { this.x = 0; this.lineFeed(); }
      else if (char === 'M') { if (this.y === this.scrollTop) this.scrollDown(); else this.y = Math.max(0, this.y - 1); }
      else if (char === 'c') this.reset();
      return;
    }
    if (this.parser === 'csi') {
      if (char >= '@' && char <= '~') { const sequence = this.sequence; this.sequence = ''; this.parser = 'text'; this.csi(char, sequence); }
      else if (this.sequence.length < 256) this.sequence += char; else { this.sequence = ''; this.parser = 'text'; }
      return;
    }
    if (char === '\x1b') { this.parser = 'esc'; return; }
    if (char === '\r') { this.x = 0; this.wrapPending = false; return; }
    if (char === '\n' || char === '\v' || char === '\f') { this.lineFeed(); return; }
    if (char === '\b') { this.x = Math.max(0, this.x - 1); this.wrapPending = false; return; }
    if (char === '\t') { this.x = Math.min(this.cols - 1, (Math.floor(this.x / 8) + 1) * 8); this.wrapPending = false; return; }
    if (char < ' ' || char === '\x7f') return;
    this.put(char);
  }
  save() { this.saved = {x: this.x, y: this.y, style: {...this.style}, originMode: this.originMode}; }
  restore() { if (this.saved) { this.x = Math.min(this.cols - 1, this.saved.x); this.y = Math.min(this.rows - 1, this.saved.y); this.style = {...this.saved.style}; this.originMode = this.saved.originMode; this.wrapPending = false; } }
  put(char) {
    let width = VtScreen.width(char);
    if (!width) { const x = this.wrapPending ? this.x : Math.max(0, this.x - 1), row = this.lines[this.y], cell = row[x].width === 0 ? row[Math.max(0, x - 1)] : row[x]; cell.text += char; return; }
    if (this.wrap && (this.wrapPending || width === 2 && this.x === this.cols - 1)) { this.x = 0; this.lineFeed(); }
    if (!this.wrap && width === 2 && this.x === this.cols - 1) { char = ' '; width = 1; }
    const row = this.lines[this.y];
    if (this.insertMode) { row.splice(this.x, 0, ...Array.from({length: width}, () => ({text: ' ', width: 1, ...this.style}))); row.length = this.cols; }
    if (row[this.x].width === 0 && this.x) row[this.x - 1] = {text: ' ', width: 1, ...this.style};
    if (row[this.x].width === 2 && this.x + 1 < this.cols) row[this.x + 1] = {text: ' ', width: 1, ...this.style};
    row[this.x] = {text: char, width, ...this.style};
    if (width === 2 && this.x + 1 < this.cols) row[this.x + 1] = {text: '', width: 0, ...this.style};
    if (this.x + width >= this.cols) { this.x = this.cols - 1; this.wrapPending = true; } else { this.x += width; this.wrapPending = false; }
  }
  lineFeed() { this.wrapPending = false; if (this.y === this.scrollBottom) this.scrollUp(); else this.y = Math.min(this.rows - 1, this.y + 1); }
  scrollUp(count = 1) { for (let i = 0; i < Math.min(count, this.rows); i++) { const [removed] = this.lines.splice(this.scrollTop, 1); if (this.scrollTop === 0 && this.scrollBottom === this.rows - 1 && !this.alt) this.history.push(removed); this.lines.splice(this.scrollBottom, 0, this.blank()); } this.trim(); }
  scrollDown(count = 1) { for (let i = 0; i < Math.min(count, this.rows); i++) { this.lines.splice(this.scrollBottom, 1); this.lines.splice(this.scrollTop, 0, this.blank()); } }
  erase(row, from, to) { for (let x = Math.max(0, from); x <= Math.min(to, this.cols - 1); x++) this.lines[row][x] = {text: ' ', width: 1, ...this.style}; }
  alternate(enabled) {
    if (enabled && !this.alt) { this.alt = {lines: this.lines, x: this.x, y: this.y, saved: this.saved}; this.lines = Array.from({length: this.rows}, () => this.blank()); this.x = this.y = 0; }
    else if (!enabled && this.alt) { const alt = this.alt; this.alt = null; this.lines = alt.lines; this.x = Math.min(this.cols - 1, alt.x); this.y = Math.min(this.rows - 1, alt.y); this.saved = alt.saved; }
    this.scrollTop = 0; this.scrollBottom = this.rows - 1; this.wrapPending = false;
  }
  csi(final, raw) {
    const privateMode = raw.startsWith('?'), values = raw.replace(/^[?>!]/, '').split(';').map(item => Number(item || 0)), n = Math.max(1, values[0] || 1), low = this.originMode ? this.scrollTop : 0, high = this.originMode ? this.scrollBottom : this.rows - 1;
    if (!['m','h','l','n','c'].includes(final)) this.wrapPending = false;
    if (final === 'A') this.y = Math.max(low, this.y - n);
    else if (final === 'B' || final === 'e') this.y = Math.min(high, this.y + n);
    else if (final === 'C' || final === 'a') this.x = Math.min(this.cols - 1, this.x + n);
    else if (final === 'D') this.x = Math.max(0, this.x - n);
    else if (final === 'E') { this.x = 0; this.y = Math.min(high, this.y + n); }
    else if (final === 'F') { this.x = 0; this.y = Math.max(low, this.y - n); }
    else if (final === 'G' || final === '`') this.x = Math.min(this.cols - 1, n - 1);
    else if (final === 'd') this.y = Math.min(high, low + n - 1);
    else if (final === 'H' || final === 'f') { this.y = Math.min(high, low + n - 1); this.x = Math.min(this.cols - 1, Math.max(1, values[1] || 1) - 1); }
    else if (final === 'J') {
      const mode = values[0]; if (mode === 2 || mode === 3) { for (let y = 0; y < this.rows; y++) this.erase(y, 0, this.cols - 1); if (mode === 3) this.history = []; }
      else if (mode === 0) { this.erase(this.y, this.x, this.cols - 1); for (let y = this.y + 1; y < this.rows; y++) this.erase(y, 0, this.cols - 1); }
      else if (mode === 1) { for (let y = 0; y < this.y; y++) this.erase(y, 0, this.cols - 1); this.erase(this.y, 0, this.x); }
    } else if (final === 'K') this.erase(this.y, values[0] === 0 ? this.x : 0, values[0] === 1 ? this.x : this.cols - 1);
    else if (final === 'X') this.erase(this.y, this.x, this.x + n - 1);
    else if (final === 'P') { this.lines[this.y].splice(this.x, Math.min(n, this.cols)); while (this.lines[this.y].length < this.cols) this.lines[this.y].push({text: ' ', width: 1, ...this.style}); }
    else if (final === '@') { this.lines[this.y].splice(this.x, 0, ...Array.from({length: Math.min(n, this.cols)}, () => ({text: ' ', width: 1, ...this.style}))); this.lines[this.y].length = this.cols; }
    else if (final === 'L' && this.y >= this.scrollTop && this.y <= this.scrollBottom) { const top = this.scrollTop; this.scrollTop = this.y; this.scrollDown(n); this.scrollTop = top; }
    else if (final === 'M' && this.y >= this.scrollTop && this.y <= this.scrollBottom) { const top = this.scrollTop; this.scrollTop = this.y; this.scrollUp(n); this.scrollTop = top; }
    else if (final === 'S') this.scrollUp(n); else if (final === 'T') this.scrollDown(n);
    else if (final === 's') this.save(); else if (final === 'u') this.restore();
    else if (final === 'r' && !privateMode) { const top = n - 1, bottom = (values[1] || this.rows) - 1; if (top >= 0 && bottom < this.rows && top < bottom) { this.scrollTop = top; this.scrollBottom = bottom; this.x = 0; this.y = this.originMode ? top : 0; } }
    else if (final === 'm') this.sgr(raw);
    else if (final === 'h' || final === 'l') {
      const enabled = final === 'h';
      for (const mode of values) {
        if (!privateMode && mode === 4) this.insertMode = enabled;
        if (!privateMode) continue;
        if (mode === 1) this.applicationCursor = enabled; if (mode === 6) { this.originMode = enabled; this.x = 0; this.y = enabled ? this.scrollTop : 0; }
        if (mode === 7) this.wrap = enabled; if (mode === 25) this.cursorVisible = enabled;
        if ([47, 1047, 1049].includes(mode)) this.alternate(enabled); if (mode === 2004) this.bracketedPaste = enabled;
      }
    } else if (final === 'n' && values[0] === 6) this.onReply(`\x1b[${this.y + 1};${this.x + 1}R`);
    else if (final === 'n' && values[0] === 5) this.onReply('\x1b[0n');
    else if (final === 'c') this.onReply(raw.startsWith('>') ? '\x1b[>0;1;0c' : '\x1b[?1;2c');
  }
  sgr(raw) {
    const params = raw ? raw.replace(/(38|48):2:(?:0)?:/g, '$1;2;').replace(/:/g, ';').split(';').map(Number) : [0];
    for (let index = 0; index < params.length; index++) {
      const p = params[index];
      if (p === 0) this.style = this.defaults();
      else if (p === 1) this.style.bold = true; else if (p === 2) this.style.faint = true; else if (p === 3) this.style.italic = true;
      else if (p === 4) this.style.underline = true; else if (p === 7) this.style.inverse = true; else if (p === 9) this.style.strike = true;
      else if (p === 22) this.style.bold = this.style.faint = false; else if (p === 23) this.style.italic = false; else if (p === 24) this.style.underline = false; else if (p === 27) this.style.inverse = false; else if (p === 29) this.style.strike = false;
      else if (p === 39) this.style.fg = null; else if (p === 49) this.style.bg = null;
      else if (p >= 30 && p <= 37) this.style.fg = p - 30; else if (p >= 40 && p <= 47) this.style.bg = p - 40;
      else if (p >= 90 && p <= 97) this.style.fg = p - 90 + 8; else if (p >= 100 && p <= 107) this.style.bg = p - 100 + 8;
      else if (p === 38 || p === 48) {
        const key = p === 38 ? 'fg' : 'bg', kind = params[++index];
        if (kind === 5) this.style[key] = Math.max(0, Math.min(255, params[++index] || 0));
        else if (kind === 2) { const rgb = params.slice(index + 1, index + 4); if (rgb.length === 3) { this.style[key] = rgb.map(v => Math.max(0, Math.min(255, v || 0))); index += 3; } }
      }
    }
  }
  text({history = false} = {}) { return [...(history && !this.alt ? this.history : []), ...this.lines].map(row => row.map(cell => cell.text).join('').trimEnd()).join('\n'); }
  static key(event, applicationCursor = false) {
    const {key, ctrlKey, altKey, metaKey, shiftKey} = event;
    if (metaKey || ctrlKey && shiftKey && ['C', 'V', 'c', 'v'].includes(key)) return null;
    if (ctrlKey && key.length === 1) { const code = key.toUpperCase().charCodeAt(0); if (code >= 64 && code <= 95) return String.fromCharCode(code - 64); if (key === ' ') return '\x00'; }
    const modifier = 1 + (shiftKey ? 1 : 0) + (altKey ? 2 : 0) + (ctrlKey ? 4 : 0);
    const arrow = {ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F'}[key];
    if (arrow) return modifier > 1 ? `\x1b[1;${modifier}${arrow}` : `\x1b${applicationCursor ? 'O' : '['}${arrow}`;
    const tilde = {Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24}[key];
    if (tilde) return `\x1b[${tilde}${modifier > 1 ? ';' + modifier : ''}~`;
    if (/^F[1-4]$/.test(key)) return '\x1bO' + 'PQRS'[Number(key.slice(1)) - 1];
    const simple = {Enter: '\r', Backspace: '\x7f', Tab: shiftKey ? '\x1b[Z' : '\t', Escape: '\x1b'}[key];
    if (simple) return (altKey && key !== 'Escape' ? '\x1b' : '') + simple;
    return key.length === 1 ? (altKey ? '\x1b' : '') + key : null;
  }
}
