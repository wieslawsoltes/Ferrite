import {AgentError} from '../core/AgentError.js';
const encoder = new TextEncoder();
const fail = message => { throw new AgentError('TERMINAL_INPUT', message); };

/** Named input for agents. Raw terminal_input remains available for every protocol. */
export class TerminalInput {
  static key({key, ctrl = false, alt = false, shift = false, meta = false, count = 1}, modes = {}) {
    if (typeof key !== 'string' || !Number.isSafeInteger(count) || count < 1 || count > 100 || [ctrl, alt, shift, meta].some(value => typeof value !== 'boolean')) fail('Invalid key or modifiers');
    const modifier = 1 + Number(shift) + 2 * Number(alt || meta) + 4 * Number(ctrl), modified = modifier > 1;
    const arrows = {ArrowUp: 'A', ArrowDown: 'B', ArrowRight: 'C', ArrowLeft: 'D', Home: 'H', End: 'F'};
    const tilde = {Insert: 2, Delete: 3, PageUp: 5, PageDown: 6, F5: 15, F6: 17, F7: 18, F8: 19, F9: 20, F10: 21, F11: 23, F12: 24};
    const keypad = {Numpad0: ['0','p'], Numpad1: ['1','q'], Numpad2: ['2','r'], Numpad3: ['3','s'], Numpad4: ['4','t'], Numpad5: ['5','u'], Numpad6: ['6','v'], Numpad7: ['7','w'], Numpad8: ['8','x'], Numpad9: ['9','y'], NumpadDecimal: ['.','n'], NumpadAdd: ['+','k'], NumpadSubtract: ['-','m'], NumpadMultiply: ['*','j'], NumpadDivide: ['/','o'], NumpadEnter: ['\r','M']};
    let data;
    if (Object.hasOwn(arrows, key)) data = modified ? `\x1b[1;${modifier}${arrows[key]}` : `\x1b${modes.applicationCursorKeysMode ? 'O' : '['}${arrows[key]}`;
    else if (Object.hasOwn(tilde, key)) data = `\x1b[${tilde[key]}${modified ? ';' + modifier : ''}~`;
    else if (/^F[1-4]$/.test(key)) { const suffix = String.fromCharCode(79 + Number(key.slice(1))); data = modified ? `\x1b[1;${modifier}${suffix}` : '\x1bO' + suffix; }
    else if (Object.hasOwn(keypad, key)) data = modes.applicationKeypadMode ? '\x1bO' + keypad[key][1] : keypad[key][0];
    else {
      if (key === 'Enter') data = '\r';
      else if (key === 'Tab') data = shift ? '\x1b[Z' : '\t';
      else if (key === 'Backspace') data = ctrl ? '\x08' : '\x7f';
      else if (key === 'Escape') data = '\x1b';
      else if (key === 'Space') data = ctrl ? '\0' : ' ';
      else if ([...key].length === 1) {
        data = shift ? key.toUpperCase() : key;
        if (ctrl) {
          const char = key.toUpperCase(), code = char.charCodeAt(0);
          if (char === ' ' || char === '2' || char === '@') data = '\0';
          else if (char === '?' || char === '8') data = '\x7f';
          else if (char === '6') data = '\x1e';
          else if (char === '7' || char === '-') data = '\x1f';
          else if (code >= 64 && code <= 95) data = String.fromCharCode(code - 64);
          else fail('Unsupported control-key combination; use raw input');
        }
      } else fail('Unknown key; use Enter, Tab, arrows, Home/End, PageUp/PageDown, F1–F12, Numpad keys or one Unicode character');
      if (alt || meta) data = '\x1b' + data;
    }
    return encoder.encode(data.repeat(count));
  }
  static paste(text, modes = {}) {
    if (typeof text !== 'string') fail('Paste must be text');
    let data = text.replace(/\r\n|\n/g, '\r');
    // An embedded ESC must not terminate a bracketed paste and inject commands.
    if (modes.bracketedPasteMode) data = '\x1b[200~' + data.replace(/\x1b/g, '') + '\x1b[201~';
    const bytes = encoder.encode(data); if (bytes.length > 65536) fail('Encoded paste exceeds 64 KiB'); return bytes;
  }
  static mouse({type = 'down', button = 'left', column, row, ctrl = false, alt = false, shift = false}, modes, cols, rows) {
    if (!['down','up','move','wheel-up','wheel-down'].includes(type) || !['left','middle','right','none'].includes(button) || !Number.isSafeInteger(column) || column < 1 || column > cols || !Number.isSafeInteger(row) || row < 1 || row > rows || [ctrl, alt, shift].some(value => typeof value !== 'boolean')) fail('Invalid mouse event; coordinates are 1-based terminal cells');
    const tracking = modes.mouseTrackingMode;
    if (!tracking || tracking === 'none' || tracking === 'x10' && type !== 'down' || type === 'move' && (tracking !== 'any' && (tracking !== 'drag' || button === 'none'))) return new Uint8Array();
    let code = {left: 0, middle: 1, right: 2, none: 3}[button];
    if (type === 'wheel-up' || type === 'wheel-down') code = type === 'wheel-up' ? 64 : 65;
    else if (type === 'move') code |= 32;
    code |= (shift ? 4 : 0) | (alt ? 8 : 0) | (ctrl ? 16 : 0);
    if (modes.mouseEncoding === 'sgr') return encoder.encode(`\x1b[<${code};${column};${row}${type === 'up' ? 'm' : 'M'}`);
    if (modes.mouseEncoding === 'sgr-pixels') fail('Pixel mouse mode requires raw pixel input, not cell coordinates');
    if (type === 'up') code = 3 | (code & 28);
    if (modes.mouseEncoding === 'urxvt') return encoder.encode(`\x1b[${code + 32};${column};${row}M`);
    if (modes.mouseEncoding === 'utf8') return encoder.encode('\x1b[M' + String.fromCodePoint(code + 32, column + 32, row + 32));
    if (column > 223 || row > 223) fail('Legacy mouse encoding supports coordinates up to 223; the application must enable SGR mode');
    return Uint8Array.of(27, 91, 77, code + 32, column + 32, row + 32);
  }
}
