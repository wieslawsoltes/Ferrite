import {object, text, path, integer} from './ToolSchemas.js';
import {AgentError} from '../core/AgentError.js';

/** The same owner-scoped terminal contract serves MCP, built-in agents and the IDE. */
export function registerTerminalTools(registry, terminals) {
  const owned = (id, context) => {
    const session = terminals.get(id);
    if (!context.sessionId || session.owner !== context.sessionId) throw new AgentError('TERMINAL_OWNER', 'An agent may only access terminals created by its own session');
    return session;
  };
  const add = (name, description, inputSchema, risk, run) => registry.register({name, description, inputSchema, risk, run, category: 'terminal'});
  const id = text(100), modifiers = {ctrl: {type: 'boolean'}, alt: {type: 'boolean'}, shift: {type: 'boolean'}};
  add('terminal_open', 'Start an interactive native POSIX PTY with a persistent xterm-256color screen, job control and ncurses support. Programs execute on the trusted host, not in a sandbox. Python 3 and the requested installed program are required; use WSL on Windows. Read terminal_screen for rendered TUI state and terminal_read for raw output.',
    object({executable: text(4096), args: {type: 'array', maxItems: 256, items: text(8192)}, cwd: path, cols: integer(2, 500), rows: integer(2, 200)}, []), 'execute', (args, context) => {
      if (!context.sessionId) throw new AgentError('TERMINAL_OWNER', 'A terminal requires a stable owner session');
      return terminals.start({...args, owner: context.sessionId});
    });
  add('terminal_list', 'List terminals owned by this agent session only.', object(), 'read', (_, context) => terminals.list().filter(item => item.owner === context.sessionId));
  add('terminal_read', 'Read raw terminal events after a sequence cursor, including resize events, explicit replay gaps and exit status. Optional waitMs long-polls for output without busy polling. On a gap use terminal_screen; do not interpret a truncated escape stream as a complete screen.',
    object({id, cursor: integer(0, Number.MAX_SAFE_INTEGER), waitMs: integer(0, 30000)}, ['id']), 'read', ({id, cursor = 0, waitMs = 0}, context) => {
      owned(id, context); return waitMs ? terminals.wait(id, {cursor, timeoutMs: waitMs, signal: context.signal}) : terminals.read(id, cursor);
    });
  add('terminal_screen', 'Inspect the actual rendered xterm screen, including ncurses alternate buffers, lines, Unicode, styles, cursor, dimensions and input modes. This is authoritative even with no browser attached. startRow is zero-based; cursorPosition uses one-based row/column. Cell snapshots are limited to 20,000 cells; use row ranges for large screens.',
    object({id, startRow: integer(0, 199), rowCount: integer(1, 200), cells: {type: 'boolean'}}, ['id']), 'read', ({id, ...options}, context) => { owned(id, context); return terminals.snapshot(id, options); });
  add('terminal_wait', 'Wait for literal text on the rendered screen, any new output after cursor, or process exit. No regular expressions or unbounded sleeps. Returns matched/timedOut/reason and replay events; screen contains a separately sequence-stamped rendered snapshot unless includeScreen is false. Cancellation releases the waiter without closing the PTY.',
    object({id, cursor: integer(0, Number.MAX_SAFE_INTEGER), until: {enum: ['output', 'text', 'exit']}, contains: {...text(4096), minLength: 1}, timeoutMs: integer(0, 30000), includeScreen: {type: 'boolean'}}, ['id']), 'read', async ({id, includeScreen = true, ...options}, context) => {
      owned(id, context); const result = await terminals.wait(id, {...options, signal: context.signal}); AgentError.abort(context.signal);
      return includeScreen ? {...result, screen: await terminals.snapshot(id)} : result;
    });
  add('terminal_input', 'Send literal UTF-8 input to an owned PTY. Use carriage return to submit a terminal command. Raw input can execute arbitrary native programs and requires execution approval. Use terminal_key for mode-aware keys, terminal_paste for pasted text and terminal_mouse for ncurses mouse input.',
    object({id, text: text(65536)}), 'execute', ({id, text}, context) => { owned(id, context); return terminals.input(id, text); });
  add('terminal_key', 'Send a mode-aware key to an owned TUI: Enter, Tab, Backspace, Escape, Space, arrows, Home/End, PageUp/PageDown, Insert/Delete, F1–F12, Numpad keys or one Unicode character. Supports ctrl/alt/shift/meta and bounded repetition. Application cursor/keypad modes are respected.',
    object({id, key: {...text(32), minLength: 1}, ...modifiers, meta: {type: 'boolean'}, count: integer(1, 100)}, ['id', 'key']), 'execute', ({id, ...options}, context) => { owned(id, context); return terminals.key(id, options); });
  add('terminal_paste', 'Paste text using the application’s bracketed-paste mode. Newlines normalize to carriage returns; embedded ESC is stripped inside a bracketed paste so it cannot prematurely terminate that paste. Encoded input is limited to 64 KiB. Use terminal_input for deliberately byte-sensitive protocols.',
    object({id, text: text(65536)}), 'execute', ({id, text}, context) => { owned(id, context); return terminals.paste(id, text); });
  add('terminal_mouse', 'Send an ncurses/TUI mouse event in one-based terminal cell coordinates. Honors mouse tracking and default/UTF-8/SGR/URXVT encodings. Disabled or filtered events return accepted:false. Pixel-coordinate protocols require raw input, not this cell-coordinate operation.',
    object({id, type: {enum: ['down', 'up', 'move', 'wheel-up', 'wheel-down']}, button: {enum: ['left', 'middle', 'right', 'none']}, column: integer(1, 500), row: integer(1, 200), ...modifiers}, ['id', 'column', 'row']), 'execute', ({id, ...options}, context) => { owned(id, context); return terminals.mouse(id, options); });
  add('terminal_resize', 'Resize an owned PTY and deliver SIGWINCH to its foreground process. Completion means the host acknowledged the new size and the authoritative screen applied the ordered resize barrier.',
    object({id, cols: integer(2, 500), rows: integer(2, 200)}), 'execute', ({id, cols, rows}, context) => { owned(id, context); return terminals.resize(id, cols, rows); });
  add('terminal_signal', 'Signal an owned PTY foreground process group without also interrupting its interactive shell. Closing the terminal terminates both the foreground job and session shell.',
    object({id, signal: {enum: ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGTSTP', 'SIGCONT']}}, ['id']), 'execute', ({id, signal}, context) => { owned(id, context); return terminals.signal(id, signal); });
  add('terminal_close', 'Close an owned PTY and terminate its foreground job and shell. The final rendered screen and bounded replay remain available for inspection until session eviction.',
    object({id}), 'execute', async ({id}, context) => { owned(id, context); await terminals.close(id); return {closed: true}; });
}
