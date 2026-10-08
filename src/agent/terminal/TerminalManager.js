import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
import {fileURLToPath} from 'node:url';
import {AgentError} from '../core/AgentError.js';
import {EventLog} from '../core/EventLog.js';

/** Real POSIX terminal sessions with resize, job-control input, replay and bounded resources. */
export class TerminalManager {
  constructor(workspace, events, {spawnProcess = spawn, python = 'python3', maxSessions = 8, idleMs = 30 * 60 * 1000, environment = process.env} = {}) {
    this.workspace = workspace; this.events = events; this.spawnProcess = spawnProcess; this.python = python; this.maxSessions = maxSessions; this.environment = environment; this.sessions = new Map();
    this.sweeper = setInterval(() => { for (const session of this.sessions.values()) if (!session.closed && Date.now() - session.lastUsed > idleMs) this.close(session.id).catch(() => {}); }, 30000); this.sweeper.unref?.();
  }
  static environment(source = process.env) {
    const env = {...source, TERM: 'xterm-256color', COLORTERM: 'truecolor', PYTHONUNBUFFERED: '1'};
    for (const name of Object.keys(env)) if (/^(?:OPENAI_API_KEY|ANTHROPIC_API_KEY|GEMINI_API_KEY|GOOGLE_API_KEY|FERRITE_.*TOKEN|NODE_OPTIONS|PYTHONPATH|PYTHONSTARTUP)$/i.test(name)) delete env[name];
    return env;
  }
  static dimensions(cols, rows) { if (!Number.isSafeInteger(cols) || cols < 2 || cols > 500 || !Number.isSafeInteger(rows) || rows < 2 || rows > 200) throw new AgentError('TERMINAL_SIZE', 'Terminal size must be 2–500 columns and 2–200 rows'); }
  async start({executable = '/bin/sh', args = ['-i'], cwd = '', cols = 100, rows = 30, owner = null} = {}) {
    if (process.platform === 'win32') throw new AgentError('PTY_PLATFORM', 'The dependency-free PTY host requires POSIX; use WSL on Windows');
    if ([...this.sessions.values()].filter(session => !session.closed).length >= this.maxSessions) throw new AgentError('TERMINAL_CAPACITY', 'Terminal session limit reached');
    if (typeof executable !== 'string' || !executable || executable.length > 4096 || /[\0\r\n]/.test(executable) || !Array.isArray(args) || args.length > 256 || args.some(arg => typeof arg !== 'string' || arg.length > 8192 || arg.includes('\0'))) throw Error('Invalid terminal executable or arguments');
    TerminalManager.dimensions(cols, rows); const root = await this.workspace.path(cwd, {directory: true});
    if ([...this.sessions.values()].filter(session => !session.closed).length >= this.maxSessions) throw new AgentError('TERMINAL_CAPACITY', 'Terminal session limit reached');
    const id = randomUUID(), log = new EventLog({limit: 4000, maxCharacters: 2_000_000});
    const session = {id, owner, executable, args, cwd, cols, rows, log, decoder: new StringDecoder('utf8'), closed: false, exitCode: null, lastUsed: Date.now(), createdAt: new Date().toISOString()};
    this.sessions.set(id, session);
    const helper = fileURLToPath(new URL('../../../tools/agent-pty.py', import.meta.url));
    // This module is src/agent/terminal: walk to repository root (three ancestors).
    const child = this.spawnProcess(this.python, ['-I', '-u', helper, JSON.stringify({argv: [executable, ...args], cwd: root, cols, rows})], {cwd: root, env: TerminalManager.environment(this.environment), shell: false, stdio: ['pipe', 'pipe', 'pipe']});
    session.child = child; let buffer = '', stderr = '', ready = false;
    session.exited = new Promise(resolve => { session.resolveExit = resolve; });
    const finish = code => {
      if (session.closed) return; session.closed = true; session.exitCode = code; session.log.emit('exit', {code});
      this.events.emit('terminal.exited', {id, owner, code}); session.resolveExit();
    };
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
          if (event.type === 'data') { const text = session.decoder.write(Buffer.from(event.data, 'base64')); session.log.emit('data', {text}); session.lastUsed = Date.now(); }
          if (event.type === 'error') { session.log.emit('data', {text: '\r\nPTY error: ' + event.message + '\r\n'}); if (!ready) { clearTimeout(timeout); reject(new AgentError('PTY_ERROR', event.message)); } }
          if (event.type === 'exit') { const tail = session.decoder.end(); if (tail) session.log.emit('data', {text: tail}); finish(event.code); }
        }
      });
      child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString('utf8')).slice(-4000); });
      child.once('error', error => { clearTimeout(timeout); finish(127); reject(new AgentError('PTY_UNAVAILABLE', 'Install Python 3 for native PTY support: ' + error.message)); });
      child.once('close', code => { clearTimeout(timeout); finish(code ?? 128); if (!ready) reject(new AgentError('PTY_FAILED', 'PTY helper exited: ' + stderr)); });
      child.stdin.on('error', () => {});
    });
    this.events.emit('terminal.started', metadata);
    // Keep a finite history of exited terminals as well as live ones.
    for (const old of [...this.sessions.values()].filter(item => item.closed).slice(0, -16)) this.sessions.delete(old.id);
    return metadata;
  }
  metadata(session) { return {id: session.id, owner: session.owner, executable: session.executable, args: session.args, cwd: session.cwd, cols: session.cols, rows: session.rows, closed: session.closed, exitCode: session.exitCode, createdAt: session.createdAt}; }
  get(id) { const session = this.sessions.get(id); if (!session) throw new AgentError('UNKNOWN_TERMINAL', 'Terminal session not found', {status: 404}); return session; }
  list() { return [...this.sessions.values()].map(session => this.metadata(session)); }
  send(id, message) {
    const session = this.get(id); if (session.closed || session.child.stdin.destroyed) throw new AgentError('TERMINAL_CLOSED', 'Terminal has exited');
    if (session.child.stdin.writableLength > 1024 * 1024) throw new AgentError('TERMINAL_BACKPRESSURE', 'Terminal input is congested');
    session.lastUsed = Date.now(); session.child.stdin.write(JSON.stringify(message) + '\n'); return {accepted: true};
  }
  input(id, text) { if (typeof text !== 'string' || Buffer.byteLength(text) > 65536) throw Error('Terminal input exceeds 64 KiB'); return this.send(id, {type: 'input', data: Buffer.from(text).toString('base64')}); }
  resize(id, cols, rows) { TerminalManager.dimensions(cols, rows); const session = this.get(id); session.cols = cols; session.rows = rows; return this.send(id, {type: 'resize', cols, rows}); }
  signal(id, signal = 'SIGINT') { if (!['SIGINT', 'SIGTERM', 'SIGHUP'].includes(signal)) throw Error('Unsupported terminal signal'); return this.send(id, {type: 'signal', signal}); }
  read(id, cursor = 0) { const session = this.get(id); session.lastUsed = Date.now(); return {...this.metadata(session), ...session.log.read(cursor)}; }
  async close(id) {
    const session = this.get(id); if (session.closed) return;
    try { this.send(id, {type: 'close'}); } catch {}
    const timer = setTimeout(() => session.child.kill('SIGKILL'), 2500); timer.unref?.();
    try { await session.exited; } finally { clearTimeout(timer); }
  }
  async closeOwner(owner) { await Promise.all([...this.sessions.values()].filter(session => session.owner === owner && !session.closed).map(session => this.close(session.id))); }
  async dispose() { clearInterval(this.sweeper); await Promise.all([...this.sessions.keys()].map(id => this.close(id))); }
}
