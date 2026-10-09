import {xtermCore} from './XtermStateAdapter.js';

/** Frame the PTY stream at the pinned engine's own VT500 grammar boundaries.
 * A snapshot must never omit half a CSI/OSC/DCS sequence then replay its suffix
 * as printable text. Holding only the unfinished control token solves this
 * without delaying ordinary output or serializing opaque parser callbacks.
 * Unterminated/oversized controls are discarded through their closing boundary;
 * payload memory is bounded even when a hostile program never terminates OSC.
 */
export class TerminalFramer {
  constructor(terminal, {limit = 65536} = {}) {
    if (!Number.isSafeInteger(limit) || limit < 32 || limit > 65536) throw Error('Invalid terminal control-sequence limit');
    this.table = xtermCore(terminal)._inputHandler._parser._transitions.table;
    this.limit = limit; this.state = 0; this.pending = ''; this.discarding = false; this.discarded = 0;
  }
  push(text) {
    const source = this.pending + text, offset = this.pending.length, output = [];
    let start = 0, safe = 0; this.pending = '';
    for (let index = offset; index < source.length;) {
      const code = source.codePointAt(index); index += code > 65535 ? 2 : 1;
      // xterm promotes ESC to ESCAPE after OSC_END/DCS_UNHOOK as well as
      // ordinary transitions; all other next states are the table's low nibble.
      this.state = code === 27 ? 1 : this.table[(this.state << 8) | Math.min(code, 160)] & 15;
      if (!this.discarding && index - safe > this.limit) {
        if (safe > start) output.push(source.slice(start, safe));
        this.discarding = true; this.discarded++; start = index;
      }
      if (this.state === 0) {
        if (this.discarding) { this.discarding = false; start = index; }
        safe = index;
      }
    }
    if (!this.discarding) {
      if (safe > start) output.push(source.slice(start, safe));
      this.pending = source.slice(safe);
    }
    return output.join('');
  }
}
