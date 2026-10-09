import {ProcessRunner} from '../../native/ProcessRunner.js';
import {CargoOutputParser} from '../../native/CargoOutputParser.js';
import {TerminalManager} from '../terminal/TerminalManager.js';
import {object, text, path, integer} from './ToolSchemas.js';
import {AgentError} from '../core/AgentError.js';
import {registerTerminalTools} from './TerminalTools.js';

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
  registerTerminalTools(registry, terminals);
}
