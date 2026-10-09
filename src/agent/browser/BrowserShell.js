import {VirtualShell} from '../terminal/VirtualShell.js';
import {WorkspaceModel} from '../../ui/model/WorkspaceModel.js';
import {AgentError} from '../core/AgentError.js';
import {object, text} from '../tools/ToolSchemas.js';

/** Bounded shell over a transaction snapshot. Only the final validated diff mutates live documents. */
export class BrowserShell extends VirtualShell {
  constructor(model, {compiler, signal} = {}) { super(model); this.compiler = compiler; this.signal = signal; }
  async command(words, input) {
    if (words[0] === 'cargo') return this.cargo(words.slice(1));
    return super.command(words, input);
  }
  async cargo(args) {
    const [command = 'help', ...rest] = args;
    if (command === '--version' || command === 'version') return {text: 'Ferrite browser Cargo command adapter (NOT native Cargo)\n', code: 0};
    if (command === 'help') return {text: 'Browser subset: cargo check | build | run | test | metadata. Options: --features LIST, --all-features, --no-default-features, --package NAME, --bin NAME, --release. Native rustc, downloads, build scripts and CLI processes require optional native mode.\n', code: 0};
    if (!['check','build','run','test','metadata'].includes(command)) throw new AgentError('NATIVE_REQUIRED', 'This Cargo operation requires native mode; no native command was executed');
    const options = {};
    for (let i = 0; i < rest.length; i++) {
      const flag = rest[i];
      if (flag === '--all-features') options.allFeatures = true;
      else if (flag === '--no-default-features') options.defaultFeatures = false;
      else if (flag === '--release') options.optimize = true;
      else if (['--features','--package','-p','--bin'].includes(flag)) {
        const value = rest[++i]; if (!value || value.startsWith('-')) throw Error('Missing value for ' + flag);
        if (flag === '--features') options.features = value.split(/[, ]+/).filter(Boolean);
        else options[flag === '--bin' ? 'target' : 'package'] = value;
      } else throw new AgentError('NATIVE_REQUIRED', 'Unsupported browser Cargo argument: ' + flag + '. No native command was executed.');
    }
    const files = this.model.files, build = await this.compiler.compile(files, command === 'run' || command === 'test' ? 'agent-' + command : 'check', options, this.signal);
    if (command === 'metadata') return {text: JSON.stringify({backend: 'ferrite-browser', plan: build.plan, diagnostics: build.diagnostics}, null, 2) + '\n', code: build.diagnostics?.some(item => item.severity === 'error') ? 1 : 0};
    const errors = build.diagnostics?.filter(item => item.severity === 'error') ?? [], failed = build.results?.some(item => item.status === 'failed');
    return {text: (errors.length ? errors.map(item => `${item.code}: ${item.message}`).join('\n') : command === 'run' ? build.output ?? '' : command === 'test' ? JSON.stringify(build.results, null, 2) : 'Ferrite browser ' + command + ' completed (Rust subset; no native executable).') + '\n', code: errors.length || failed ? 1 : 0};
  }
}

/** Per-owner shell state survives commands, but every command executes on a revision-checked snapshot. */
export class BrowserShellSession {
  constructor(workspace, compiler) { this.workspace = workspace; this.compiler = compiler; this.state = null; this.queue = Promise.resolve(); }
  execute(command, context = {}) {
    const operation = this.queue.catch(() => {}).then(async () => {
      const workspace = this.workspace, snapshot = await workspace.snapshot(), model = new WorkspaceModel(snapshot.files);
      const shell = new BrowserShell(model, {compiler: this.compiler, signal: context.signal});
      if (this.state) { shell.cwd = this.state.cwd; shell.env = {...this.state.env}; shell.directories = new Set(this.state.directories); shell.history = [...this.state.history]; shell.lastCode = this.state.lastCode; }
      const result = await shell.execute(command); workspace.assertCurrent(context.signal);
      const changes = [];
      for (const path of new Set([...Object.keys(snapshot.files), ...Object.keys(model.files)])) {
        const before = snapshot.files[path] ?? null, after = model.files[path] ?? null;
        if (before !== after) changes.push({path, expectedHash: snapshot.hashes[path] ?? null, text: after});
      }
      const transaction = changes.length ? await workspace.apply(changes, {...context, label: 'Browser shell'}) : null;
      this.state = {cwd: shell.cwd, env: {...shell.env}, directories: [...shell.directories], history: [...shell.history], lastCode: shell.lastCode};
      return {backend: 'ferrite-browser-shell', ...result, cwd: shell.cwd, transaction};
    }); this.queue = operation; return operation;
  }
}

export function registerBrowserShell(registry, workspace, compiler) {
  const sessions = new Map();
  registry.register({name: 'browser_shell', category: 'terminal', risk: 'execute', description: 'Run bounded Unix-like workspace utilities, pipes, conditionals and redirection, plus Ferrite browser Cargo check/build/run/test/metadata. Edits are applied atomically with hashes and a checkpoint. Current directory/environment persist per agent session. This is not an OS shell: no native processes, network commands, package installation or full rustc.',
    inputSchema: object({command: {...text(64000), minLength: 1}}), run: ({command}, context) => {
      const owner = context.sessionId ?? 'manual';
      if (!sessions.has(owner)) { if (sessions.size >= 32) sessions.delete(sessions.keys().next().value); sessions.set(owner, new BrowserShellSession(workspace, compiler)); }
      return sessions.get(owner).execute(command, context);
    }});
  registry.register({name: 'cargo', category: 'compiler', risk: 'execute', description: 'Execute the browser Cargo adapter on the current editor workspace: check/build/run/test/metadata for Ferrite’s Rust subset. Unsupported arguments, registry downloads, procedural macros, build scripts and native executables fail explicitly; they require optional native Cargo.',
    inputSchema: object({args: {type: 'array', maxItems: 64, items: text(2048)}}), run: async ({args}, context) => {
      const snapshot = await workspace.snapshot(), model = new WorkspaceModel(snapshot.files);
      const result = await new BrowserShell(model, {compiler, signal: context.signal}).cargo(args); workspace.assertCurrent(context.signal); return {backend: 'ferrite-browser', ...result};
    }});
}
