import {ProcessRunner} from '../../native/ProcessRunner.js';
import {CargoOutputParser} from '../../native/CargoOutputParser.js';
import {TerminalManager} from '../terminal/TerminalManager.js';
import {object, text, path, integer} from './ToolSchemas.js';
import {AgentError} from '../core/AgentError.js';

/** Native execution is deliberately explicit. The bridge is not a container or syscall sandbox. */
export function registerProcessTools(registry, workspace, events, terminals, {runner = new ProcessRunner(), environment = process.env} = {}) {
  let running = 0;
  const execute = async ({executable, args = [], cwd = '', timeoutMs = 120000}, context) => {
    if (running >= 4) throw new AgentError('PROCESS_CAPACITY', 'Four native processes are already running');
    running++;
    try {
      const directory = await workspace.path(cwd, {directory: true}); AgentError.abort(context.signal);
      return await runner.run(executable, args, {cwd: directory, env: TerminalManager.environment(environment), signal: context.signal, timeoutMs, maxOutputBytes: 4 * 1024 * 1024,
        onEvent: event => events.emit('process.output', {sessionId: context.sessionId, callId: context.callId, ...event})});
    } finally { running--; }
  };
  const args = {type: 'array', maxItems: 256, items: text(8192)};
  registry.register({name: 'process_exec', category: 'terminal', risk: 'execute', description: 'Run a real installed program with an argument vector in the native workspace. Supports cargo, rustc, git and all installed Unix utilities. There is no implicit shell; for pipes use executable /bin/sh with args ["-lc", "..."] and explicit execution approval. Native programs have the host user’s permissions, NOT a sandbox.',
    inputSchema: object({executable: {...text(4096), minLength: 1, pattern: '^[^\\u0000\\r\\n]+$'}, args, cwd: path, timeoutMs: integer(100, 600000)}, ['executable']), run: execute});
  registry.register({name: 'cargo', category: 'rust', risk: 'execute', description: 'Run real installed Cargo in the persistent checkout, preserving Cargo.lock, .cargo configuration, local/git/registry dependencies, build scripts and incremental artifacts. Supply the full argument vector, e.g. ["check","--workspace","--all-targets","--message-format=json","--jobs","8"]. May execute native code and access the network.',
    inputSchema: object({args, cwd: path, timeoutMs: integer(100, 600000)}, ['args']), run: async (args, context) => {
      const result = await execute({executable: 'cargo', ...args}, context);
      return {...result, ...CargoOutputParser.parse(result.stdout)};
    }});
  registry.register({name: 'git_inspect', category: 'workspace', risk: 'read', description: 'Inspect local Git status, diff or recent log with external diff/text conversion and hooks disabled. Mutating Git operations require process_exec approval.',
    inputSchema: object({view: {enum: ['status', 'diff', 'staged', 'log']}, limit: integer(1, 100)}, ['view']), run: ({view, limit = 20}, context) => {
      const suffix = {status: ['status', '--short', '--untracked-files=normal'], diff: ['diff', '--no-ext-diff', '--no-textconv', '--'], staged: ['diff', '--cached', '--no-ext-diff', '--no-textconv', '--'], log: ['log', '--no-show-signature', `-${limit}`, '--format=%h %ad %s', '--date=iso-strict', '--']}[view];
      return execute({executable: 'git', args: ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.external=', ...suffix], timeoutMs: 30000}, context);
    }});
  const owned = (id, context) => { const session = terminals.get(id); if (session.owner !== context.sessionId) throw new AgentError('TERMINAL_OWNER', 'An agent may only access terminals created by its own session'); return session; };
  const add = (name, description, inputSchema, risk, run) => registry.register({name, description, inputSchema, risk, run, category: 'terminal'});
  add('terminal_open', 'Start an interactive native POSIX PTY with persistent process state, job control and streaming output. Use this for REPLs, interactive CLIs and long-lived commands. Read output using terminal_read. Python 3 is required; on Windows use WSL.', object({executable: text(4096), args, cwd: path, cols: integer(2, 500), rows: integer(2, 200)}, []), 'execute', (args, context) => terminals.start({...args, owner: context.sessionId}));
  add('terminal_list', 'List terminals owned by this agent session only.', object(), 'read', (_, context) => terminals.list().filter(item => item.owner === context.sessionId));
  add('terminal_read', 'Read terminal output since a sequence cursor, including explicit scrollback gaps and process exit status. It does not wait for the program to exit.', object({id: text(100), cursor: integer(0, Number.MAX_SAFE_INTEGER)}, ['id']), 'read', ({id, cursor}, context) => { owned(id, context); return terminals.read(id, cursor); });
  add('terminal_input', 'Send literal terminal input to an owned PTY; include newline to submit a command. Sending input can execute programs and requires execution approval.', object({id: text(100), text: text(65536)}), 'execute', ({id, text}, context) => { owned(id, context); return terminals.input(id, text); });
  add('terminal_resize', 'Resize an owned PTY and notify its foreground process.', object({id: text(100), cols: integer(2, 500), rows: integer(2, 200)}), 'read', ({id, cols, rows}, context) => { owned(id, context); return terminals.resize(id, cols, rows); });
  add('terminal_signal', 'Interrupt or terminate an owned PTY foreground process group.', object({id: text(100), signal: {enum: ['SIGINT', 'SIGTERM', 'SIGHUP']}}, ['id']), 'execute', ({id, signal}, context) => { owned(id, context); return terminals.signal(id, signal); });
  add('terminal_close', 'Close an owned PTY and terminate its foreground process group.', object({id: text(100)}), 'execute', async ({id}, context) => { owned(id, context); await terminals.close(id); return {closed: true}; });
}
