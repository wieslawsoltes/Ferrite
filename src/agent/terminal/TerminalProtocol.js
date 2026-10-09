/** Shared terminal policy. A PTY has one reply authority: its headless server.
 * Browser replicas render output but must never send a second CPR/DA/DECRQSS reply.
 */
export const TERMINAL_ENGINE = Object.freeze({name: 'xterm.js', version: '6.0.0', unicodeVersion: '11'});
export const TERMINAL_THEME = Object.freeze({background: '#17181b', foreground: '#d4d4d4', cursor: '#d4d4d4', selectionBackground: '#365880',
  black: '#202124', red: '#d75f5f', green: '#86b971', yellow: '#d7ba7d', blue: '#82aaff', magenta: '#b68ae6', cyan: '#70c0c4', white: '#d4d4d4',
  brightBlack: '#737880', brightRed: '#ff7b72', brightGreen: '#aff5b4', brightYellow: '#ffe49c', brightBlue: '#a5c8ff', brightMagenta: '#e2b5ff', brightCyan: '#b3f0f0', brightWhite: '#ffffff'});

export function installTerminalPolicy(terminal, {replica = false} = {}) {
  const state = {cursorVisible: true, cursorStyle: 0, mouseEncoding: 'default'};
  const subscriptions = [], encodings = new Map([[1005, 'utf8'], [1006, 'sgr'], [1015, 'urxvt'], [1016, 'sgr-pixels']]);
  const reset = () => { state.cursorVisible = true; state.cursorStyle = 0; state.mouseEncoding = 'default'; };
  // The terminal is a data boundary, never a clipboard or URL execution channel.
  for (const code of [8, 52]) subscriptions.push(terminal.parser.registerOscHandler(code, () => true));
  for (const final of ['h', 'l']) subscriptions.push(terminal.parser.registerCsiHandler({prefix: '?', final}, params => {
    for (const param of params) {
      if (param === 25) state.cursorVisible = final === 'h';
      if (encodings.has(param)) {
        if (final === 'h') state.mouseEncoding = encodings.get(param);
        else if (state.mouseEncoding === encodings.get(param)) state.mouseEncoding = 'default';
      }
    }
    return false; // Observe, then let the upstream parser execute its complete semantics.
  }));
  subscriptions.push(terminal.parser.registerCsiHandler({intermediates: ' ', final: 'q'}, params => { state.cursorStyle = Number(params[0] ?? 0); return false; }));
  subscriptions.push(terminal.parser.registerCsiHandler({intermediates: '!', final: 'p'}, () => { state.cursorVisible = true; state.cursorStyle = 0; return false; }));
  subscriptions.push(terminal.parser.registerEscHandler({final: 'c'}, () => { reset(); return false; }));
  if (replica) {
    for (const prefix of ['', '?', '>', '=']) for (const final of ['c', 'n']) subscriptions.push(terminal.parser.registerCsiHandler({prefix, final}, () => true));
    for (const prefix of ['', '?']) subscriptions.push(terminal.parser.registerCsiHandler({prefix, intermediates: '$', final: 'p'}, () => true));
    subscriptions.push(terminal.parser.registerCsiHandler({final: 't'}, () => true));
    for (const intermediates of ['$', '+']) subscriptions.push(terminal.parser.registerDcsHandler({intermediates, final: 'q'}, () => true));
    for (const code of [4, 10, 11, 12]) subscriptions.push(terminal.parser.registerOscHandler(code, data => data.split(';').includes('?')));
  }
  return {state, reset, dispose() { for (const subscription of subscriptions) subscription.dispose(); }};
}
