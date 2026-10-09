import {TerminalFramer} from './TerminalFramer.js';
import {captureTerminalState} from './XtermStateAdapter.js';
import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';
import {AgentError} from '../core/AgentError.js';
import {EventLog} from '../core/EventLog.js';
import {TerminalScreen} from './TerminalScreen.js';
import {TerminalInput} from './TerminalInput.js';
import {TERMINAL_ENGINE} from './TerminalProtocol.js';

/** Real PTYs with an authoritative xterm, ordered resize barriers and bounded replay.
 * Output is parsed continuously, even with no browser/MCP observer. Only this side
 * answers terminal queries; browser terminals are replicas, not reply authorities.
 */
export class TerminalManager {
  constructor(workspace, events, {spawnProcess = spawn, python = 'python3', maxSessions = 8, idleMs = 30 * 60 * 1000, environment = process.env} = {}) {
    this.workspace = workspace; this.events = events; this.spawnProcess = spawnProcess; this.python = python; this.maxSessions = maxSessions; this.environment = environment; this.sessions = new Map();
    this.sweeper = setInterval(() => { for (const session of this.sessions.values()) if (!session.closed && Date.now() - session.lastUsed > idleMs) this.close(session.id).catch(() => {}); }, 30000); this.sweeper.unref?.();
  }
  static environment(source = process.env) {
    const env = {...source, TERM: 'xterm-256color', COLORTERM: 'truecolor', PYTHONUNBUFFERED: '1'};
    // Curses needs a Unicode locale. Preserve an explicitly configured host locale.
    if (!env.LANG && !env.LC_ALL && !env.LC_CTYPE) env.LANG = 'C.UTF-8';
    for (const name of Object.keys(env)) if (/^(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|FERRITE_.*TOKEN|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP)$/i.test(name)) delete env[name];
    return env;
  }
  static dimensions(cols, rows) { if (!Number.isSafeInteger(cols) || cols < 2 || cols > 500 || !Number.isSafeInteger(rows) || rows < 2 || rows > 200) throw new AgentError('TERMINAL_SIZE', 'Terminal size must be 2–500 columns and 2–200 rows'); }
  async start({executable = '/bin/sh', args = ['-i'], cwd = '', cols = 100, rows = 30, owner = null} = {}) {
    if (process.platform === 'win32') throw new AgentError('PTY_PLATFORM', 'The PTY host requires POSIX; use WSL on Windows');
    const capacity = () => { if ([...this.sessions.values()].filter(session => !session.closed).length >= this.maxSessions) throw new AgentError('TERMINAL_CAPACITY', 'Terminal session limit reached'); };
    capacity();
    if (typeof executable !== 'string' || !executable || executable.length > 4096 || /[\0\r\n]/.test(executable) || !Array.isArray(args) || args.length > 256 || args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw new AgentError('TERMINAL_INPUT', 'Invalid terminal executable or arguments');
    TerminalManager.dimensions(cols, rows); const root = await this.workspace.path(cwd, {directory: true}); capacity();
    const id = randomUUID(), session = {id, owner, executable, args, cwd, cols, rows, log: new EventLog({limit: 4000, maxCharacters: 2_000_000}),
      decoder: new StringDecoder('utf8'), closed: false, finishing: false, exitCode: null, lastUsed: Date.now(), createdAt: new Date().toISOString(), queue: Promise.resolve(), pendingCharacters: 0, resizes: new Map()};
    session.exited = new Promise(resolve => { session.resolveExit = resolve; });
    session.screen = new TerminalScreen(cols, rows, {onReply: text => { if (!session.closed && session.child && !session.child.stdin.destroyed) { try { this.input(id, text); } catch { /* A closing/congested process cannot receive replies. */ } } }});
    session.framer = new TerminalFramer(session.screen.terminal);
    this.sessions.set(id, session);
    const helper = fileURLToPath(new URL('../../../tools/agent-pty.py', import.meta.url));
    let child;
    try { child = this.spawnProcess(this.python, ['-I', '-u', helper, JSON.stringify({argv: [executable, ...args], cwd: root, cols, rows})], {cwd: root, env: TerminalManager.environment(this.environment), shell: false, stdio: ['pipe', 'pipe', 'pipe']}); }
    catch (error) { session.screen.dispose(); this.sessions.delete(id); throw new AgentError('PTY_UNAVAILABLE', error.message); }
    session.child = child;
    const finish = code => {
      if (session.finishing || session.closed) return; session.finishing = true;
      const tail = session.decoder.end(); if (tail) this.append(session, tail);
      this.enqueue(session, () => {
        session.closed = true; session.exitCode = code;
        for (const pending of session.resizes.values()) { clearTimeout(pending.timer); pending.reject(new AgentError('TERMINAL_CLOSED', 'Terminal exited before resize acknowledgement')); }
        session.resizes.clear(); session.log.emit('exit', {code});
        this.events.emit('terminal.exited', {id, owner, code}); session.resolveExit();
      });
    };
    session.finish = finish;
    let buffer = '', stderr = '', ready = false;
    const metadata = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { child.kill('SIGTERM'); reject(new AgentError('PTY_TIMEOUT', 'PTY helper did not start')); }, 10000);
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8');
        if (buffer.length > 2 * 1024 * 1024) { child.kill('SIGTERM'); return; }
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); let event;
          try { event = JSON.parse(line); } catch { child.kill('SIGTERM'); continue; }
          if (event.type === 'ready') { ready = true; session.pid = event.pid; clearTimeout(timeout); resolve(this.metadata(session)); }
          else if (event.type === 'data') this.append(session, session.decoder.write(Buffer.from(event.data, 'base64')));
          else if (event.type === 'resize') {
            this.enqueue(session, () => {
              TerminalManager.dimensions(event.cols, event.rows); session.screen.resize(event.cols, event.rows); session.cols = event.cols; session.rows = event.rows;
              session.log.emit('resize', {cols: event.cols, rows: event.rows});
              const pending = session.resizes.get(event.requestId);
              if (pending) { session.resizes.delete(event.requestId); clearTimeout(pending.timer); pending.resolve({accepted: true, cols: event.cols, rows: event.rows}); }
            });
          } else if (event.type === 'error') {
            this.append(session, '\r\nPTY error: ' + event.message + '\r\n');
            if (!ready) { clearTimeout(timeout); reject(new AgentError('PTY_ERROR', event.message)); }
          } else if (event.type === 'exit') finish(event.code);
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
      child.once('error', error => { clearTimeout(timeout); finish(127); reject(new AgentError('PTY_UNAVAILABLE', 'Install Python 3 for native PTY support: ' + error.message)); });
      child.once('close', code => { clearTimeout(timeout); finish(code ?? 128); if (!ready) reject(new AgentError('PTY_FAILED', 'PTY helper exited: ' + stderr)); });
      child.stdin.on('error', () => {});
    });
    this.events.emit('terminal.started', metadata);
    for (const old of [...this.sessions.values()].filter(item => item.closed).slice(0, -16)) { old.screen.dispose(); this.sessions.delete(old.id); }
    return metadata;
  }
  enqueue(session, operation) {
    const result = session.queue.then(operation);
    // Validation errors from a client must not poison or terminate the process.
    session.queue = result.catch(() => {});
    return result;
  }
  append(session, text) {
    if (!text) return;
    const discarded = session.framer.discarded; text = session.framer.push(text);
    if (discarded !== session.framer.discarded) this.enqueue(session, () => session.log.emit('warning', {code: 'TERMINAL_CONTROL_LIMIT', discarded: session.framer.discarded}));
    if (!text) return; session.pendingCharacters += text.length;
    // Pausing the pipe propagates backpressure through Python to the actual PTY.
    if (session.pendingCharacters > 512 * 1024) session.child.stdout.pause();
    this.enqueue(session, async () => {
      try { await session.screen.write(text); session.log.emit('data', {text}); session.lastUsed = Date.now(); }
      catch (error) { session.error = error.message; session.child.kill('SIGTERM'); throw error; }
      finally { session.pendingCharacters -= text.length; if (session.pendingCharacters < 128 * 1024) session.child.stdout.resume(); }
    });
  }
  metadata(session) { return {id: session.id, owner: session.owner, executable: session.executable, args: session.args, cwd: session.cwd, cols: session.cols, rows: session.rows, closed: session.closed, exitCode: session.exitCode, createdAt: session.createdAt, engine: TERMINAL_ENGINE, backend: 'posix-pty'}; }
  get(id) { const session = this.sessions.get(id); if (!session) throw new AgentError('UNKNOWN_TERMINAL', 'Terminal session not found', {status: 404}); return session; }
  list() { return [...this.sessions.values()].map(session => this.metadata(session)); }
  send(id, message) {
    const session = this.get(id); if (session.closed || session.child.stdin.destroyed) throw new AgentError('TERMINAL_CLOSED', 'Terminal has exited');
    if (session.child.stdin.writableLength > 1024 * 1024) throw new AgentError('TERMINAL_BACKPRESSURE', 'Terminal input is congested');
    session.lastUsed = Date.now(); session.child.stdin.write(JSON.stringify(message) + '\n'); return {accepted: true};
  }
  inputBytes(id, bytes) { if (!(bytes instanceof Uint8Array) || bytes.byteLength > 65536) throw new AgentError('TERMINAL_INPUT', 'Terminal input exceeds 64 KiB'); return bytes.length ? this.send(id, {type: 'input', data: Buffer.from(bytes).toString('base64')}) : {accepted: false, reason: 'no-input'}; }
  input(id, text) { if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw new AgentError('TERMINAL_INPUT', 'Terminal input exceeds 64 KiB'); return this.inputBytes(id, Buffer.from(text)); }
  key(id, options) { const session = this.get(id); return this.enqueue(session, () => this.inputBytes(id, TerminalInput.key(options, session.screen.modes()))); }
  paste(id, text) { const session = this.get(id); return this.enqueue(session, () => this.inputBytes(id, TerminalInput.paste(text, session.screen.modes()))); }
  mouse(id, options) { const session = this.get(id); return this.enqueue(session, () => this.inputBytes(id, TerminalInput.mouse(options, session.screen.modes(), session.cols, session.rows))); }
  resize(id, cols, rows) {
    TerminalManager.dimensions(cols, rows); const session = this.get(id), requestId = randomUUID();
    if (session.resizes.size >= 16) throw new AgentError('TERMINAL_BACKPRESSURE', 'Too many pending terminal resizes');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { session.resizes.delete(requestId); reject(new AgentError('PTY_TIMEOUT', 'PTY resize was not acknowledged')); }, 5000);
      session.resizes.set(requestId, {resolve, reject, timer});
      try { this.send(id, {type: 'resize', cols, rows, requestId}); }
      catch (error) { session.resizes.delete(requestId); clearTimeout(timer); reject(error); }
    });
  }
  signal(id, signal = 'SIGINT') { if (!['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGTSTP', 'SIGCONT'].includes(signal)) throw new AgentError('TERMINAL_SIGNAL', 'Unsupported terminal signal'); return this.send(id, {type: 'signal', signal}); }
  read(id, cursor = 0) { const session = this.get(id); session.lastUsed = Date.now(); return {...this.metadata(session), ...session.log.read(cursor)}; }
  snapshot(id, options = {}) {
    const session = this.get(id); session.lastUsed = Date.now();
    return this.enqueue(session, () => ({...this.metadata(session), ...session.screen.snapshot(options), cursor: session.log.sequence}));
  }
  state(id) {
    const session = this.get(id); session.lastUsed = Date.now();
    return this.enqueue(session, () => {
      let scrollback = 1000, ansi = session.screen.serialize(scrollback);
      while (ansi.length > 2_000_000 && scrollback > 0) { scrollback = Math.floor(scrollback / 2); ansi = session.screen.serialize(scrollback); }
      return {...this.metadata(session), cursor: session.log.sequence, ansi, protocol: captureTerminalState(session.screen.terminal), retainedScrollback: scrollback, title: session.screen.title, modes: session.screen.modes()};
    });
  }
  async wait(id, {cursor = 0, contains, until = contains === undefined ? 'output' : 'text', timeoutMs = 1000, signal} = {}) {
    const session = this.get(id); session.log.read(cursor); AgentError.abort(signal);
    if (!['output', 'text', 'exit'].includes(until) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || timeoutMs > 30000 || contains !== undefined && (typeof contains !== 'string' || !contains || contains.length > 4096) || until === 'text' && !contains) throw new AgentError('TERMINAL_WAIT', 'Wait requires a valid condition, literal text and a timeout of 0–30000 ms');
    if (session.waiters >= 32) throw new AgentError('TERMINAL_CAPACITY', 'Terminal wait limit reached');
    session.waiters = (session.waiters ?? 0) + 1;
    try {
      return await new Promise((resolve, reject) => {
        let done = false, unsubscribe = () => {}, timer;
        const cleanup = () => { done = true; clearTimeout(timer); unsubscribe(); signal?.removeEventListener('abort', abort); };
        const abort = () => { if (!done) { cleanup(); reject(signal.reason ?? new DOMException('Cancelled', 'AbortError')); } };
        const inspect = (timedOut = false) => {
          if (done) return;
          const result = this.read(id, cursor), matched = until === 'exit' ? session.closed : until === 'text' ? session.screen.text().includes(contains) : result.events.length > 0 || result.gap;
          if (matched || session.closed || timedOut) { cleanup(); resolve({...result, matched, timedOut: !matched && !session.closed && timedOut, reason: matched ? 'matched' : session.closed ? 'exit' : 'timeout'}); }
        };
        unsubscribe = session.log.subscribe(() => inspect()); signal?.addEventListener('abort', abort, {once: true});
        timer = setTimeout(() => inspect(true), timeoutMs); if (signal?.aborted) abort(); else inspect();
      });
    } finally { session.waiters--; }
  }
  async close(id) {
    const session = this.get(id); if (session.closed) return;
    try { this.send(id, {type: 'close'}); } catch {}
    const timer = setTimeout(() => session.child.kill('SIGKILL'), 2500); timer.unref?.();
    try { await session.exited; } finally { clearTimeout(timer); }
  }
  async closeOwner(owner) { await Promise.all([...this.sessions.values()].filter(session => session.owner === owner && !session.closed).map(session => this.close(session.id))); }
  async dispose() { clearInterval(this.sweeper); await Promise.all([...this.sessions.keys()].map(id => this.close(id))); for (const session of this.sessions.values()) session.screen.dispose(); this.sessions.clear(); }
}
